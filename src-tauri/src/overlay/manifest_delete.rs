fn delete_manifest_size_error(size_bytes: u64) -> String {
	format!(
		"File {DELETE_MANIFEST_FILE_NAME} is {size_bytes} bytes, above the {MAX_DELETE_MANIFEST_BYTES}-byte safety limit. Folder paths are supported; use one folder path instead of listing every child when deleting a directory tree.",
	)
}

fn delete_manifest_path_count_error(path_count: usize) -> String {
	format!(
		"File {DELETE_MANIFEST_FILE_NAME} contains {path_count} delete entries, above the safety limit of {MAX_DELETE_MANIFEST_PATHS}. Folder paths are supported and safely expand to their contained files and folders.",
	)
}

fn parse_delete_manifest_content(
	root: &Path,
	content: &str,
) -> Result<DeleteManifestPlan, String> {
	let document = serde_json::from_str::<DeleteManifestDocument>(content)
		.map_err(|error| format!("File {DELETE_MANIFEST_FILE_NAME} does not contain valid JSON: {error}"))?;

	if document.format != DELETE_MANIFEST_FORMAT || document.version != DELETE_MANIFEST_VERSION {
		return Err(format!(
			"File {DELETE_MANIFEST_FILE_NAME} does not contain the expected format identifier.",
		));
	}

	let declared_count = document.delete.len().saturating_add(document.delete_permanent.len());
	if declared_count > MAX_DELETE_MANIFEST_PATHS {
		return Err(delete_manifest_path_count_error(declared_count));
	}
	let permanent_directories = parse_permanent_directory_paths(root, &document.delete_permanent)?;

	let project_ignore = ProjectIgnore::load(root)?;
	let mut requested = HashSet::new();
	let mut files = HashSet::new();
	let mut directories = HashSet::new();

	for value in document.delete {
		let has_invalid_segment = value
			.split('/')
			.any(|segment| segment.is_empty() || segment == "." || segment == "..");

		if value.is_empty() || value.trim() != value || value.contains('\\') || has_invalid_segment {
			return Err(format!(
				"File {DELETE_MANIFEST_FILE_NAME} contains a path outside the expected format: {value}.",
			));
		}

		let relative_path = parse_relative_path(&value)?;
		if relative_path.as_os_str().is_empty() {
			return Err(format!(
				"File {DELETE_MANIFEST_FILE_NAME} contains an empty path.",
			));
		}

		let normalized = value.to_lowercase();
		if !requested.insert(normalized) {
			return Err(format!(
				"File {DELETE_MANIFEST_FILE_NAME} repeats path {value}.",
			));
		}

		safe_fs::validate_project_relative_path(root, &relative_path)?;
		ensure_separate_deletion_modes(&relative_path, &permanent_directories)?;
		let requested_path = root.join(&relative_path);
		let metadata = fs::symlink_metadata(&requested_path).map_err(|error| {
			if error.kind() == std::io::ErrorKind::NotFound {
				format!("The path marked for deletion does not exist in the project: {value}.")
			} else {
				format!("Could not validate the path marked for deletion {value}: {error}")
			}
		})?;

		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!(
				"The path marked for deletion is a symbolic link or junction and was rejected: {value}.",
			));
		}

		let absolute = canonicalize_existing(&requested_path)?;
		if !absolute.starts_with(root) {
			return Err(format!(
				"The path marked for deletion escapes the project root: {value}.",
			));
		}

		if metadata.is_file() {
			if project_ignore.is_ignored(&absolute, false) {
				return Err(format!(
					"The file marked for deletion is protected by .orqeto-devignore: {value}.",
				));
			}
			files.insert(relative_path);
			continue;
		}

		if metadata.is_dir() {
			if project_ignore.is_ignored(&absolute, true) {
				return Err(format!(
					"The folder marked for deletion is protected by .orqeto-devignore: {value}.",
				));
			}
			collect_delete_directory_tree(
				root,
				&absolute,
				&project_ignore,
				&mut files,
				&mut directories,
			)?;
			continue;
		}

		return Err(format!(
			"The path marked for deletion is neither a safe regular file nor a safe folder: {value}.",
		));
	}

	let mut files = files.into_iter().collect::<Vec<_>>();
	files.sort();
	let mut directories = directories.into_iter().collect::<Vec<_>>();
	directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

	Ok(DeleteManifestPlan { files, directories, permanent_directories })
}

fn read_delete_manifest_file(
	root: &Path,
	path: &Path,
) -> Result<DeleteManifestPlan, String> {
	let metadata = fs::metadata(path)
		.map_err(|error| format!("Could not read {DELETE_MANIFEST_FILE_NAME}: {error}"))?;

	if metadata.len() > MAX_DELETE_MANIFEST_BYTES {
		return Err(delete_manifest_size_error(metadata.len()));
	}

	let content = fs::read_to_string(path)
		.map_err(|error| format!("Could not read {DELETE_MANIFEST_FILE_NAME} as UTF-8: {error}"))?;

	parse_delete_manifest_content(root, &content)
}

fn normalize_zip_entry_path(path: &Path) -> Result<PathBuf, String> {
	let mut normalized = PathBuf::new();

	for component in path.components() {
		match component {
			Component::Normal(value) => normalized.push(value),
			Component::CurDir => {}
			Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
				return Err(format!(
					"Path {} is not valid inside the ZIP.",
					path.display(),
				));
			}
		}
	}

	Ok(normalized)
}

fn validate_destination_entry(
	root: &Path,
	relative_path: &Path,
	is_directory: bool,
) -> Result<bool, String> {
	if !relative_path.as_os_str().is_empty() {
		safe_fs::validate_project_relative_path(root, relative_path)?;
	}
	let mut current = root.to_path_buf();
	let mut components = relative_path.components().peekable();

	while let Some(component) = components.next() {
		let Component::Normal(name) = component else {
			return Err(format!(
				"Path {} is not valid for application.",
				relative_path.display(),
			));
		};

		current.push(name);
		let is_last = components.peek().is_none();

		match fs::symlink_metadata(&current) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) {
					return Err(format!(
						"Destination {} uses a symbolic link or junction and cannot be overwritten.",
						current.display(),
					));
				}

				if is_last {
					if is_directory {
						if !metadata.is_dir() {
							return Err(format!(
								"Destination {} already exists as a file.",
								current.display(),
							));
						}
						return Ok(false);
					}

					if metadata.is_dir() {
						return Err(format!(
							"Destination {} already exists as a folder.",
							current.display(),
						));
					}
					return Ok(true);
				}

				if !metadata.is_dir() {
					return Err(format!(
						"Path {} blocks creation of the patch structure.",
						current.display(),
					));
				}
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
			Err(error) => {
				return Err(format!(
					"Could not validate destination {}: {error}",
					current.display(),
				));
			}
		}
	}

	Ok(false)
}

fn overlay_traversal_limit_error(
	context: &str,
	error: TraversalLimitExceeded,
) -> String {
	match error.kind {
		TraversalLimitKind::Files => format!("{context} exceeds the limit of {} files per operation.", error.limit),
		TraversalLimitKind::Directories => format!("{context} exceeds the limit of {} folders per operation.", error.limit),
		TraversalLimitKind::Entries => format!("{context} exceeds the limit of {} traversed entries per operation.", error.limit),
		TraversalLimitKind::PathBytes => format!("{context} contains a path longer than the {}-byte safe-discovery limit.", error.limit),
		TraversalLimitKind::TotalPathBytes => format!("{context} exceeds the aggregate limit of {} path bytes per operation.", error.limit),
	}
}
