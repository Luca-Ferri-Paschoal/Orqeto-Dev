pub(crate) fn record_external_undo_snapshot(
	undo_state: &OverlayUndoState,
	mut snapshot: UndoSnapshot,
	undo_history_limit: usize,
) -> Result<(), String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let root = snapshot.root.clone();
	let mut histories = match undo_state.histories.lock() {
		Ok(histories) => histories,
		Err(_) => {
			return Err(rollback_operation(
				&snapshot,
				"Undo state became unavailable before recording the application.".to_string(),
			));
		}
	};
	commit_application_snapshot(&snapshot)?;
	compact_committed_snapshot_storage(&mut snapshot);
	let history = histories.entry(root).or_default();

	record_undo_snapshot(
		history,
		snapshot,
		false,
		undo_history_limit,
	);

	Ok(())
}

