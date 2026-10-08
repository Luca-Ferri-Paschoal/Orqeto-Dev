fn parse_patch_metadata(content: &str) -> Result<PatchMetadata, String> {
	let mut rename_sources = HashMap::new();
	let mut deleted_paths = HashSet::new();
	let mut pending_rename_from: Option<String> = None;
	let mut previous_header: Option<String> = None;
	let mut in_file_header = false;
	let mut saw_git_header = false;

	for line in content.lines() {
		if line.starts_with("diff --git ") {
			if pending_rename_from.is_some() {
				return Err("The patch contains an incomplete rename.".to_string());
			}

			in_file_header = true;
			saw_git_header = true;
			previous_header = None;
			continue;
		}

		if !in_file_header {
			continue;
		}

		if line.starts_with("@@") {
			in_file_header = false;
			previous_header = None;
			continue;
		}

		if let Some(value) = line.strip_prefix("rename from ") {
			pending_rename_from = Some(normalize_declared_patch_path(
				value,
				false,
			)?);
			continue;
		}

		if let Some(value) = line.strip_prefix("rename to ") {
			let source = pending_rename_from
				.take()
				.ok_or_else(|| "The patch contains an incomplete rename.".to_string())?;
			let destination = normalize_declared_patch_path(
				value,
				false,
			)?;

			rename_sources.insert(
				path_key(&destination),
				source,
			);
			continue;
		}

		if let Some(value) = line.strip_prefix("--- ") {
			previous_header = if value == "/dev/null" {
				None
			} else {
				Some(normalize_declared_patch_path(
					value,
					true,
				)?)
			};
			continue;
		}

		if let Some(value) = line.strip_prefix("+++ ") {
			if value == "/dev/null" {
				let deleted = previous_header
					.take()
					.ok_or_else(|| "The patch contains a deletion without a valid source path.".to_string())?;

				deleted_paths.insert(path_key(&deleted));
			} else {
				let _ = normalize_declared_patch_path(
					value,
					true,
				)?;
				previous_header = None;
			}
		}
	}

	if !saw_git_header {
		return Err("Git Mode requires a Git unified diff patch with diff --git headers.".to_string());
	}

	if pending_rename_from.is_some() {
		return Err("The patch contains an incomplete rename.".to_string());
	}

	Ok(PatchMetadata {
		rename_sources,
		deleted_paths,
	})
}

fn repository_layout(root: &Path) -> Result<(PathBuf, PathBuf), String> {
	let top_level = run_git(
		root,
		&[
			"rev-parse",
			"--show-toplevel",
		],
	)?;
	let repository_root = canonicalize_existing(Path::new(&top_level))?;
	let relative = root
		.strip_prefix(&repository_root)
		.map_err(|_| "The selected folder is not inside the root reported by Git.".to_string())?
		.to_path_buf();

	Ok((
		repository_root,
		relative,
	))
}

fn patch_fingerprint(patch_bytes: &[u8]) -> String {
	const HEX: &[u8; 16] = b"0123456789abcdef";
	let digest = Sha256::digest(patch_bytes);
	let mut output = String::with_capacity(digest.len() * 2);
	for byte in digest {
		output.push(HEX[(byte >> 4) as usize] as char);
		output.push(HEX[(byte & 0x0f) as usize] as char);
	}
	output
}

fn validate_patch_targets(
	root: &Path,
	affected_paths: &[String],
) -> Result<(), String> {
	let project_ignore = ProjectIgnore::load(root)?;

	for relative_path in affected_paths {
		let relative = Path::new(relative_path);
		safe_fs::validate_project_relative_path(root, relative)?;
		let candidate = root.join(relative);

		if project_ignore.is_ignored(
			&candidate,
			false,
		) {
			return Err(format!(
				"The patch attempts to modify an item ignored by .orqeto-devignore: {relative_path}.",
			));
		}

		match fs::symlink_metadata(&candidate) {
			Ok(metadata) if safe_fs::metadata_is_link_or_reparse(&metadata) => {
				return Err(format!(
					"The patch attempts to modify an unsupported symbolic link/junction: {relative_path}.",
				));
			}
			Ok(metadata) if !metadata.is_file() => {
				return Err(format!(
					"The patch attempts to use a destination that is not a regular file: {relative_path}.",
				));
			}
			Ok(_) => {}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {}
			Err(error) => {
				return Err(format!(
					"Could not validate {relative_path}: {error}",
				));
			}
		}
	}

	Ok(())
}

fn parse_count(value: &[u8]) -> Result<usize, String> {
	if value == b"-" {
		return Err("Binary patches are not accepted in Git Mode.".to_string());
	}

	let text = std::str::from_utf8(value)
		.map_err(|_| "Git returned an invalid patch statistic.".to_string())?;

	text.parse::<usize>()
		.map_err(|_| "Git returned an invalid patch statistic.".to_string())
}

fn normalize_git_patch_path(
	repository_path: &[u8],
	root_relative_to_repository: &Path,
) -> Result<String, String> {
	let text = std::str::from_utf8(repository_path)
		.map_err(|_| "The patch contains a file name that is not UTF-8.".to_string())?;
	let path = PathBuf::from(text);
	let relative = if root_relative_to_repository.as_os_str().is_empty() {
		path.as_path()
	} else {
		path.strip_prefix(root_relative_to_repository)
			.map_err(|_| "The patch attempts to modify a file outside the folder selected in Orqeto Dev.".to_string())?
	};

	if relative.as_os_str().is_empty() {
		return Err("The patch contains an empty file path.".to_string());
	}

	for component in relative.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("The patch contains an unsafe path: {}.", relative.display()));
		}
	}

	Ok(relative.to_string_lossy().replace('\\', "/"))
}

