fn write_manifest_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
	snapshot: &mut UndoSnapshot,
) -> Result<(), String> {
	match &manifest.kind {
		ManifestKind::Directory { source_root, .. } => {
			if !source_root.is_dir() {
				return Err("The folder used as the source is no longer available.".to_string());
			}

			for planned in planned_files {
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
				write_directory_manifest_file(
					root,
					manifest,
					planned,
					&destination,
					&original_kind,
				)?;
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
						"The source for {} changed during application. The operation was stopped to preserve the validated version.",
						normalize_relative_display(&planned.destination_relative_path),
					));
				}
			}
		}
		ManifestKind::File { source_file, .. } => {
			if !source_file.is_file() {
				return Err("The file used as the source is no longer available.".to_string());
			}

			for planned in planned_files {
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
				write_directory_manifest_file(
					root,
					manifest,
					planned,
					&destination,
					&original_kind,
				)?;
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
						"The source for {} changed during application. The operation was stopped to preserve the validated version.",
						normalize_relative_display(&planned.destination_relative_path),
					));
				}
			}
		}
		ManifestKind::Zip { .. } => write_zip_manifest_files(
			root,
			manifest,
			planned_files,
			snapshot,
		)?,
	}

	Ok(())
}

fn build_undo_snapshot(
	root: &Path,
	operation_id: String,
	applied_at_unix_ms: u64,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
	deleted_directories: Vec<PathBuf>,
	created_directories: Vec<PathBuf>,
	backup_directory: PathBuf,
	backups: &HashMap<PathBuf, storage::StoredBackup>,
) -> Result<UndoSnapshot, String> {
	let mut files = Vec::new();

	for planned in planned_files {
		let destination = root.join(&planned.destination_relative_path);
		let applied_fingerprint = Some(file_fingerprint(&destination)?);
		let kind = if planned.was_replaced {
			let backup = backups
				.get(&planned.destination_relative_path)
				.ok_or_else(|| "The snapshot lost a replaced-file backup.".to_string())?;
			UndoFileKind::Replaced {
				backup_path: backup.path.clone(),
				backup_blob_id: Some(backup.blob_id.clone()),
			}
		} else {
			UndoFileKind::Created
		};

		files.push(UndoFile {
			destination_relative_path: planned.destination_relative_path.clone(),
			kind,
			applied_fingerprint,
			recovery_applied: true,
			recovery_allowed_states: vec![applied_fingerprint],
		});
	}

	for delete_path in delete_paths {
		let backup = backups
			.get(delete_path)
			.ok_or_else(|| "The snapshot lost a deleted-file backup.".to_string())?;
		files.push(UndoFile {
			destination_relative_path: delete_path.clone(),
			kind: UndoFileKind::Replaced {
				backup_path: backup.path.clone(),
				backup_blob_id: Some(backup.blob_id.clone()),
			},
			applied_fingerprint: None,
			recovery_applied: true,
			recovery_allowed_states: vec![None],
		});
	}

	Ok(UndoSnapshot {
		root: root.to_path_buf(),
		operation_id,
		backup_directories: vec![backup_directory],
		files,
		created_directories,
		deleted_directories,
		applied_at_unix_ms,
		source_kind: UndoSourceKind::Files,
		source_label: None,
		source_fingerprints: Vec::new(),
		added_lines: None,
		deleted_lines: None,
		recovery_after_state_known: true,
	})
}

fn remove_empty_created_directories(
	root: &Path,
	created_directories: &[PathBuf],
) {
	let mut directories = created_directories.to_vec();
	directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

	for relative in directories {
		let absolute = root.join(relative);
		let _ = fs::remove_dir(absolute);
	}
}

fn rollback_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	let mut failures = Vec::new();

	if let Err(error) = restore_deleted_directories(&snapshot.root, &snapshot.deleted_directories) {
		failures.push(error);
	}

	for file in snapshot.files.iter().rev() {
		let destination = snapshot.root.join(&file.destination_relative_path);
		let current = match recovery_current_state(&snapshot.root, &file.destination_relative_path) {
			Ok(state) => state,
			Err(error) => {
				failures.push(format!("{}: {error}", destination.display()));
				continue;
			}
		};

		let result = match &file.kind {
			UndoFileKind::Created => match current {
				None => Ok(()),
				Some(current_fingerprint)
					if file.recovery_applied &&
						snapshot.recovery_after_state_known &&
						(file.applied_fingerprint == Some(current_fingerprint) ||
							file.recovery_allowed_states.contains(&Some(current_fingerprint))) =>
				{
					fs::remove_file(&destination)
				}
				Some(_) => Err(std::io::Error::other(
					"the current file does not match the content produced by this operation",
				)),
			},
			UndoFileKind::Replaced { .. } => {
				let backup_path = match validated_undo_backup_path(&file.kind) {
					Ok(Some(path)) => path,
					Ok(None) => unreachable!(),
					Err(error) => {
						failures.push(format!("{}: {error}", destination.display()));
						continue;
					}
				};
				let before = match file_fingerprint(&backup_path) {
					Ok(fingerprint) => fingerprint,
					Err(error) => {
						failures.push(format!("{}: {error}", destination.display()));
						continue;
					}
				};
				if current == Some(before) {
					Ok(())
				} else if file.recovery_applied &&
					snapshot.recovery_after_state_known &&
					(current == file.applied_fingerprint || file.recovery_allowed_states.contains(&current))
				{
					safe_fs::atomic_copy_checked(
						&backup_path,
						&destination,
						|| {
							revalidate_destination_before_commit(
								&snapshot.root,
								&file.destination_relative_path,
								current,
							)?;
							revalidate_undo_backup_before_commit(
								&file.kind,
								&backup_path,
								before,
							)
						},
					)
					.map(|_| ())
				} else {
					Err(std::io::Error::other(
						"the current file does not match the state produced by this operation",
					))
				}
			}
		};

		if let Err(error) = result {
			failures.push(format!("{}: {error}", destination.display()));
		}
	}

	if !failures.is_empty() {
		return Err(format!(
			"Safety restoration could not be completed. Backups were preserved. {}",
			failures.join(" | "),
		));
	}

	clear_recovery_journal(snapshot)?;
	remove_empty_created_directories(&snapshot.root, &snapshot.created_directories);
	Ok(())
}

