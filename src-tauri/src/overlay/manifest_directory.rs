fn collect_directory_manifest_files(
	source_root: &Path,
	files: &mut Vec<ManifestFile>,
) -> Result<(), String> {
	let resource_policy = machine_resource_policy();
	let root_metadata = fs::symlink_metadata(source_root)
		.map_err(|error| format!("Could not read {}: {error}", source_root.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&root_metadata) || !root_metadata.is_dir() {
		return Err("The selected source must be a safe regular folder.".to_string());
	}

	let mut budget = TraversalBudget::default();
	budget
		.record_path(source_root, PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
	budget
		.record_directory(PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;

	let root_entries = fs::read_dir(source_root)
		.map_err(|error| format!("Could not list {}: {error}", source_root.display()))?;
	let mut stack = Vec::with_capacity(resource_policy.worker_count.saturating_mul(4).max(4));
	stack.push((source_root.to_path_buf(), root_entries));

	while !stack.is_empty() {
		let next = stack
			.last_mut()
			.and_then(|(_, entries)| entries.next());

		let Some(next) = next else {
			stack.pop();
			continue;
		};
		let entry = next.map_err(|error| {
			let directory = stack
				.last()
				.map(|(path, _)| path.as_path())
				.unwrap_or(source_root);
			format!(
				"Could not read an entry from {}: {error}",
				directory.display(),
			)
		})?;
		let path = entry.path();
		budget
			.record_entry(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
		budget
			.record_path(&path, PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;

		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| format!("Could not read {}: {error}", path.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!(
				"Item {} is a symbolic link or junction and cannot be applied.",
				path.display(),
			));
		}

		if metadata.is_file() {
			budget
				.record_file(PROJECT_DISCOVERY_LIMITS)
				.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
			let canonical_path = canonicalize_existing(&path)?;
			if !canonical_path.starts_with(source_root) {
				return Err(format!(
					"Item {} points outside the folder used as the source.",
					path.display(),
				));
			}
			let relative_path = canonical_path
				.strip_prefix(source_root)
				.map_err(|_| "Could not calculate the patch-relative path.".to_string())?
				.to_path_buf();
			files.push(ManifestFile {
				relative_path,
				source: ManifestFileSource::Directory(canonical_path),
			});
			continue;
		}

		if !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				path.display(),
			));
		}

		budget
			.record_directory(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
		let canonical_path = canonicalize_existing(&path)?;
		if !canonical_path.starts_with(source_root) {
			return Err(format!(
				"Item {} points outside the folder used as the source.",
				path.display(),
			));
		}
		let child_entries = fs::read_dir(&canonical_path)
			.map_err(|error| format!("Could not list {}: {error}", canonical_path.display()))?;
		stack.push((canonical_path, child_entries));
	}

	Ok(())
}

fn path_segments(path: &Path) -> Vec<String> {
	path.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_lowercase()),
			_ => None,
		})
		.collect()
}

fn normal_components(path: &Path) -> Vec<std::ffi::OsString> {
	path.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_os_string()),
			_ => None,
		})
		.collect()
}

fn common_directory_prefixes(files: &[ManifestFile]) -> Vec<PathBuf> {
	let Some(first_file) = files.first() else {
		return Vec::new();
	};
	let first_parent = first_file
		.relative_path
		.parent()
		.unwrap_or_else(|| Path::new(""));
	let common = normal_components(first_parent);
	let mut common_length = common.len();

	for file in &files[1..] {
		let parent = file
			.relative_path
			.parent()
			.unwrap_or_else(|| Path::new(""));
		let segments = normal_components(parent);
		let shared_length = common
			.iter()
			.take(common_length)
			.zip(segments.iter())
			.take_while(|(left, right)| {
				left
					.to_string_lossy()
					.eq_ignore_ascii_case(&right.to_string_lossy())
			})
			.count();

		common_length = shared_length;

		if common_length == 0 {
			break;
		}
	}

	let mut prefixes = Vec::new();
	let mut current = PathBuf::new();

	for segment in common.into_iter().take(common_length) {
		current.push(segment);
		prefixes.push(current.clone());
	}

	prefixes
}

fn build_directory_manifest(
	root: &Path,
	source_path: &Path,
) -> Result<OverlayManifest, String> {
	let source = canonicalize_existing(source_path)?;
	ensure_overlay_source_separate(
		root,
		&source,
	)?;

	let metadata = fs::symlink_metadata(source_path)
		.map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err("Symbolic links and junctions cannot be used as a source.".to_string());
	}

	if !metadata.is_dir() {
		return Err("The selected source is not a folder.".to_string());
	}

	let mut files = Vec::new();
	collect_directory_manifest_files(
		&source,
		&mut files,
	)?;
	let mut delete_paths = Vec::new();
	let mut delete_directories = Vec::new();
	let mut permanent_delete_directories = Vec::new();
	let mut patch_files = Vec::with_capacity(files.len());
	let mut has_delete_manifest = false;

	for file in files {
		let is_delete_manifest = file
			.relative_path
			.file_name()
			.is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME));

		if !is_delete_manifest {
			patch_files.push(file);
			continue;
		}

		if normal_components(&file.relative_path).len() != 1 {
			return Err(format!(
				"Reserved file {DELETE_MANIFEST_FILE_NAME} must be at the root of the applied folder.",
			));
		}

		if has_delete_manifest {
			return Err(format!(
				"The applied folder contains more than one reserved {DELETE_MANIFEST_FILE_NAME} file.",
			));
		}

		has_delete_manifest = true;
		let ManifestFileSource::Directory(manifest_path) = &file.source else {
			return Err("The deletion manifest was interpreted with an invalid type.".to_string());
		};

		let delete_plan = read_delete_manifest_file(
			root,
			manifest_path,
		)?;
		delete_paths = delete_plan.files;
		delete_directories = delete_plan.directories;
		permanent_delete_directories = delete_plan.permanent_directories;
	}

	let mut files = patch_files;
	files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

	let source_name = source
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.ok_or_else(|| "Could not determine the applied folder name.".to_string())?;
	let source_components = source
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_string()),
			_ => None,
		})
		.collect::<Vec<_>>();
	let source_context = source_components
		.iter()
		.map(|component| component.to_lowercase())
		.collect::<Vec<_>>();

	Ok(OverlayManifest {
		kind: ManifestKind::Directory {
			source_root: source,
			source_context,
			source_components,
			source_name,
		},
		delete_paths,
		delete_directories,
		permanent_delete_directories,
		common_directory_prefixes: Vec::new(),
		files,
	})
}

