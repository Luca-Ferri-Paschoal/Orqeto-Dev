fn planned_files(
	root: &Path,
	manifest: &OverlayManifest,
	destination_relative_path: &Path,
	source_prefix: &Path,
) -> Result<Vec<PlannedFile>, String> {
	let destination_base = root.join(destination_relative_path);

	if destination_relative_path.as_os_str().is_empty() {
		if destination_base != root {
			return Err("The calculated root destination is invalid.".to_string());
		}
	} else {
		validate_destination_entry(
			root,
			destination_relative_path,
			true,
		)?;
	}

	if !matches!(&manifest.kind, ManifestKind::Zip { .. }) && !source_prefix.as_os_str().is_empty() {
		return Err("Only ZIP sources accept an internal prefix.".to_string());
	}

	let project_ignore = ProjectIgnore::load(root)?;
	let mut seen_destinations = HashSet::new();
	let mut files = Vec::new();

	for (source_index, file) in manifest.files.iter().enumerate() {
		let stripped = strip_source_prefix(
			&file.relative_path,
			source_prefix,
		)
		.ok_or_else(|| "The selected destination does not match the source structure.".to_string())?;

		if stripped.as_os_str().is_empty() {
			return Err("The selected destination produces an empty file path.".to_string());
		}

		let destination_relative = destination_relative_path.join(stripped);
		ensure_separate_deletion_modes(&destination_relative, &manifest.permanent_delete_directories)?;
		let normalized = destination_relative
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if !seen_destinations.insert(normalized) {
			return Err("The application would generate two files at the same path.".to_string());
		}

		let was_replaced = validate_destination_entry(
			root,
			&destination_relative,
			false,
		)?;
		let destination = root.join(&destination_relative);

		if project_ignore.is_ignored(
			&destination,
			false,
		) {
			return Err(format!(
				"Destination {} is protected by .orqeto-devignore and cannot be changed.",
				normalize_relative_display(&destination_relative),
			));
		}

		files.push(PlannedFile {
			destination_relative_path: destination_relative,
			source_index,
			was_replaced,
		});
	}

	Ok(files)
}

fn normalized_relative_key(path: &Path) -> String {
	path.to_string_lossy()
		.replace('\\', "/")
		.to_lowercase()
}

fn planned_deletions(
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<Vec<PathBuf>, String> {
	let destinations = planned_files
		.iter()
		.map(|file| normalized_relative_key(&file.destination_relative_path))
		.collect::<HashSet<_>>();

	for delete_path in &manifest.delete_paths {
		let normalized = normalized_relative_key(delete_path);
		if destinations.contains(&normalized) {
			return Err(format!(
				"The patch attempts to apply and delete the same file: {}.",
				normalize_relative_display(delete_path),
			));
		}
	}

	for delete_directory in &manifest.delete_directories {
		let normalized = normalized_relative_key(delete_directory);
		let prefix = format!("{normalized}/");
		if destinations.iter().any(|destination| destination == &normalized || destination.starts_with(&prefix)) {
			return Err(format!(
				"The patch attempts to apply a file inside folder {} while deleting that folder.",
				normalize_relative_display(delete_directory),
			));
		}
	}

	Ok(manifest.delete_paths.clone())
}

fn collect_missing_parent_directories(
	root: &Path,
	files: &[PlannedFile],
) -> Result<Vec<PathBuf>, String> {
	let mut directories = HashSet::new();

	for file in files {
		let Some(parent) = file.destination_relative_path.parent() else {
			continue;
		};
		let mut current = PathBuf::new();

		for component in parent.components() {
			let Component::Normal(name) = component else {
				return Err("The destination structure contains an invalid path.".to_string());
			};

			current.push(name);
			let absolute = root.join(&current);

			match fs::symlink_metadata(&absolute) {
				Ok(metadata) => {
					if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
						return Err(format!(
							"Path {} cannot receive the patch.",
							absolute.display(),
						));
					}
				}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					directories.insert(current.clone());
				}
				Err(error) => {
					return Err(format!(
						"Could not validate {}: {error}",
						absolute.display(),
					));
				}
			}
		}
	}

	let mut values = directories.into_iter().collect::<Vec<_>>();
	values.sort_by_key(|path| path.components().count());
	Ok(values)
}

fn create_backup_directory(root: &Path) -> Result<PathBuf, String> {
	persistence_failure_checkpoint(PersistenceFailurePoint::Snapshot)?;
	storage::create_snapshot_directory(root)
}

