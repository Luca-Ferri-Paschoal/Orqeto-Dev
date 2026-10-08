fn restore_deleted_directories(
	root: &Path,
	deleted_directories: &[PathBuf],
) -> Result<(), String> {
	let mut directories = deleted_directories.to_vec();
	directories.sort_by_key(|path| path.components().count());
	directories.dedup();

	for relative in directories {
		safe_fs::validate_project_relative_path(root, &relative)?;
		let destination = root.join(&relative);
		match fs::symlink_metadata(&destination) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
					return Err(format!(
						"Could not safely restore deleted folder {} because the path is no longer a regular folder location.",
						normalize_relative_display(&relative),
					));
				}
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				safe_fs::create_descendant_directories_no_reparse(root, &relative)
					.map_err(|error| format!(
						"Could not restore deleted folder {}: {error}",
						normalize_relative_display(&relative),
					))?;
			}
			Err(error) => {
				return Err(format!(
					"Could not validate deleted folder {} during restore: {error}",
					normalize_relative_display(&relative),
				));
			}
		}
	}

	Ok(())
}

fn delete_manifest_entries(
	root: &Path,
	delete_paths: &[PathBuf],
	delete_directories: &[PathBuf],
	snapshot: &mut UndoSnapshot,
) -> Result<(), String> {
	for relative_path in delete_paths {
		{
			let file = snapshot
				.files
				.iter()
				.find(|file| file.destination_relative_path == *relative_path)
				.ok_or_else(|| "The deletion plan lost its safety snapshot.".to_string())?;
			validate_original_state(root, relative_path, &file.kind)?;
		}
		let destination = root.join(relative_path);
		fs::remove_file(&destination)
			.map_err(|error| format!("Could not delete {}: {error}", destination.display()))?;
		mark_recovery_file_applied(
			snapshot,
			relative_path,
			None,
			true,
		)?;
		mutation_failure_checkpoint()?;
	}

	let mut directories = delete_directories.to_vec();
	directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
	directories.dedup();
	for relative_path in directories {
		let destination = root.join(&relative_path);
		let metadata = fs::symlink_metadata(&destination)
			.map_err(|error| format!(
				"Could not validate folder {} immediately before deletion: {error}",
				normalize_relative_display(&relative_path),
			))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
			return Err(format!(
				"Folder {} changed after analysis. The operation was cancelled.",
				normalize_relative_display(&relative_path),
			));
		}
		fs::remove_dir(&destination).map_err(|error| {
			format!(
				"Could not delete folder {}. It may have changed after analysis: {error}",
				normalize_relative_display(&relative_path),
			)
		})?;
		mutation_failure_checkpoint()?;
	}

	Ok(())
}
