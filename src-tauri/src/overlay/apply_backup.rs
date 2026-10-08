fn estimate_snapshot_backup_bytes(
	root: &Path,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
) -> Result<u64, String> {
	let replaced_paths = planned_files
		.iter()
		.filter(|file| file.was_replaced)
		.map(|file| file.destination_relative_path.as_path())
		.chain(delete_paths.iter().map(PathBuf::as_path));
	let mut total = 0_u64;
	for relative_path in replaced_paths {
		let source = root.join(relative_path);
		let metadata = fs::symlink_metadata(&source)
			.map_err(|error| format!("Could not estimate the snapshot for {}: {error}", source.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!("{} cannot be preserved in a safe snapshot.", source.display()));
		}
		total = total
			.checked_add(metadata.len())
			.ok_or_else(|| "The size required for the snapshot exceeded the numeric limit.".to_string())?;
	}
	Ok(total)
}

fn backup_replaced_files(
	root: &Path,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
	backup_directory: &Path,
) -> Result<HashMap<PathBuf, storage::StoredBackup>, String> {
	let replaced_paths = planned_files
		.iter()
		.filter(|file| file.was_replaced)
		.map(|file| file.destination_relative_path.clone())
		.chain(delete_paths.iter().cloned());
	let mut backups = HashMap::new();

	for relative_path in replaced_paths {
		let source = root.join(&relative_path);
		let backup = storage::store_stable_backup(
			&source,
			backup_directory,
		)
		.map_err(|error| format!("Could not save {} in the snapshot: {error}", source.display()))?;
		backups.insert(relative_path, backup);
	}

	Ok(backups)
}

fn validate_original_state(
	root: &Path,
	relative_path: &Path,
	kind: &UndoFileKind,
) -> Result<(), String> {
	let destination = root.join(relative_path);
	let exists = validate_destination_entry(root, relative_path, false)?;

	match kind {
		UndoFileKind::Created => {
			if exists {
				return Err(format!(
					"{} appeared after analysis. The operation was cancelled to preserve the external change.",
					normalize_relative_display(relative_path),
				));
			}
		}
		UndoFileKind::Replaced { .. } => {
			if !exists {
				return Err(format!(
					"{} was removed after analysis. The operation was cancelled.",
					normalize_relative_display(relative_path),
				));
			}
			let backup_path = validated_undo_backup_path(kind)?
				.ok_or_else(|| "The replacement snapshot lost the required backup.".to_string())?;
			let expected = file_fingerprint(&backup_path)?;
			let current = file_fingerprint(&destination)?;
			if expected != current {
				return Err(format!(
					"{} changed after analysis. The operation was cancelled to preserve the external change.",
					normalize_relative_display(relative_path),
				));
			}
		}
	}

	Ok(())
}

fn write_directory_manifest_file(
	root: &Path,
	manifest: &OverlayManifest,
	planned: &PlannedFile,
	destination: &Path,
	original_kind: &UndoFileKind,
) -> Result<(), String> {
	let file = manifest
		.files
		.get(planned.source_index)
		.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
	let ManifestFileSource::Directory(source) = &file.source else {
		return Err("The patch source was interpreted with an invalid type.".to_string());
	};

	safe_fs::create_project_parent_directories(
		root,
		&planned.destination_relative_path,
	)
	.map_err(|error| {
		format!(
			"Could not safely prepare the directory for {}: {error}",
			destination.display(),
		)
	})?;

	let validate_commit = || {
		validate_original_state(
			root,
			&planned.destination_relative_path,
			original_kind,
		)
		.map_err(std::io::Error::other)
	};
	let result = if planned.was_replaced {
		safe_fs::atomic_copy_preserve_destination_checked(
			source,
			destination,
			validate_commit,
		)
	} else {
		safe_fs::atomic_copy_create_new_checked(
			source,
			destination,
			validate_commit,
		)
	};
	result.map_err(|error| {
		format!(
			"Could not apply {} to {}: {error}",
			source.display(),
			destination.display(),
		)
	})?;
	Ok(())
}

fn write_zip_manifest_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
	snapshot: &mut UndoSnapshot,
) -> Result<(), String> {
	let ManifestKind::Zip { archive_path } = &manifest.kind else {
		return Err("The ZIP source was interpreted with an invalid type.".to_string());
	};
	let archive_file = File::open(archive_path)
		.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
	let mut archive = ZipArchive::new(archive_file)
		.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;

	for planned in planned_files {
		let manifest_file = manifest
			.files
			.get(planned.source_index)
			.ok_or_else(|| "The ZIP source file is no longer available.".to_string())?;
		let ManifestFileSource::Zip(index) = &manifest_file.source else {
			return Err("The ZIP source was interpreted with an invalid type.".to_string());
		};
		let (expected_fingerprint, original_kind) = {
			let snapshot_file = snapshot
				.files
				.iter()
				.find(|file| file.destination_relative_path == planned.destination_relative_path)
				.ok_or_else(|| "The application plan lost its safety snapshot.".to_string())?;
			validate_original_state(root, &planned.destination_relative_path, &snapshot_file.kind)?;
			(
				snapshot_file.applied_fingerprint,
				snapshot_file.kind.clone(),
			)
		};
		let destination = root.join(&planned.destination_relative_path);
		safe_fs::create_project_parent_directories(
			root,
			&planned.destination_relative_path,
		)
		.map_err(|error| {
			format!(
				"Could not safely prepare the directory for {}: {error}",
				destination.display(),
			)
		})?;
		let mut source = archive
			.by_index(*index)
			.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;

		let validate_commit = || {
			validate_original_state(
				root,
				&planned.destination_relative_path,
				&original_kind,
			)
			.map_err(std::io::Error::other)
		};
		let result = if planned.was_replaced {
			safe_fs::atomic_write_from_reader_checked(
				&destination,
				&mut source,
				validate_commit,
			)
		} else {
			safe_fs::atomic_write_from_reader_create_new_checked(
				&destination,
				&mut source,
				validate_commit,
			)
		};
		result.map_err(|error| format!("Could not write {}: {error}", destination.display()))?;

		let actual_fingerprint = file_fingerprint(&destination)?;
		mark_recovery_file_applied(
			snapshot,
			&planned.destination_relative_path,
			Some(actual_fingerprint),
			true,
		)?;
		mutation_failure_checkpoint()?;
		if expected_fingerprint != Some(actual_fingerprint) {
			return Err(format!(
				"The source entry for {} changed during application. The operation was stopped to avoid writing content different from what was validated.",
				normalize_relative_display(&planned.destination_relative_path),
			));
		}
	}

	Ok(())
}

