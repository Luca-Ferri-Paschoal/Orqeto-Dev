fn mark_recovery_file_applied(
	snapshot: &mut UndoSnapshot,
	relative_path: &Path,
	state: Option<FileFingerprint>,
	replace_expected_after: bool,
) -> Result<(), String> {
	let file = snapshot
		.files
		.iter_mut()
		.find(|file| file.destination_relative_path == relative_path)
		.ok_or_else(|| "The recovery journal lost an operation file.".to_string())?;

	file.recovery_applied = true;
	if !file.recovery_allowed_states.contains(&state) {
		file.recovery_allowed_states.push(state);
	}
	if replace_expected_after {
		file.applied_fingerprint = state;
	}

	write_recovery_journal(snapshot)
}

fn remove_recovery_journal_file(snapshot: &UndoSnapshot) -> Result<(), String> {
	let path = snapshot_primary_directory(snapshot)?.join(RECOVERY_FILE_NAME);
	match fs::remove_file(&path) {
		Ok(()) => Ok(()),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
		// The durable committed marker is already safe. Keeping it is preferable
		// to rolling back a committed operation merely because cleanup failed.
		Err(_) => Ok(()),
	}
}

fn mark_snapshot_active_undo(snapshot: &UndoSnapshot) -> Result<(), String> {
	for directory in &snapshot.backup_directories {
		storage::set_snapshot_active_undo(directory)?;
	}
	Ok(())
}

fn clear_recovery_journal(snapshot: &UndoSnapshot) -> Result<(), String> {
	if snapshot.backup_directories.is_empty() ||
		(snapshot.files.is_empty() && snapshot.created_directories.is_empty() && snapshot.deleted_directories.is_empty())
	{
		return Ok(());
	}

	// Persist the commit decision before changing the storage class. The storage
	// class is changed before journal cleanup so a crash can never turn a
	// completed Undo/application snapshot into ordinary stale storage.
	write_recovery_journal_state(snapshot, true)?;
	mark_snapshot_active_undo(snapshot)?;
	remove_recovery_journal_file(snapshot)
}

fn commit_application_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	if snapshot.backup_directories.is_empty() ||
		(snapshot.files.is_empty() && snapshot.deleted_directories.is_empty())
	{
		return Err("A completed application has no persistent Undo snapshot.".to_string());
	}

	// Keep the recovery journal uncommitted until the application-history record
	// is durable. A crash or write failure before that point therefore rolls the
	// project back instead of leaving applied bytes without persistent history.
	persist_undo_snapshot(snapshot)?;
	write_recovery_journal_state(snapshot, true)?;
	mark_snapshot_active_undo(snapshot)?;
	remove_recovery_journal_file(snapshot)
}

fn recovery_current_state(
	root: &Path,
	relative: &Path,
) -> Result<Option<FileFingerprint>, String> {
	let exists = validate_destination_entry(root, relative, false)?;
	if !exists {
		return Ok(None);
	}

	file_fingerprint(&root.join(relative)).map(Some)
}

fn validated_backup_path(
	backup_path: &Path,
	backup_blob_id: Option<&str>,
) -> Result<PathBuf, String> {
	match backup_blob_id {
		Some(blob_id) => storage::blob_path(blob_id),
		None => {
			storage::validate_managed_regular_file(backup_path)?;
			Ok(backup_path.to_path_buf())
		}
	}
}

fn validated_undo_backup_path(kind: &UndoFileKind) -> Result<Option<PathBuf>, String> {
	let UndoFileKind::Replaced { backup_path, backup_blob_id } = kind else {
		return Ok(None);
	};
	validated_backup_path(
		backup_path,
		backup_blob_id.as_deref(),
	)
	.map(Some)
}

fn revalidate_backup_before_commit(
	backup_path: &Path,
	backup_blob_id: Option<&str>,
	expected_fingerprint: FileFingerprint,
) -> std::io::Result<()> {
	let current_path = validated_backup_path(
		backup_path,
		backup_blob_id,
	)
	.map_err(std::io::Error::other)?;
	if current_path != backup_path {
		return Err(std::io::Error::other(
			"the backup path changed before commit",
		));
	}
	let current_fingerprint = file_fingerprint(&current_path)
		.map_err(std::io::Error::other)?;
	if current_fingerprint != expected_fingerprint {
		return Err(std::io::Error::other(
			"the backup content changed before commit",
		));
	}
	Ok(())
}

fn revalidate_undo_backup_before_commit(
	kind: &UndoFileKind,
	backup_path: &Path,
	expected_fingerprint: FileFingerprint,
) -> std::io::Result<()> {
	let UndoFileKind::Replaced { backup_blob_id, .. } = kind else {
		return Err(std::io::Error::other(
			"the snapshot has no replacement backup",
		));
	};
	revalidate_backup_before_commit(
		backup_path,
		backup_blob_id.as_deref(),
		expected_fingerprint,
	)
}

