#[tauri::command]
async fn open_folder_in_explorer(path: String) -> Result<(), String> {
	let folder = PathBuf::from(path);

	if !folder.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	tauri::async_runtime::spawn_blocking(move || open_folder_in_explorer_blocking(&folder))
		.await
		.map_err(|error| format!("Opening Explorer was interrupted: {error}"))?
}

#[tauri::command]
async fn close_folder_in_explorer(path: String) -> Result<(), String> {
	let folder = PathBuf::from(path);

	tauri::async_runtime::spawn_blocking(move || close_folder_in_explorer_blocking(&folder))
		.await
		.map_err(|error| format!("Closing Explorer was interrupted: {error}"))?
}

fn context_path_payload_too_large(paths: &[String]) -> bool {
	paths
		.iter()
		.fold(0_usize, |total, path| total.saturating_add(path.len())) > CONTEXT_MAX_TOTAL_PATH_BYTES
}

fn process_drop_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<ProcessDropResult, String> {
	if paths.len() > CONTEXT_MAX_REQUEST_PATHS ||
		context_path_payload_too_large(&paths) ||
		root_folder.len() > CONTEXT_MAX_PATH_BYTES ||
		paths.iter().any(|path| path.is_empty() || path.len() > CONTEXT_MAX_PATH_BYTES || path.contains('\0'))
	{
		return Err("The context selection contains too many paths or an invalid path.".to_string());
	}

	if paths.is_empty() {
		return Ok(ProcessDropResult {
			files: Vec::new(),
			directories: Vec::new(),
			skipped_files: Vec::new(),
			skipped_directory_count: 0,
			selected_bytes: 0,
		});
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut collected_files = Vec::new();
	let mut ignored_files = Vec::new();
	let mut ignored_directories = HashSet::new();
	let mut visited_directories = HashSet::new();
	let mut traversal_budget = TraversalBudget::default();

	let mut dropped_paths = paths
		.into_iter()
		.map(PathBuf::from)
		.collect::<Vec<_>>();

	dropped_paths.sort();

	for dropped_path in dropped_paths {
		collect_files(
			&root,
			&dropped_path,
			&project_ignore,
			&mut visited_directories,
			&mut collected_files,
			&mut ignored_files,
			&mut ignored_directories,
			&mut traversal_budget,
		)?;
	}

	collected_files.sort_by(|(left, _), (right, _)| left.cmp(right));
	collected_files.dedup_by(|(left, _), (right, _)| left == right);
	ignored_files.sort();
	ignored_files.dedup();

	let mut directories = visited_directories
		.into_iter()
		.map(|path| relative_path(
			&root,
			&path,
		))
		.collect::<Result<Vec<_>, _>>()?;
	directories.sort();
	directories.dedup();

	let mut selected_files = Vec::new();
	let mut selected_bytes = 0_u64;
	let mut skipped_files = ignored_files
		.into_iter()
		.map(|path| {
			Ok(SkippedFile {
				relative_path: relative_path(
					&root,
					&path,
				)?,
				reason: "File omitted because it is covered by .orqeto-devignore.".to_string(),
			})
		})
		.collect::<Result<Vec<_>, String>>()?;

	for (file_path, file_size) in collected_files {
		let relative_path = relative_path(
			&root,
			&file_path,
		)?;

		if is_context_zip_file(&file_path) {
			skipped_files.push(SkippedFile {
				relative_path,
				reason: "ZIP files are not added to context. Use the Apply code area.".to_string(),
			});
			continue;
		}

		selected_bytes = selected_bytes
			.checked_add(file_size)
			.ok_or_else(|| "The aggregate context-selection size is invalid.".to_string())?;

		selected_files.push(ContextSelectionFile {
			relative_path,
			size_bytes: file_size,
		});
	}

	Ok(ProcessDropResult {
		files: selected_files,
		directories,
		skipped_files,
		skipped_directory_count: ignored_directories.len(),
		selected_bytes,
	})
}

#[tauri::command]
async fn process_drop(
	root_folder: String,
	paths: Vec<String>,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<ProcessDropResult, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		process_drop_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("Reading files was interrupted: {error}"))?
}

fn materialize_context_files_blocking(
	root_folder: String,
	relative_paths: Vec<String>,
	paths_only: bool,
) -> Result<MaterializeContextResult, String> {
	if relative_paths.len() > CONTEXT_MAX_FILES ||
		context_path_payload_too_large(&relative_paths) ||
		root_folder.len() > CONTEXT_MAX_PATH_BYTES ||
		relative_paths.iter().any(|path| path.is_empty() || path.len() > CONTEXT_MAX_PATH_BYTES || path.contains('\0'))
	{
		return Err("The saved context contains too many paths or an invalid path.".to_string());
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;
	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut selected = relative_paths;
	selected.sort();
	selected.dedup();

	let mut generated_files = Vec::with_capacity(selected.len());
	let mut skipped_files = Vec::new();
	let mut total_content_bytes = 0_u64;

	for stored_path in selected {
		let relative = parse_stored_context_relative_path(
			&root,
			&stored_path,
		)?;
		let candidate = root.join(&relative);
		let metadata = match fs::symlink_metadata(&candidate) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				skipped_files.push(SkippedFile {
					relative_path: stored_path,
					reason: "File omitted because it no longer exists in the project.".to_string(),
				});
				continue;
			}
			Err(error) => {
				return Err(format!(
					"Could not validate {}: {error}",
					candidate.display(),
				));
			}
		};

		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!(
				"Saved path {} no longer points to a safe regular file.",
				stored_path,
			));
		}

		let canonical = canonicalize_existing(&candidate)?;
		ensure_inside_root(
			&root,
			&canonical,
		)?;
		if project_ignore.is_ignored(&canonical, false) {
			skipped_files.push(SkippedFile {
				relative_path: stored_path,
				reason: "File omitted because it is now covered by .orqeto-devignore.".to_string(),
			});
			continue;
		}

		let current_relative = relative_path(
			&root,
			&canonical,
		)?;
		match materialize_context_file(
			&canonical,
			current_relative,
			paths_only,
			&mut total_content_bytes,
		)? {
			Ok(file) => generated_files.push(file),
			Err(skipped) => skipped_files.push(skipped),
		}
	}

	Ok(MaterializeContextResult {
		files: generated_files,
		directories: Vec::new(),
		skipped_files,
		skipped_directory_count: 0,
	})
}

