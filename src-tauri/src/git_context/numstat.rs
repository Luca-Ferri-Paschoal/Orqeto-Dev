fn parse_numstat(
	output: &[u8],
	root: &Path,
	root_relative_to_repository: &Path,
	metadata: &PatchMetadata,
) -> Result<(Vec<GitPatchChange>, Vec<String>, usize, usize), String> {
	let fields = output.split(|byte| *byte == 0).collect::<Vec<_>>();
	let mut index = 0_usize;
	let mut changes = Vec::new();
	let mut affected_paths = Vec::new();
	let mut affected_seen = HashSet::new();
	let mut added_lines = 0_usize;
	let mut deleted_lines = 0_usize;

	while index < fields.len() {
		let field = fields[index];
		index += 1;

		if field.is_empty() {
			continue;
		}

		let mut parts = field.splitn(3, |byte| *byte == b'\t');
		let added = parse_count(parts.next().unwrap_or_default())?;
		let deleted = parse_count(parts.next().unwrap_or_default())?;
		let path_field = parts
			.next()
			.ok_or_else(|| "O Git retornou um formato de patch inesperado.".to_string())?;

		added_lines = added_lines
			.checked_add(added)
			.ok_or_else(|| "The patch contains too many lines to count.".to_string())?;
		deleted_lines = deleted_lines
			.checked_add(deleted)
			.ok_or_else(|| "The patch contains too many lines to count.".to_string())?;

		let (reported_previous_path, relative_path) = if path_field.is_empty() {
			let previous_field = fields
				.get(index)
				.ok_or_else(|| "O Git retornou um rename incompleto no patch.".to_string())?;
			let next_field = fields
				.get(index + 1)
				.ok_or_else(|| "O Git retornou um rename incompleto no patch.".to_string())?;
			index += 2;

			(
				Some(normalize_git_patch_path(
					previous_field,
					root_relative_to_repository,
				)?),
				normalize_git_patch_path(
					next_field,
					root_relative_to_repository,
				)?,
			)
		} else {
			(
				None,
				normalize_git_patch_path(
					path_field,
					root_relative_to_repository,
				)?,
			)
		};
		let metadata_previous_path = metadata
			.rename_sources
			.get(&path_key(&relative_path))
			.cloned();
		let previous_path = reported_previous_path.or(metadata_previous_path);
		let kind = if previous_path.is_some() {
			GitPatchChangeKind::Rename
		} else if metadata.deleted_paths.contains(&path_key(&relative_path)) {
			GitPatchChangeKind::Delete
		} else if fs::symlink_metadata(root.join(&relative_path)).is_ok() {
			GitPatchChangeKind::Modify
		} else {
			GitPatchChangeKind::Create
		};

		for path in previous_path
			.iter()
			.chain(std::iter::once(&relative_path))
		{
			if affected_seen.insert(path_key(path)) {
				affected_paths.push(path.clone());
			}
		}

		changes.push(GitPatchChange {
			relative_path,
			previous_path,
			kind,
			added_lines: added,
			deleted_lines: deleted,
		});

		if changes.len() > MAX_GIT_PATCH_FILES {
			return Err(format!(
				"The patch exceeds the limit of {MAX_GIT_PATCH_FILES} files per application.",
			));
		}
	}

	if changes.is_empty() {
		return Err("The patch contains no applicable text changes.".to_string());
	}

	Ok((
		changes,
		affected_paths,
		added_lines,
		deleted_lines,
	))
}

fn load_git_patch_source(patch_path: &str) -> Result<GitPatchSource, String> {
	let patch_path = canonicalize_existing(Path::new(patch_path))?;
	validate_patch_extension(&patch_path)?;
	let patch_file = File::open(&patch_path)
		.map_err(|error| format!("Could not open the patch: {error}"))?;
	let metadata = patch_file
		.metadata()
		.map_err(|error| format!("Could not inspect the patch: {error}"))?;

	if !metadata.is_file() {
		return Err("In Git Mode, drop a single .patch or .diff file.".to_string());
	}

	if metadata.len() > MAX_GIT_PATCH_BYTES {
		return Err(format!(
			"The patch exceeds the {} MiB limit.",
			MAX_GIT_PATCH_BYTES / (1024 * 1024),
		));
	}

	let mut patch_bytes = Vec::with_capacity(metadata.len() as usize);
	patch_file
		.take(MAX_GIT_PATCH_BYTES + 1)
		.read_to_end(&mut patch_bytes)
		.map_err(|error| format!("Could not read the patch: {error}"))?;
	if patch_bytes.len() as u64 > MAX_GIT_PATCH_BYTES {
		return Err(format!(
			"The patch exceeds the {} MiB limit.",
			MAX_GIT_PATCH_BYTES / (1024 * 1024),
		));
	}
	let patch_bytes: Arc<[u8]> = Arc::from(patch_bytes);
	let patch_text = std::str::from_utf8(&patch_bytes)
		.map_err(|_| "Git Mode accepts only textual UTF-8 patches.".to_string())?;

	if patch_text.contains('\0') {
		return Err("Git Mode accepts only textual patches.".to_string());
	}

	validate_text_patch(patch_text)?;
	let patch_name = patch_path
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("changes.patch")
		.to_string();

	Ok(GitPatchSource {
		bytes: patch_bytes,
		name: patch_name,
	})
}

fn prepare_git_patch_blocking(
	root_folder: &str,
	patch_path: &str,
) -> Result<PreparedGitPatch, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	if !is_git_repository_blocking(root_folder)? {
		return Err("Git Mode requires the selected folder to belong to a Git repository.".to_string());
	}

	let source = load_git_patch_source(patch_path)?;
	let patch_text = std::str::from_utf8(&source.bytes)
		.map_err(|_| "Git Mode accepts only textual UTF-8 patches.".to_string())?;
	let patch_metadata = parse_patch_metadata(patch_text)?;
	let (repository_root, root_relative_to_repository) = repository_layout(&root)?;
	let patch_fingerprint = patch_fingerprint(&source.bytes);
	let numstat = execute_git_apply(
		&repository_root,
		&root_relative_to_repository,
		&[
			"--numstat",
			"-z",
		],
		Arc::clone(&source.bytes),
	)?;

	if !numstat.status.success() {
		return Err(git_failure(&numstat));
	}

	let (
		changes,
		affected_paths,
		added_lines,
		deleted_lines,
	) = parse_numstat(
		&numstat.stdout,
		&root,
		&root_relative_to_repository,
		&patch_metadata,
	)?;
	validate_patch_targets(
		&root,
		&affected_paths,
	)?;
	validate_git_secret_protection(
		&root,
		patch_text,
		&affected_paths,
	)?;
	let check = execute_git_apply(
		&repository_root,
		&root_relative_to_repository,
		&["--check"],
		Arc::clone(&source.bytes),
	)?;

	if !check.status.success() {
		return Err(format!(
			"The patch cannot be applied safely: {}",
			git_failure(&check),
		));
	}

	Ok(PreparedGitPatch {
		project_root: root,
		repository_root,
		root_relative_to_repository,
		patch_bytes: source.bytes,
		patch_name: source.name,
		patch_fingerprint,
		added_lines,
		deleted_lines,
		changes,
		affected_paths,
	})
}

struct GitSimulationDirectory(PathBuf);

impl Drop for GitSimulationDirectory {
	fn drop(&mut self) {
		let _ = fs::remove_dir_all(&self.0);
	}
}

