pub(crate) fn prepare_external_undo_snapshot(
	root_folder: &str,
	relative_paths: &[String],
	expected_after_states: &HashMap<String, Option<FileFingerprint>>,
	source_label: String,
	source_fingerprint: String,
	added_lines: usize,
	deleted_lines: usize,
) -> Result<UndoSnapshot, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	if relative_paths.is_empty() {
		return Err("The patch has no files to apply.".to_string());
	}

	let mut seen = HashSet::new();
	let mut planned_files = Vec::new();

	for value in relative_paths {
		let relative_path = parse_relative_path(value)?;

		if relative_path.as_os_str().is_empty() {
			return Err("The patch contains an empty file path.".to_string());
		}

		let normalized = relative_path
			.to_string_lossy()
			.replace('\\', "/");
		#[cfg(target_os = "windows")]
		let normalized = normalized.to_lowercase();

		if !seen.insert(normalized) {
			continue;
		}

		let was_replaced = validate_destination_entry(
			&root,
			&relative_path,
			false,
		)?;

		planned_files.push(PlannedFile {
			destination_relative_path: relative_path,
			source_index: 0,
			was_replaced,
		});
	}

	let created_directories = collect_missing_parent_directories(
		&root,
		&planned_files,
	)?;
	let backup_bytes = estimate_snapshot_backup_bytes(
		&root,
		&planned_files,
		&[],
	)?;
	let reservation_bytes = storage::snapshot_reservation_bytes(
		backup_bytes,
		planned_files.len(),
	)?;
	let _storage_reservation = storage::reserve(
		&root,
		reservation_bytes,
	)?;
	let backup_directory = create_backup_directory(&root)?;
	let backups = match backup_replaced_files(
		&root,
		&planned_files,
		&[],
		&backup_directory,
	) {
		Ok(backups) => backups,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let files = match planned_files
		.into_iter()
		.map(|planned| {
			let mut key = planned
				.destination_relative_path
				.to_string_lossy()
				.replace('\\', "/");
			#[cfg(target_os = "windows")]
			{
				key = key.to_lowercase();
			}
			let expected_after = expected_after_states
				.get(&key)
				.copied()
				.ok_or_else(|| {
					format!(
						"The Git patch simulation did not record the expected state of {}.",
						normalize_relative_display(&planned.destination_relative_path),
					)
				})?;
			Ok(UndoFile {
				destination_relative_path: planned.destination_relative_path.clone(),
				kind: if planned.was_replaced {
					let backup = backups
						.get(&planned.destination_relative_path)
						.ok_or_else(|| "The Git snapshot lost a required backup.".to_string())?;
					UndoFileKind::Replaced {
						backup_path: backup.path.clone(),
						backup_blob_id: Some(backup.blob_id.clone()),
					}
				} else {
					UndoFileKind::Created
				},
				applied_fingerprint: expected_after,
				recovery_applied: true,
				recovery_allowed_states: vec![expected_after],
			})
		})
		.collect::<Result<Vec<_>, String>>() {
		Ok(files) => files,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let snapshot = UndoSnapshot {
		root,
		operation_id: next_operation_id("git-apply"),
		backup_directories: vec![backup_directory],
		files,
		created_directories,
		deleted_directories: Vec::new(),
		applied_at_unix_ms: current_unix_ms(),
		source_kind: UndoSourceKind::Git,
		source_label: Some(source_label),
		source_fingerprints: vec![source_fingerprint],
		added_lines: Some(added_lines),
		deleted_lines: Some(deleted_lines),
		recovery_after_state_known: true,
	};

	if let Err(error) = write_recovery_journal(&snapshot) {
		discard_snapshot(snapshot.clone());
		return Err(error);
	}

	Ok(snapshot)
}

pub(crate) fn finalize_external_undo_snapshot(
	mut snapshot: UndoSnapshot,
) -> Result<(UndoSnapshot, ApplyProjectOverlayResult), String> {
	let mut added_files = 0_usize;
	let mut replaced_files = 0_usize;
	let mut deleted_files = 0_usize;
	let mut added_directories = HashSet::new();
	let mut replaced_directories = HashSet::new();
	let mut deleted_directories = HashSet::new();

	for file in &mut snapshot.files {
		let destination = snapshot.root.join(&file.destination_relative_path);
		let final_fingerprint = match fs::symlink_metadata(&destination) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					return Err(format!(
						"The Git patch produced an unsupported destination at {}.",
						normalize_relative_display(&file.destination_relative_path),
					));
				}

				Some(file_fingerprint(&destination)?)
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
			Err(error) => {
				return Err(format!(
					"Could not verify {} after the Git patch: {error}",
					normalize_relative_display(&file.destination_relative_path),
				));
			}
		};

		if final_fingerprint != file.applied_fingerprint {
			return Err(format!(
				"The final state of {} differs from the immutable Git patch simulation.",
				normalize_relative_display(&file.destination_relative_path),
			));
		}

		match (&file.kind, final_fingerprint) {
			(UndoFileKind::Created, Some(_)) => {
				added_files += 1;
				insert_parent_directories(
					&mut added_directories,
					&file.destination_relative_path,
				);
			}
			(UndoFileKind::Created, None) => {}
			(UndoFileKind::Replaced { .. }, Some(_)) => {
				replaced_files += 1;
				insert_parent_directories(
					&mut replaced_directories,
					&file.destination_relative_path,
				);
			}
			(UndoFileKind::Replaced { .. }, None) => {
				deleted_files += 1;
				insert_parent_directories(
					&mut deleted_directories,
					&file.destination_relative_path,
				);
			}
		}

		file.recovery_applied = true;
		if !file.recovery_allowed_states.contains(&final_fingerprint) {
			file.recovery_allowed_states.push(final_fingerprint);
		}
	}

	write_recovery_journal(&snapshot)?;
	let operation_id = snapshot.operation_id.clone();
	let applied_at_unix_ms = snapshot.applied_at_unix_ms;

	Ok((
		snapshot,
		ApplyProjectOverlayResult {
			operation_id,
			applied_at_unix_ms: Some(applied_at_unix_ms),
			added_files,
			replaced_files,
			deleted_files,
			unchanged_files: 0,
			added_directories: added_directories.len(),
			replaced_directories: replaced_directories.len(),
			deleted_directories: deleted_directories.len(),
			unchanged_directories: 0,
			protected_secret_files: 0,
			detected_secrets: 0,
		},
	))
}

pub(crate) fn rollback_external_undo_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	match rollback_snapshot(snapshot) {
		Ok(()) => Ok(()),
		Err(error) => {
			protect_mutations(error.clone());
			Err(error)
		}
	}
}

pub(crate) fn discard_external_undo_snapshot(snapshot: UndoSnapshot) {
	discard_snapshot(snapshot);
}

