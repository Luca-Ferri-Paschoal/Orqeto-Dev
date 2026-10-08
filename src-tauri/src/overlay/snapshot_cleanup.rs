fn compact_committed_snapshot_storage(snapshot: &mut UndoSnapshot) {
	if snapshot.backup_directories.is_empty() {
		return;
	}

	let live_blob_ids = snapshot
		.files
		.iter()
		.filter_map(|file| match &file.kind {
			UndoFileKind::Created => None,
			UndoFileKind::Replaced { backup_blob_id, .. } => backup_blob_id.clone(),
		})
		.collect::<HashSet<_>>();
	let legacy_backup_paths = snapshot
		.files
		.iter()
		.filter_map(|file| match &file.kind {
			UndoFileKind::Replaced { backup_path, backup_blob_id: None } => Some(backup_path.clone()),
			_ => None,
		})
		.collect::<Vec<_>>();

	let mut known_blob_ids = HashSet::new();
	for directory in &snapshot.backup_directories {
		if legacy_backup_paths.iter().any(|path| path.starts_with(directory)) {
			continue;
		}
		let references = match storage::snapshot_blob_references(directory) {
			Ok(references) => references,
			Err(_) => return,
		};
		known_blob_ids.extend(references);
	}
	if !live_blob_ids.is_subset(&known_blob_ids) {
		return;
	}

	let mut retained_directories = Vec::with_capacity(snapshot.backup_directories.len());
	for directory in snapshot.backup_directories.drain(..) {
		if !legacy_backup_paths.iter().any(|path| path.starts_with(&directory)) {
			let _ = storage::retain_snapshot_blob_references(
				&directory,
				&live_blob_ids,
			);
		}

		// Keep the managed directory itself until the history entry expires. It is
		// the durable home of application-history metadata even when every backup
		// blob referenced by an intermediate Files apply became superseded.
		retained_directories.push(directory);
	}
	snapshot.backup_directories = retained_directories;
	let _ = storage::garbage_collect();
}

fn discard_snapshot(snapshot: UndoSnapshot) {
	for directory in snapshot.backup_directories {
		let _ = storage::remove_managed_directory(&directory);
	}
	let _ = storage::garbage_collect();
}


fn rollback_operation(snapshot: &UndoSnapshot, operation_error: String) -> String {
	match rollback_snapshot(snapshot) {
		Ok(()) => {
			for directory in &snapshot.backup_directories {
				let _ = storage::remove_managed_directory(directory);
			}
			let _ = storage::garbage_collect();
			operation_error
		}
		Err(rollback_error) => {
			let reason = format!("{operation_error} {rollback_error}");
			protect_mutations(reason.clone());
			reason
		},
	}
}

