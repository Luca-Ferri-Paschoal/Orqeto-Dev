fn create_git_simulation_directory() -> Result<GitSimulationDirectory, String> {
	let base = std::env::temp_dir().join("orqeto-dev").join("git-simulations");
	safe_fs::create_dir_all_durable(&base)
		.map_err(|error| format!("Could not prepare the private Git patch simulation: {error}"))?;
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(|error| format!("Could not identify the Git patch simulation: {error}"))?
		.as_nanos();

	for attempt in 0_u32..128 {
		let directory = base.join(format!(
			"git-sim-{}-{timestamp}-{attempt}",
			std::process::id(),
		));
		match fs::create_dir(&directory) {
			Ok(()) => return Ok(GitSimulationDirectory(directory)),
			Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
			Err(error) => {
				return Err(format!(
					"Could not create the private Git patch simulation: {error}",
				));
			}
		}
	}

	Err("Could not reserve a private folder for Git patch simulation.".to_string())
}

fn copy_git_attributes_for_simulation(
	prepared: &PreparedGitPatch,
	simulation_repository: &Path,
) -> Result<(), String> {
	let mut attribute_paths = HashSet::new();
	for relative_path in &prepared.affected_paths {
		let repository_relative = prepared
			.root_relative_to_repository
			.join(relative_path);
		let mut current = repository_relative.parent();
		while let Some(directory) = current {
			attribute_paths.insert(directory.join(".gitattributes"));
			if directory.as_os_str().is_empty() {
				break;
			}
			current = directory.parent();
		}
	}

	let mut attribute_paths = attribute_paths.into_iter().collect::<Vec<_>>();
	attribute_paths.sort();
	for relative in attribute_paths {
		safe_fs::validate_project_relative_path(
			&prepared.repository_root,
			&relative,
		)?;
		let source = prepared.repository_root.join(&relative);
		let metadata = match fs::symlink_metadata(&source) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
			Err(error) => {
				return Err(format!(
					"Could not inspect {} for the Git simulation: {error}",
					source.display(),
				));
			}
		};
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!(
				"{} is not a safe regular .gitattributes file.",
				source.display(),
			));
		}

		let before = file_fingerprint(&source)?;
		let destination = simulation_repository.join(&relative);
		let parent = destination.parent().ok_or_else(|| {
			"The private .gitattributes copy produced a destination without a parent folder.".to_string()
		})?;
		safe_fs::create_dir_all_durable(parent)
			.map_err(|error| format!("Could not prepare {}: {error}", destination.display()))?;
		fs::copy(&source, &destination)
			.map_err(|error| format!("Could not copy {}: {error}", source.display()))?;
		let copied = file_fingerprint(&destination)?;
		let after = file_fingerprint(&source)?;
		if before != after || before != copied {
			return Err(format!(
				"{} changed during private Git patch preparation.",
				source.display(),
			));
		}
	}

	Ok(())
}

fn simulate_git_patch_after_states(
	prepared: &PreparedGitPatch,
) -> Result<HashMap<String, Option<FileFingerprint>>, String> {
	let simulation = create_git_simulation_directory()?;
	let simulation_repository = simulation.0.join("repository");
	let simulation_project = simulation_repository.join(&prepared.root_relative_to_repository);
	safe_fs::create_dir_all_durable(&simulation_project)
		.map_err(|error| format!("Could not prepare the private Git patch tree: {error}"))?;
	copy_git_attributes_for_simulation(
		prepared,
		&simulation_repository,
	)?;

	for relative_path in &prepared.affected_paths {
		let relative = Path::new(relative_path);
		let source = prepared.project_root.join(relative);
		let destination = simulation_project.join(relative);

		match fs::symlink_metadata(&source) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					return Err(format!(
						"Could not simulate {relative_path}: the current state is not a safe regular file.",
					));
				}
				let before = file_fingerprint(&source)?;
				let parent = destination
					.parent()
					.ok_or_else(|| "The Git patch simulation produced a destination without a parent folder.".to_string())?;
				safe_fs::create_dir_all_durable(parent)
					.map_err(|error| format!("Could not prepare the simulation for {relative_path}: {error}"))?;
				fs::copy(&source, &destination)
					.map_err(|error| format!("Could not copy {relative_path} into the simulation: {error}"))?;
				let copied = file_fingerprint(&destination)?;
				let after = file_fingerprint(&source)?;
				if before != after || before != copied {
					return Err(format!(
						"{relative_path} changed during Git patch simulation. The application was cancelled to preserve concurrent work.",
					));
				}
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {}
			Err(error) => {
				return Err(format!(
					"Could not prepare {relative_path} for Git patch simulation: {error}",
				));
			}
		}
	}

	let simulation_apply = execute_git_apply(
		&simulation_repository,
		&prepared.root_relative_to_repository,
		&[],
		Arc::clone(&prepared.patch_bytes),
	)?;
	if !simulation_apply.status.success() {
		return Err(format!(
			"The private simulation rejected the Git patch: {}",
			git_failure(&simulation_apply),
		));
	}

	let mut expected = HashMap::with_capacity(prepared.affected_paths.len());
	for relative_path in &prepared.affected_paths {
		let destination = simulation_project.join(relative_path);
		let fingerprint = match fs::symlink_metadata(&destination) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					return Err(format!(
						"The Git patch simulation produced an unsupported destination at {relative_path}.",
					));
				}
				Some(file_fingerprint(&destination)?)
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => None,
			Err(error) => {
				return Err(format!(
					"Could not verify {relative_path} in the Git patch simulation: {error}",
				));
			}
		};
		expected.insert(path_key(relative_path), fingerprint);
	}

	Ok(expected)
}

fn apply_prepared_git_patch(prepared: &PreparedGitPatch) -> Result<(), String> {
	let output = execute_git_apply(
		&prepared.repository_root,
		&prepared.root_relative_to_repository,
		&[],
		Arc::clone(&prepared.patch_bytes),
	)?;

	if output.status.success() {
		Ok(())
	} else {
		Err(git_failure(&output))
	}
}

#[tauri::command]
pub async fn is_git_repository(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<bool, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || is_git_repository_blocking(&root_folder))
		.await
		.map_err(|error| format!("Git repository verification was interrupted: {error}"))?
}

#[tauri::command]
pub async fn generate_git_commit_context(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<GitCommitContextData, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || generate_git_commit_context_blocking(root_folder))
		.await
		.map_err(|error| format!("Commit context generation was interrupted: {error}"))?
}

#[tauri::command]
pub async fn git_patch_source_fingerprint(patch_path: String) -> Result<String, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let source = load_git_patch_source(&patch_path)?;
		Ok(patch_fingerprint(&source.bytes))
	})
	.await
	.map_err(|error| format!("Git patch fingerprinting was interrupted: {error}"))?
}

#[tauri::command]
pub async fn prepare_git_patch(
	root_folder: String,
	patch_path: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<GitPatchPreview, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let prepared = tauri::async_runtime::spawn_blocking(move || {
		prepare_git_patch_blocking(
			&root_folder,
			&patch_path,
		)
	})
	.await
	.map_err(|error| format!("Git patch validation was interrupted: {error}"))??;

	Ok(GitPatchPreview {
		patch_name: prepared.patch_name,
		patch_fingerprint: prepared.patch_fingerprint,
		file_count: prepared.changes.len(),
		added_lines: prepared.added_lines,
		deleted_lines: prepared.deleted_lines,
		changes: prepared.changes,
	})
}

