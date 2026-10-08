#[tauri::command]
pub async fn prepare_project_overlay(
	root_folder: String,
	paths: Vec<String>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<PrepareProjectOverlayResult, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		prepare_project_overlay_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("Patch analysis was interrupted: {error}"))?
}

fn application_source_label(paths: &[String]) -> Option<String> {
	let first = Path::new(paths.first()?);

	if paths.len() > 1 {
		let parent = first.parent()?;
		if paths
			.iter()
			.map(Path::new)
			.all(|path| path.parent() == Some(parent))
		{
			return parent
				.file_name()
				.map(|name| name.to_string_lossy().to_string());
		}

		return None;
	}

	let is_zip = first
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));
	let is_directory = fs::symlink_metadata(first)
		.map(|metadata| metadata.is_dir())
		.unwrap_or(false);

	if is_zip || is_directory {
		return first
			.file_name()
			.map(|name| name.to_string_lossy().to_string());
	}

	first
		.parent()
		.and_then(Path::file_name)
		.map(|name| name.to_string_lossy().to_string())
		.or_else(|| first.file_name().map(|name| name.to_string_lossy().to_string()))
}

fn snapshot_matches_current_applied_state(snapshot: &UndoSnapshot) -> Result<bool, String> {
	for file in &snapshot.files {
		let current = recovery_current_state(
			&snapshot.root,
			&file.destination_relative_path,
		)?;

		if current != file.applied_fingerprint {
			return Ok(false);
		}
	}
	for directory in &snapshot.deleted_directories {
		match fs::symlink_metadata(snapshot.root.join(directory)) {
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Ok(_) => return Ok(false),
			Err(error) => return Err(format!(
				"Could not verify deleted folder {}: {error}",
				normalize_relative_display(directory),
			)),
		}
	}

	Ok(true)
}

fn prepared_plan_contains_candidate(
	plan: &PrepareProjectOverlayResult,
	destination_relative_path: &str,
	source_prefix: &str,
) -> bool {
	plan.candidates
		.iter()
		.chain(plan.root_candidate.iter())
		.any(|candidate| {
			candidate.destination_relative_path == destination_relative_path &&
				candidate.source_prefix == source_prefix
		})
}

fn validate_frozen_overlay_for_apply(
	frozen: &FrozenOverlayInput,
	destination_relative_path: &str,
	source_prefix: &str,
	expected_source_fingerprint: &str,
	expected_routing_fingerprint: &str,
) -> Result<PrepareProjectOverlayResult, String> {
	let current_plan = prepare_overlay_manifest(
		&frozen.root,
		&frozen.manifest,
	)?;
	if current_plan.source_fingerprint != expected_source_fingerprint {
		return Err(
			"The application source changed after analysis. Drop the files again to validate the current version.".to_string(),
		);
	}
	if current_plan.routing_fingerprint != expected_routing_fingerprint {
		return Err(
			"The project or routing rules changed after analysis. Analyze again before applying.".to_string(),
		);
	}
	if !prepared_plan_contains_candidate(
		&current_plan,
		destination_relative_path,
		source_prefix,
	) {
		return Err(
			"The selected destination is no longer a safe candidate for the current project version.".to_string(),
		);
	}

	Ok(current_plan)
}

#[tauri::command]
pub async fn preview_project_overlay_secrets(
    root_folder: String,
    paths: Vec<String>,
    destination_relative_path: String,
    source_prefix: String,
    expected_source_fingerprint: String,
    expected_routing_fingerprint: String,
    undo_state: State<'_, OverlayUndoState>,
) -> Result<SecretReviewResult, String> {
    let _guard = undo_state.begin_project_read(&root_folder)?;
    tauri::async_runtime::spawn_blocking(move || {
        let frozen = freeze_overlay_input(&root_folder, &paths)?;
        validate_frozen_overlay_for_apply(
            &frozen, &destination_relative_path, &source_prefix,
            &expected_source_fingerprint, &expected_routing_fingerprint,
        )?;
        let planned = planned_files(
            &frozen.root, &frozen.manifest,
            &parse_relative_path(&destination_relative_path)?,
            &parse_relative_path(&source_prefix)?,
        )?;
        let deletes = planned_deletions(&frozen.manifest, &planned)?;
        secret_review_plan(&frozen.root, &frozen.manifest, &planned, &deletes)
    }).await.map_err(|error| format!("Secret preflight was interrupted: {error}"))?
}

#[tauri::command]
pub async fn apply_project_overlay(
	root_folder: String,
	paths: Vec<String>,
	destination_relative_path: String,
	source_prefix: String,
	expected_source_fingerprint: String,
	expected_routing_fingerprint: String,
    approved_secret_paths: Option<Vec<String>>,
    expected_secret_review_fingerprint: Option<String>,
	append_undo: bool,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ApplyProjectOverlayResult, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let task = tauri::async_runtime::spawn_blocking(move || -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {
		let source_label = application_source_label(&paths);
		let frozen = freeze_overlay_input(
			&root_folder,
			&paths,
		)?;
		let current_plan = validate_frozen_overlay_for_apply(
			&frozen,
			&destination_relative_path,
			&source_prefix,
			&expected_source_fingerprint,
			&expected_routing_fingerprint,
		)?;

		let (result, mut snapshot) = apply_overlay_manifest_blocking_with_review(
			frozen.root.clone(),
			&frozen.manifest,
			destination_relative_path,
			source_prefix,
            &approved_secret_paths.unwrap_or_default(),
            expected_secret_review_fingerprint.as_deref(),
		)?;
		snapshot.source_label = source_label;
		snapshot.source_fingerprints = vec![current_plan.source_fingerprint];
		Ok((result, snapshot))
	})
	.await;
	let (result, mut snapshot) = match task {
		Ok(result) => result?,
		Err(error) => {
			let reason = protect_after_interrupted_mutation("File application");
			return Err(format!("{reason} Detalhes: {error}"));
		}
	};
	if result.added_files == 0 && result.replaced_files == 0 && result.deleted_files == 0 && result.deleted_directories == 0 {
		return Ok(result);
	}

	let root = snapshot.root.clone();
	let mut histories = undo_state
		.histories
		.lock()
		.map_err(|_| "Undo state became unavailable.".to_string())?;

	if let Err(error) = commit_application_snapshot(&snapshot) {
		drop(histories);
		return Err(rollback_operation(&snapshot, error));
	}
	compact_committed_snapshot_storage(&mut snapshot);

	let history = histories.entry(root).or_default();
	record_undo_snapshot(
		history,
		snapshot,
		append_undo,
		undo_history_limit,
	);

	Ok(result)
}