fn revalidate_destination_before_commit(
	root: &Path,
	relative_path: &Path,
	expected_state: Option<FileFingerprint>,
) -> std::io::Result<()> {
	let current = recovery_current_state(
		root,
		relative_path,
	)
	.map_err(std::io::Error::other)?;
	if current != expected_state {
		return Err(std::io::Error::other(
			"the destination changed before the restore commit",
		));
	}
	Ok(())
}

fn read_recovery_journal(directory: &Path) -> Result<RecoveryJournal, String> {
	storage::validate_managed_directory(directory)?;
	let journal_path = directory.join(RECOVERY_FILE_NAME);
	storage::validate_managed_regular_file(&journal_path)?;
	let content = fs::read(&journal_path)
		.map_err(|error| format!("Could not read {}: {error}", journal_path.display()))?;
	let journal: RecoveryJournal = serde_json::from_slice(&content)
		.map_err(|error| format!("The recovery journal is invalid: {error}"))?;

	if journal.format != RECOVERY_FORMAT ||
		!matches!(journal.version, 3 | 4 | RECOVERY_VERSION)
	{
		return Err("The recovery journal uses an unsupported format or version.".to_string());
	}
	Ok(journal)
}

fn restore_recovery_directory(directory: &Path) -> Result<(), String> {
	let journal = read_recovery_journal(directory)?;
	if journal.committed {
		return Ok(());
	}

	let root = canonicalize_existing(&journal.root)?;
	if !root.is_dir() {
		return Err("The project folder required for recovery no longer exists.".to_string());
	}

	restore_deleted_directories(&root, &journal.deleted_directories)?;

	for entry in journal.entries.iter().rev() {
		let relative = parse_relative_path(&entry.relative_path.to_string_lossy())?;
		let destination = root.join(&relative);
		let current = recovery_current_state(&root, &relative)?;

		if entry.existed {
			let backup = match entry.backup_blob_id.as_deref() {
				Some(blob_id) => storage::blob_path(blob_id)?,
				None => directory.join("replaced").join(&relative),
			};
			storage::validate_managed_regular_file(&backup).map_err(|error| {
				format!(
					"The backup required to recover {} is not safely available: {error}",
					normalize_relative_display(&relative),
				)
			})?;
			let before = file_fingerprint(&backup)?;

			if current == Some(before) {
				continue;
			}
			if !entry.after_state_known {
				return Err(format!(
					"{} changed during an interrupted operation and the expected final state could not be confirmed. The backup was preserved for manual recovery.",
					normalize_relative_display(&relative),
				));
			}
			let state_is_known = current == entry.expected_after || entry.allowed_states.contains(&current);
			if !state_is_known {
				return Err(format!(
					"{} matches neither the previous state nor the state produced by Orqeto. Automatic recovery was stopped to preserve the external change.",
					normalize_relative_display(&relative),
				));
			}

			let backup_blob_id = entry.backup_blob_id.clone();
			let backup_for_check = backup.clone();
			let expected_destination_state = current;
			safe_fs::atomic_copy_checked(
				&backup,
				&destination,
				|| {
					revalidate_destination_before_commit(
						&root,
						&relative,
						expected_destination_state,
					)?;
					revalidate_backup_before_commit(
						&backup_for_check,
						backup_blob_id.as_deref(),
						before,
					)
				},
			)
			.map_err(|error| format!("Could not recover {}: {error}", destination.display()))?;
			let restored = file_fingerprint(&destination)?;
			if restored != before {
				return Err(format!(
					"Recovery of {} produced bytes different from the validated backup.",
					normalize_relative_display(&relative),
				));
			}
		} else {
			let Some(current) = current else {
				continue;
			};
			if !entry.after_state_known {
				return Err(format!(
					"{} exists after an interrupted operation whose final state could not be confirmed. The file was preserved to prevent data loss.",
					normalize_relative_display(&relative),
				));
			}
			let current_state = Some(current);
			let state_is_known = entry.expected_after == current_state || entry.allowed_states.contains(&current_state);
			if !state_is_known {
				return Err(format!(
					"{} was created or changed outside the expected state. Automatic recovery preserved the file.",
					normalize_relative_display(&relative),
				));
			}

			fs::remove_file(&destination)
				.map_err(|error| format!("Could not recover {}: {error}", destination.display()))?;
		}
	}

	let mut created_directories = journal.created_directories;
	created_directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
	for relative in created_directories {
		let relative = parse_relative_path(&relative.to_string_lossy())?;
		let _ = fs::remove_dir(root.join(relative));
	}

	Ok(())
}

