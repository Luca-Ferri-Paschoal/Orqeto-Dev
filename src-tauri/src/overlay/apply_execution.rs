fn apply_overlay_manifest_blocking_with_review(
    root: PathBuf,
    manifest: &OverlayManifest,
    destination_relative_path: String,
    source_prefix: String,
    approved_secret_paths: &[String],
    expected_secret_review_fingerprint: Option<&str>,
) -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {

	let destination_relative = parse_relative_path(&destination_relative_path)?;
	let prefix = parse_relative_path(&source_prefix)?;
	let planned = planned_files(
		&root,
		manifest,
		&destination_relative,
		&prefix,
	)?;
	let delete_paths = planned_deletions(
		manifest,
		&planned,
	)?;
	let delete_directories = manifest.delete_directories.clone();

	if planned.is_empty() && delete_paths.is_empty() && delete_directories.is_empty() && manifest.permanent_delete_directories.is_empty() {
		return Err("No files were found to apply or delete.".to_string());
	}

    let mut approved = HashSet::new();
    if !approved_secret_paths.is_empty() {
        let review = secret_review_plan(&root, manifest, &planned, &delete_paths)?;
        if Some(review.fingerprint.as_str()) != expected_secret_review_fingerprint {
            return Err("Protected files changed after review. Analyze the ZIP again.".to_string());
        }
        for path in approved_secret_paths {
            if !review.files.iter().any(|file| file.path == *path && file.approvable) {
                return Err("An unreviewed or non-approvable file was selected.".to_string());
            }
            if !approved.insert(parse_relative_path(path)?) {
                return Err("The approval list has duplicate files.".to_string());
            }
        }
    }
	let protection = protect_secret_bearing_changes(
		&root,
		manifest,
		planned,
		delete_paths,
		delete_directories,
        &approved,
	)?;
	let planned = protection.planned_files;
	let delete_paths = protection.delete_paths;
	let delete_directories = protection.delete_directories;
	let protected_secret_files = protection.protected_files;
	let detected_secrets = protection.secret_count;

	let (planned, unchanged_paths) = filter_unchanged_planned_files(
		&root,
		manifest,
		planned,
	)?;
	let unchanged_files = unchanged_paths.len();
	let unchanged_directories = count_parent_directories(
		unchanged_paths.iter().map(PathBuf::as_path),
	);
	let operation_id = next_operation_id("files-apply");
	let applied_at_unix_ms = current_unix_ms();

	if planned.is_empty() && delete_paths.is_empty() && delete_directories.is_empty() {
		return Ok((
			ApplyProjectOverlayResult {
				operation_id: operation_id.clone(),
				applied_at_unix_ms: None,
				added_files: 0,
				replaced_files: 0,
				deleted_files: 0,
				unchanged_files,
				added_directories: 0,
				replaced_directories: 0,
				deleted_directories: 0,
				unchanged_directories,
				protected_secret_files,
				detected_secrets,
			},
			UndoSnapshot {
				root,
				operation_id,
				backup_directories: Vec::new(),
				files: Vec::new(),
				created_directories: Vec::new(),
				deleted_directories: Vec::new(),
				applied_at_unix_ms,
				source_kind: UndoSourceKind::Files,
				source_label: None,
				source_fingerprints: Vec::new(),
				added_lines: None,
				deleted_lines: None,
				recovery_after_state_known: true,
			},
		));
	}

	let added_files = planned
		.iter()
		.filter(|file| !file.was_replaced)
		.count();
	let replaced_files = planned.len() - added_files;
	let deleted_files = delete_paths.len();
	let added_directories = count_parent_directories(
		planned
			.iter()
			.filter(|file| !file.was_replaced)
			.map(|file| file.destination_relative_path.as_path()),
	);
	let replaced_directories = count_parent_directories(
		planned
			.iter()
			.filter(|file| file.was_replaced)
			.map(|file| file.destination_relative_path.as_path()),
	);
	let deleted_directories = delete_directories.len();
	let created_directories = collect_missing_parent_directories(
		&root,
		&planned,
	)?;
	let backup_bytes = estimate_snapshot_backup_bytes(
		&root,
		&planned,
		&delete_paths,
	)?;
	let reservation_bytes = storage::snapshot_reservation_bytes(
		backup_bytes,
		planned.len().saturating_add(delete_paths.len()),
	)?;
	let _storage_reservation = storage::reserve(
		&root,
		reservation_bytes,
	)?;
	let backup_directory = create_backup_directory(&root)?;
	let backups = match backup_replaced_files(
		&root,
		&planned,
		&delete_paths,
		&backup_directory,
	) {
		Ok(backups) => backups,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let source_fingerprints = match planned_source_fingerprints(manifest, &planned) {
		Ok(fingerprints) => fingerprints,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};
	let mut placeholder_files = planned
		.iter()
		.zip(source_fingerprints)
		.map(|(file, applied_fingerprint)| UndoFile {
			destination_relative_path: file.destination_relative_path.clone(),
			kind: if file.was_replaced {
				let backup = backups
					.get(&file.destination_relative_path)
					.expect("planned replacement must have a reserved backup");
				UndoFileKind::Replaced {
					backup_path: backup.path.clone(),
					backup_blob_id: Some(backup.blob_id.clone()),
				}
			} else {
				UndoFileKind::Created
			},
			applied_fingerprint: Some(applied_fingerprint),
			recovery_applied: false,
			recovery_allowed_states: Vec::new(),
		})
		.collect::<Vec<_>>();

	placeholder_files.extend(delete_paths.iter().map(|delete_path| UndoFile {
		destination_relative_path: delete_path.clone(),
		kind: {
			let backup = backups
				.get(delete_path)
				.expect("planned deletion must have a reserved backup");
			UndoFileKind::Replaced {
				backup_path: backup.path.clone(),
				backup_blob_id: Some(backup.blob_id.clone()),
			}
		},
		applied_fingerprint: None,
		recovery_applied: false,
		recovery_allowed_states: Vec::new(),
	}));

	let mut placeholder_snapshot = UndoSnapshot {
		root: root.clone(),
		operation_id: operation_id.clone(),
		backup_directories: vec![backup_directory.clone()],
		files: placeholder_files,
		created_directories: created_directories.clone(),
		deleted_directories: delete_directories.clone(),
		applied_at_unix_ms,
		source_kind: UndoSourceKind::Files,
		source_label: None,
		source_fingerprints: Vec::new(),
		added_lines: None,
		deleted_lines: None,
		recovery_after_state_known: true,
	};

	if let Err(error) = write_recovery_journal(&placeholder_snapshot) {
		discard_snapshot(placeholder_snapshot);
		return Err(error);
	}

	if let Err(error) = write_manifest_files(
		&root,
		manifest,
		&planned,
		&mut placeholder_snapshot,
	) {
		return Err(rollback_operation(&placeholder_snapshot, error));
	}

	if let Err(error) = delete_manifest_entries(
		&root,
		&delete_paths,
		&delete_directories,
		&mut placeholder_snapshot,
	) {
		return Err(rollback_operation(&placeholder_snapshot, error));
	}

	let snapshot = match build_undo_snapshot(
		&root,
		operation_id.clone(),
		applied_at_unix_ms,
		&planned,
		&delete_paths,
		delete_directories,
		created_directories,
		backup_directory.clone(),
		&backups,
	) {
		Ok(snapshot) => snapshot,
		Err(error) => {
			return Err(rollback_operation(&placeholder_snapshot, error));
		}
	};

	Ok((
		ApplyProjectOverlayResult {
			operation_id,
			applied_at_unix_ms: Some(applied_at_unix_ms),
			added_files,
			replaced_files,
			deleted_files,
			unchanged_files,
			added_directories,
			replaced_directories,
			deleted_directories,
			unchanged_directories,
			protected_secret_files,
			detected_secrets,
		},
		snapshot,
	))
}


#[cfg(test)]
fn apply_project_overlay_blocking(
	root_folder: String,
	paths: Vec<String>,
	destination_relative_path: String,
	source_prefix: String,
) -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {
	let frozen = freeze_overlay_input(
		&root_folder,
		&paths,
	)?;
	apply_overlay_manifest_blocking(
		frozen.root.clone(),
		&frozen.manifest,
		destination_relative_path,
		source_prefix,
	)
}

