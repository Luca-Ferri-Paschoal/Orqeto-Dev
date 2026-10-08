fn update_project_ignore_blocking(
	root_folder: String,
	paths: Vec<String>,
	ignore_paths: bool,
) -> Result<ProjectIgnoreUpdateResult, String> {
	let _guard = PROJECT_IGNORE_UPDATE_LOCK
		.lock()
		.map_err(|_| "The Dev Ignore coordinator became unavailable.".to_string())?;
	let operation_id = next_operation_id(if ignore_paths {
		"dev-ignore-add"
	} else {
		"dev-ignore-remove"
	});
	if paths.is_empty() {
		return Ok(ProjectIgnoreUpdateResult {
			operation_id,
			changed_paths: 0,
			unchanged_paths: 0,
			changed_files: 0,
			changed_directories: 0,
			unchanged_files: 0,
			unchanged_directories: 0,
		});
	}

	let root = canonical_project_root(&root_folder)?;
	let ignore_file = project_ignore_path(&root);

	if !ignore_file.is_file() {
		return Err(format!(
			"{} does not exist yet. Create Dev Ignore before editing rules.",
			PROJECT_IGNORE_FILE_NAME,
		));
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut canonical_paths = paths
		.into_iter()
		.map(|path| {
			fs::canonicalize(&path)
				.map_err(|error| format!("Could not access {path}: {error}"))
		})
		.collect::<Result<Vec<_>, _>>()?;

	canonical_paths.sort();
	canonical_paths.dedup();

	let mut changed_paths = 0;
	let mut unchanged_paths = 0;
	let mut changed_files = 0;
	let mut changed_directories = 0;
	let mut unchanged_files = 0;
	let mut unchanged_directories = 0;
	let mut appended_rules = Vec::new();
	let mut seen_rules = HashSet::new();

	for path in canonical_paths {
		if !path.starts_with(&root) {
			return Err(format!(
				"Item {} is not inside the project folder.",
				path.display(),
			));
		}

		if path == ignore_file {
			return Err(format!(
				"{} cannot ignore itself.",
				PROJECT_IGNORE_FILE_NAME,
			));
		}

		let metadata = fs::metadata(&path)
			.map_err(|error| format!("Could not read {}: {error}", path.display()))?;

		if !metadata.is_file() && !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				path.display(),
			));
		}

		let is_directory = metadata.is_dir();
		let currently_ignored = project_ignore.is_ignored(
			&path,
			is_directory,
		);

		if currently_ignored == ignore_paths {
			unchanged_paths += 1;
			if is_directory {
				unchanged_directories += 1;
			} else {
				unchanged_files += 1;
			}
			continue;
		}

		let relative_path = normalize_relative_rule_path(
			&root,
			&path,
		)?;
		let rules = if ignore_paths {
			vec![exact_ignore_rule(
				&relative_path,
				is_directory,
			)]
		} else {
			exact_unignore_rules(
				&relative_path,
				is_directory,
			)
		};

		for rule in rules {
			if seen_rules.insert(rule.clone()) {
				appended_rules.push(rule);
			}
		}

		changed_paths += 1;
		if is_directory {
			changed_directories += 1;
		} else {
			changed_files += 1;
		}
	}

	append_managed_rules(
		&ignore_file,
		&appended_rules,
	)?;

	Ok(ProjectIgnoreUpdateResult {
		operation_id,
		changed_paths,
		unchanged_paths,
		changed_files,
		changed_directories,
		unchanged_files,
		unchanged_directories,
	})
}

#[tauri::command]
pub fn create_project_ignore(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<bool, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	create_project_ignore_blocking(root_folder)
}

#[tauri::command]
pub fn update_project_ignore(
	root_folder: String,
	paths: Vec<String>,
	ignore_paths: bool,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ProjectIgnoreUpdateResult, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	update_project_ignore_blocking(
		root_folder,
		paths,
		ignore_paths,
	)
}

