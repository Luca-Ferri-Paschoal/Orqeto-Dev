fn prepare_undo_recovery_snapshot(
	root: &Path,
	snapshots: &[UndoSnapshot],
	validation: &UndoValidationPlan,
) -> Result<UndoSnapshot, String> {
	let mut seen = HashSet::new();
	let mut planned = Vec::new();

	for snapshot in snapshots {
		for file in &snapshot.files {
			if !seen.insert(file.destination_relative_path.clone()) {
				continue;
			}
			let exists = validate_destination_entry(root, &file.destination_relative_path, false)?;
			planned.push(PlannedFile {
				destination_relative_path: file.destination_relative_path.clone(),
				source_index: 0,
				was_replaced: exists,
			});
		}
	}

	let backup_bytes = estimate_snapshot_backup_bytes(
		root,
		&planned,
		&[],
	)?;
	let reservation_bytes = storage::snapshot_reservation_bytes(
		backup_bytes,
		planned.len(),
	)?;
	let _storage_reservation = storage::reserve(
		root,
		reservation_bytes,
	)?;
	let backup_directory = create_backup_directory(root)?;
	let backups = match backup_replaced_files(
		root,
		&planned,
		&[],
		&backup_directory,
	) {
		Ok(backups) => backups,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let mut recovery_created_directories = Vec::new();
	for directory in snapshots.iter().flat_map(|snapshot| snapshot.deleted_directories.iter()) {
		let absolute = root.join(directory);
		match fs::symlink_metadata(&absolute) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
					return Err(format!(
						"It is not safe to undo because {} is no longer a regular folder location.",
						normalize_relative_display(directory),
					));
				}
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				recovery_created_directories.push(directory.clone());
			}
			Err(error) => return Err(format!(
				"Could not validate {} before Undo: {error}",
				normalize_relative_display(directory),
			)),
		}
	}
	recovery_created_directories.sort();
	recovery_created_directories.dedup();

	let files = planned
		.into_iter()
		.map(|file| UndoFile {
			destination_relative_path: file.destination_relative_path.clone(),
			kind: if file.was_replaced {
				let backup = backups
					.get(&file.destination_relative_path)
					.expect("undo recovery replacement must have a reserved backup");
				UndoFileKind::Replaced {
					backup_path: backup.path.clone(),
					backup_blob_id: Some(backup.blob_id.clone()),
				}
			} else {
				UndoFileKind::Created
			},
			applied_fingerprint: validation
				.final_states
				.get(&file.destination_relative_path)
				.copied()
				.flatten(),
			recovery_applied: false,
			recovery_allowed_states: validation
				.allowed_states
				.get(&file.destination_relative_path)
				.cloned()
				.unwrap_or_default(),
		})
		.collect();
	let recovery = UndoSnapshot {
		root: root.to_path_buf(),
		operation_id: next_operation_id("undo-recovery"),
		backup_directories: vec![backup_directory],
		files,
		created_directories: recovery_created_directories,
		deleted_directories: Vec::new(),
		applied_at_unix_ms: current_unix_ms(),
		source_kind: UndoSourceKind::Files,
		source_label: Some("undo-recovery".to_string()),
		source_fingerprints: Vec::new(),
		added_lines: None,
		deleted_lines: None,
		recovery_after_state_known: true,
	};

	if let Err(error) = write_recovery_journal(&recovery) {
		discard_snapshot(recovery.clone());
		return Err(error);
	}

	Ok(recovery)
}

#[cfg(test)]
fn undo_project_overlay_blocking(
	root_folder: String,
	snapshot: &UndoSnapshot,
) -> Result<UndoSequenceExecution, String> {
	undo_project_overlays_blocking(
		root_folder,
		std::slice::from_ref(snapshot),
	)
}
