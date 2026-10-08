fn merge_undo_snapshots(
	mut previous: UndoSnapshot,
	current: UndoSnapshot,
) -> UndoSnapshot {
	if previous.root != current.root {
		discard_snapshot(previous);
		return current;
	}

	let mut file_indexes = previous
		.files
		.iter()
		.enumerate()
		.map(|(index, file)| (file.destination_relative_path.clone(), index))
		.collect::<HashMap<_, _>>();

	for current_file in current.files {
		if let Some(index) = file_indexes.get(&current_file.destination_relative_path).copied() {
			previous.files[index].applied_fingerprint = current_file.applied_fingerprint;
			continue;
		}

		file_indexes.insert(
			current_file.destination_relative_path.clone(),
			previous.files.len(),
		);
		previous.files.push(current_file);
	}

	previous
		.created_directories
		.extend(current.created_directories);
	previous.created_directories.sort();
	previous.created_directories.dedup();
	previous
		.backup_directories
		.extend(current.backup_directories);
	previous.source_label = match (&previous.source_label, &current.source_label) {
		(Some(previous_label), Some(current_label)) if previous_label == current_label =>
			Some(previous_label.clone()),
		(Some(previous_label), Some(_)) if previous_label.ends_with(" + …") =>
			Some(previous_label.clone()),
		(Some(previous_label), Some(_)) => Some(format!("{previous_label} + …")),
		(None, None) => None,
		_ => None,
	};
	previous.source_fingerprints.extend(current.source_fingerprints);
	previous.source_fingerprints.sort();
	previous.source_fingerprints.dedup();
	previous.operation_id = current.operation_id;
	previous.applied_at_unix_ms = current.applied_at_unix_ms;
	previous.recovery_after_state_known =
		previous.recovery_after_state_known && current.recovery_after_state_known;

	previous
}

fn validate_undo_history_limit(limit: usize) -> Result<usize, String> {
	if !(MIN_UNDO_HISTORY_ENTRIES..=MAX_UNDO_HISTORY_ENTRIES).contains(&limit) {
		return Err(format!(
			"The application-history limit must be between {MIN_UNDO_HISTORY_ENTRIES} and {MAX_UNDO_HISTORY_ENTRIES}.",
		));
	}

	Ok(limit)
}

fn trim_undo_history(
	history: &mut Vec<UndoSnapshot>,
	history_limit: usize,
) {
	while history.len() > history_limit {
		let expired = history.remove(0);
		discard_snapshot(expired);
	}
}

fn record_undo_snapshot(
	history: &mut Vec<UndoSnapshot>,
	snapshot: UndoSnapshot,
	append_undo: bool,
	history_limit: usize,
) {
	if append_undo {
		if let Some(previous) = history.pop() {
			if previous.source_kind == UndoSourceKind::Files &&
				snapshot.source_kind == UndoSourceKind::Files &&
				previous.deleted_directories.is_empty() &&
				snapshot.deleted_directories.is_empty()
			{
				let fallback_previous = previous.clone();
				let fallback_snapshot = snapshot.clone();
				let mut merged = merge_undo_snapshots(
					previous,
					snapshot,
				);

				match persist_undo_snapshot(&merged) {
					Ok(()) => {
						compact_committed_snapshot_storage(&mut merged);
						history.push(merged);
					}
					Err(error) => {
						eprintln!(
							"Could not merge persistent application history; keeping the two durable entries separately: {error}",
						);
						history.push(fallback_previous);
						history.push(fallback_snapshot);
					}
				}
			} else {
				history.push(previous);
				history.push(snapshot);
			}
		} else {
			history.push(snapshot);
		}
	} else {
		history.push(snapshot);
	}

	trim_undo_history(
		history,
		history_limit,
	);
}

fn undo_snapshot_files(
	snapshot: &UndoSnapshot,
	recovery: &mut UndoSnapshot,
) -> Result<(usize, usize), String> {
	let mut restored_files = 0_usize;
	let mut removed_files = 0_usize;

	restore_deleted_directories(&snapshot.root, &snapshot.deleted_directories)?;

	for file in snapshot.files.iter().rev() {
		let destination = snapshot.root.join(&file.destination_relative_path);
		let current = recovery_current_state(
			&snapshot.root,
			&file.destination_relative_path,
		)?;
		if current != file.applied_fingerprint {
			return Err(format!(
				"It is not safe to continue Undo: {} changed during the operation.",
				normalize_relative_display(&file.destination_relative_path),
			));
		}

		match &file.kind {
			UndoFileKind::Created => {
				if file.applied_fingerprint.is_some() {
					fs::remove_file(&destination)
						.map_err(|error| format!("Could not remove {}: {error}", destination.display()))?;
					mark_recovery_file_applied(
						recovery,
						&file.destination_relative_path,
						None,
						false,
					)?;
					mutation_failure_checkpoint()?;
					removed_files += 1;
				}
			}
			UndoFileKind::Replaced { .. } => {
				let backup_path = validated_undo_backup_path(&file.kind)?
					.ok_or_else(|| "The replacement snapshot lost the required backup.".to_string())?;
				let expected_backup_fingerprint = file_fingerprint(&backup_path)?;
				let validate_backup = || {
					revalidate_destination_before_commit(
						&snapshot.root,
						&file.destination_relative_path,
						current,
					)?;
					revalidate_undo_backup_before_commit(
						&file.kind,
						&backup_path,
						expected_backup_fingerprint,
					)
				};
				let restore = if file.applied_fingerprint.is_none() {
					safe_fs::atomic_copy_create_new_checked(
						&backup_path,
						&destination,
						validate_backup,
					)
				} else {
					safe_fs::atomic_copy_checked(
						&backup_path,
						&destination,
						validate_backup,
					)
				};
				restore
					.map_err(|error| format!("Could not restore {}: {error}", destination.display()))?;
				let restored_fingerprint = file_fingerprint(&destination)?;
				if restored_fingerprint != expected_backup_fingerprint {
					return Err(format!(
						"Restoring {} produced bytes different from the validated backup.",
						normalize_relative_display(&file.destination_relative_path),
					));
				}
				mark_recovery_file_applied(
					recovery,
					&file.destination_relative_path,
					Some(restored_fingerprint),
					false,
				)?;
				mutation_failure_checkpoint()?;
				restored_files += 1;
			}
		}
	}

	Ok((restored_files, removed_files))
}

