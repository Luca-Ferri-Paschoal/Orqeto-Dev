#[tauri::command]
pub fn project_overlay_undo_history(
	root_folder: String,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<Vec<OverlayUndoHistoryEntry>, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let project_is_mutating = undo_state.is_project_mutating(&root)?;
	let mut histories = undo_state
		.histories
		.lock()
		.map_err(|_| "Undo state became unavailable.".to_string())?;
	let Some(history) = histories.get_mut(&root) else {
		return Ok(Vec::new());
	};

	if !project_is_mutating {
		trim_undo_history(
			history,
			undo_history_limit,
		);
	}

	Ok(history
		.iter()
		.rev()
		.enumerate()
		.map(|(index, snapshot)| {
			let added_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Created) &&
						file.applied_fingerprint.is_some()
				})
				.count();
			let replaced_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Replaced { .. }) &&
						file.applied_fingerprint.is_some()
				})
				.count();
			let deleted_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Replaced { .. }) &&
						file.applied_fingerprint.is_none()
				})
				.count();

			OverlayUndoHistoryEntry {
				operation_id: snapshot.operation_id.clone(),
				steps: index + 1,
				added_files,
				replaced_files,
				deleted_files,
				applied_at_unix_ms: snapshot.applied_at_unix_ms,
				source_kind: snapshot.source_kind.as_str().to_string(),
				source_label: snapshot.source_label.clone(),
				added_lines: snapshot.added_lines,
				deleted_lines: snapshot.deleted_lines,
			}
		})
		.collect())
}

#[tauri::command]
pub async fn project_overlay_source_history_match(
	root_folder: String,
	source_fingerprint: String,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<AppliedSourceHistoryMatch, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let matched = {
		let mut histories = undo_state
			.histories
			.lock()
			.map_err(|_| "Undo state became unavailable.".to_string())?;
		let Some(history) = histories.get_mut(&root) else {
			return Ok(AppliedSourceHistoryMatch {
				kind: "none".to_string(),
				applications_ago: None,
				source_label: None,
				currently_applied: false,
			});
		};

		trim_undo_history(history, undo_history_limit);

		history
			.iter()
			.rev()
			.enumerate()
			.find(|(_, snapshot)| snapshot.source_fingerprints.iter().any(|fingerprint| fingerprint == &source_fingerprint))
			.map(|(index, snapshot)| (index, snapshot.clone()))
	};

	let Some((index, snapshot)) = matched else {
		return Ok(AppliedSourceHistoryMatch {
			kind: "none".to_string(),
			applications_ago: None,
			source_label: None,
			currently_applied: false,
		});
	};

	if index == 0 {
		let source_label = snapshot.source_label.clone();
		let currently_applied = tauri::async_runtime::spawn_blocking(move || {
			snapshot_matches_current_applied_state(&snapshot)
		})
		.await
		.map_err(|error| format!("Applied-source history verification was interrupted: {error}"))??;

		return Ok(AppliedSourceHistoryMatch {
			kind: "latest".to_string(),
			applications_ago: Some(0),
			source_label,
			currently_applied,
		});
	}

	Ok(AppliedSourceHistoryMatch {
		kind: "older".to_string(),
		applications_ago: Some(index),
		source_label: snapshot.source_label,
		currently_applied: false,
	})
}

