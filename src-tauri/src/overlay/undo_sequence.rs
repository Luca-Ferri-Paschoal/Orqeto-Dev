struct UndoSequenceExecution {
	restored_files: usize,
	removed_files: usize,
	recovery: UndoSnapshot,
}

struct UndoValidationPlan {
	final_states: HashMap<PathBuf, Option<FileFingerprint>>,
	allowed_states: HashMap<PathBuf, Vec<Option<FileFingerprint>>>,
}

fn validate_undo_sequence(
	root_folder: &str,
	snapshots: &[UndoSnapshot],
) -> Result<UndoValidationPlan, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;
	let mut virtual_states = HashMap::<PathBuf, Option<FileFingerprint>>::new();
	let mut allowed_states = HashMap::<PathBuf, Vec<Option<FileFingerprint>>>::new();

	for snapshot in snapshots.iter().rev() {
		if snapshot.root != root {
			return Err(
				"One application in history belongs to another project folder.".to_string(),
			);
		}

		for file in &snapshot.files {
			let is_virtual = virtual_states.contains_key(&file.destination_relative_path);
			let current_state = match virtual_states.get(&file.destination_relative_path) {
				Some(state) => *state,
				None => {
					let exists = validate_destination_entry(
						&root,
						&file.destination_relative_path,
						false,
					)?;

					if exists {
						Some(file_fingerprint(&root.join(&file.destination_relative_path))?)
					} else {
						None
					}
				}
			};

			if current_state != file.applied_fingerprint {
				return Err(match (file.applied_fingerprint, current_state) {
					(None, Some(_)) => format!(
						"It is not safe to undo: {} was recreated after application.",
						normalize_relative_display(&file.destination_relative_path),
					),
					(Some(_), _) => format!(
						"It is not safe to undo: {} was changed after application.",
						normalize_relative_display(&file.destination_relative_path),
					),
					(None, None) => unreachable!(),
				});
			}

			if !is_virtual && current_state.is_some() {
				OpenOptions::new()
					.write(true)
					.open(root.join(&file.destination_relative_path))
					.map_err(|error| {
						format!(
							"It is not safe to undo while {} cannot be changed: {error}",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?;
			}

			let state_after_undo = match &file.kind {
				UndoFileKind::Created => None,
				UndoFileKind::Replaced { .. } => {
					let backup_path = validated_undo_backup_path(&file.kind).map_err(|error| {
						format!(
							"The snapshot required to restore {} is not safely available: {error}",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?
					.ok_or_else(|| "The replacement snapshot lost the required backup.".to_string())?;

					Some(file_fingerprint(&backup_path)?)
				}
			};

			virtual_states.insert(
				file.destination_relative_path.clone(),
				state_after_undo,
			);
			let states = allowed_states
				.entry(file.destination_relative_path.clone())
				.or_default();
			if !states.contains(&state_after_undo) {
				states.push(state_after_undo);
			}
		}
	}

	Ok(UndoValidationPlan {
		final_states: virtual_states,
		allowed_states,
	})
}

fn undo_project_overlays_blocking(
	root_folder: String,
	snapshots: &[UndoSnapshot],
) -> Result<UndoSequenceExecution, String> {
	let validation = validate_undo_sequence(&root_folder, snapshots)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let mut recovery = prepare_undo_recovery_snapshot(
		&root,
		snapshots,
		&validation,
	)?;
	let mut restored_files = 0_usize;
	let mut removed_files = 0_usize;

	for snapshot in snapshots.iter().rev() {
		match undo_snapshot_files(snapshot, &mut recovery) {
			Ok((restored, removed)) => {
				restored_files += restored;
				removed_files += removed;
			}
			Err(error) => {
				return Err(rollback_operation(&recovery, error));
			}
		}
	}

	Ok(UndoSequenceExecution {
		restored_files,
		removed_files,
		recovery,
	})
}

#[tauri::command]
pub async fn undo_project_overlay(
	root_folder: String,
	steps: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<UndoProjectOverlayResult, String> {
	if steps == 0 || steps > MAX_UNDO_HISTORY_ENTRIES {
		return Err(format!(
			"The number of applications to undo must be between 1 and {MAX_UNDO_HISTORY_ENTRIES}.",
		));
	}

	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let snapshots = {
		let histories = undo_state
			.histories
			.lock()
			.map_err(|_| "Undo state became unavailable.".to_string())?;
		let history = histories
			.get(&root)
			.ok_or_else(|| "There are no applications in this project history to undo.".to_string())?;
		if history.len() < steps {
			return Err("There are not enough applications in history to undo.".to_string());
		}
		history[history.len() - steps..].to_vec()
	};
	let snapshots_for_task = snapshots.clone();
	let task = tauri::async_runtime::spawn_blocking(move || {
		undo_project_overlays_blocking(root_folder, &snapshots_for_task)
	})
	.await;
	let execution = match task {
		Ok(result) => result?,
		Err(error) => {
			let reason = protect_after_interrupted_mutation("The Undo operation");
			return Err(format!("{reason} Detalhes: {error}"));
		}
	};

	let mut histories = match undo_state.histories.lock() {
		Ok(histories) => histories,
		Err(_) => {
			return Err(rollback_operation(
				&execution.recovery,
				"Undo state became unavailable before Undo completed.".to_string(),
			));
		}
	};
	let history = histories
		.get_mut(&root)
		.ok_or_else(|| "Undo history changed during the operation.".to_string());
	let history = match history {
		Ok(history) => history,
		Err(error) => {
			drop(histories);
			return Err(rollback_operation(&execution.recovery, error));
		}
	};
	if history.len() < steps || history[history.len() - steps..]
		.iter()
		.zip(&snapshots)
		.any(|(current, expected)| current.applied_at_unix_ms != expected.applied_at_unix_ms)
	{
		drop(histories);
		return Err(rollback_operation(
			&execution.recovery,
			"Undo history changed during the operation.".to_string(),
		));
	}
	let mut removed = history.split_off(history.len() - steps);
	if let Err(error) = clear_recovery_journal(&execution.recovery) {
		history.append(&mut removed);
		drop(histories);
		return Err(rollback_operation(&execution.recovery, error));
	}
	let remaining_history_entries = history.len();
	drop(histories);
	discard_snapshot(execution.recovery);

	for snapshot in &removed {
		remove_empty_created_directories(&snapshot.root, &snapshot.created_directories);
	}
	for snapshot in removed {
		discard_snapshot(snapshot);
	}

	Ok(UndoProjectOverlayResult {
		operation_id: next_operation_id("undo"),
		restored_files: execution.restored_files,
		removed_files: execution.removed_files,
		undone_batches: steps,
		remaining_history_entries,
	})
}

#[tauri::command]
pub fn discard_project_overlay_undo(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<(), String> {
	let requested_root = PathBuf::from(&root_folder);
	let canonical_root = canonicalize_existing(&requested_root).ok();
	let _mutation_guard = if canonical_root.is_some() {
		Some(undo_state.begin_project_mutation(&root_folder)?)
	} else {
		None
	};
	let snapshots = {
		let mut histories = undo_state
			.histories
			.lock()
			.map_err(|_| "Undo state became unavailable.".to_string())?;
		let requested_key = root_lookup_key(&requested_root);
		let matching_root = canonical_root
			.as_ref()
			.and_then(|root| histories.contains_key(root).then(|| root.clone()))
			.or_else(|| {
				histories
					.keys()
					.find(|root| root_lookup_key(root) == requested_key)
					.cloned()
			});

		matching_root
			.and_then(|root| histories.remove(&root))
			.unwrap_or_default()
	};

	for snapshot in snapshots {
		discard_snapshot(snapshot);
	}

	Ok(())
}
