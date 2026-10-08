pub fn recover_stale_snapshots() -> Result<(), String> {
	let base = std::env::temp_dir().join("orqeto-dev");
	let Ok(entries) = fs::read_dir(&base) else {
		return Ok(());
	};
	let mut failures = Vec::new();

	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().to_string();
		if !name.starts_with("undo-") {
			continue;
		}

		let directory = entry.path();
		if let Err(error) = storage::validate_managed_directory(&directory) {
			failures.push(format!("{}: {error}", directory.display()));
			continue;
		}
		let storage_class = match storage::storage_class(&directory) {
			Ok(class) => class,
			Err(error) => {
				failures.push(format!("{}: {error}", directory.display()));
				continue;
			}
		};
		let journal_path = directory.join(RECOVERY_FILE_NAME);
		let journal_exists = match fs::symlink_metadata(&journal_path) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					failures.push(format!(
						"{}: the recovery journal is not a safe regular file",
						directory.display(),
					));
					continue;
				}
				true
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
			Err(error) => {
				failures.push(format!(
					"{}: could not validate the recovery journal: {error}",
					directory.display(),
				));
				continue;
			}
		};

		if journal_exists {
			let journal = match read_recovery_journal(&directory) {
				Ok(journal) => journal,
				Err(error) => {
					failures.push(format!("{}: {error}", directory.display()));
					continue;
				}
			};
			if journal.committed {
				let has_history = match has_persisted_undo_history_file(&directory) {
					Ok(value) => value,
					Err(error) => {
						failures.push(format!("{}: {error}", directory.display()));
						continue;
					}
				};
				if has_history {
					if let Err(error) = storage::set_snapshot_active_undo(&directory) {
						failures.push(format!("{}: {error}", directory.display()));
						continue;
					}
					let _ = fs::remove_file(&journal_path);
					continue;
				}
			}

			if let Err(error) = restore_recovery_directory(&directory) {
				failures.push(format!("{}: {error}", directory.display()));
				continue;
			}
		} else if storage_class == storage::StorageClass::ActiveUndo {
			match has_persisted_undo_history_file(&directory) {
				Ok(true) => continue,
				Ok(false) => {}
				Err(error) => {
					failures.push(format!("{}: {error}", directory.display()));
					continue;
				}
			}
		}

		if let Err(error) = storage::remove_managed_directory(&directory) {
			failures.push(format!("{}: {error}", directory.display()));
		}
	}

	if failures.is_empty() {
		storage::garbage_collect()?;
		Ok(())
	} else {
		let reason = format!(
			"Some previous operations require manual recovery and their backups were preserved: {}",
			failures.join(" | "),
		);
		protect_mutations(reason.clone());
		Err(reason)
	}
}

#[tauri::command]
pub async fn overlay_recovery_status() -> Result<OverlayRecoveryStatus, String> {
	// Waiting on the async worker keeps Tauri's UI/event thread responsive.
	tauri::async_runtime::spawn_blocking(|| {
		wait_for_startup_tasks()?;
		Ok(OverlayRecoveryStatus {
			blocked: mutation_protection_reason().is_some(),
		})
	})
	.await
	.map_err(|error| format!("Startup status was interrupted: {error}"))?
}

fn discard_recovery_directories() -> Result<(), String> {
	let base = std::env::temp_dir().join("orqeto-dev");
	let entries = match fs::read_dir(&base) {
		Ok(entries) => entries,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
		Err(error) => return Err(format!("Could not inspect recovery storage: {error}")),
	};
	let mut failures = Vec::new();

	for entry in entries {
		let entry = match entry {
			Ok(entry) => entry,
			Err(error) => {
				failures.push(format!("Could not inspect a recovery entry: {error}"));
				continue;
			}
		};
		let name = entry.file_name().to_string_lossy().to_string();
		if !name.starts_with("undo-") {
			continue;
		}
		let directory = entry.path();
		if let Err(error) = storage::validate_managed_directory(&directory) {
			failures.push(format!("{}: {error}", directory.display()));
			continue;
		}
		if let Err(error) = storage::remove_managed_directory(&directory) {
			failures.push(format!("{}: {error}", directory.display()));
		}
	}

	if failures.is_empty() {
		let _ = storage::garbage_collect();
		Ok(())
	} else {
		Err(format!(
			"Could not discard all Apply recovery data. The safety block was kept: {}",
			failures.join(" | "),
		))
	}
}

#[tauri::command]
pub async fn discard_overlay_recovery_state(
	undo_state: State<'_, OverlayUndoState>,
) -> Result<OverlayRecoveryStatus, String> {
	tauri::async_runtime::spawn_blocking(wait_for_startup_tasks)
		.await
		.map_err(|error| format!("Recovery discard was interrupted: {error}"))??;
	if mutation_protection_reason().is_none() {
		return Ok(OverlayRecoveryStatus { blocked: false });
	}
	if undo_state.has_active_mutations() {
		return Err("An Apply/Undo operation is still active. Wait for it to finish before discarding recovery history.".to_string());
	}
	{
		let _histories = undo_state
			.histories
			.lock()
			.map_err(|_| "Undo state became unavailable.".to_string())?;
		let _protection = mutation_protection()
			.lock()
			.map_err(|_| "Recovery protection became unavailable.".to_string())?;
	}

	tauri::async_runtime::spawn_blocking(discard_recovery_directories)
		.await
		.map_err(|error| format!("Recovery discard was interrupted: {error}"))??;
	undo_state
		.histories
		.lock()
		.map_err(|_| "Undo state became unavailable.".to_string())?
		.clear();
	*mutation_protection()
		.lock()
		.map_err(|_| "Recovery protection became unavailable.".to_string())? = None;

	Ok(OverlayRecoveryStatus { blocked: false })
}



fn ensure_overlay_source_separate(
	root: &Path,
	source: &Path,
) -> Result<(), String> {
	if source.starts_with(root) || root.starts_with(source) {
		return Err(
			"The source used for application must be outside the configured folder.".to_string(),
		);
	}

	Ok(())
}

fn normalize_relative_display(path: &Path) -> String {
	if path.as_os_str().is_empty() {
		return "./".to_string();
	}

	format!("./{}", path.to_string_lossy().replace('\\', "/"))
}

fn insert_parent_directories(
	directories: &mut HashSet<PathBuf>,
	path: &Path,
) {
	let mut parent = path.parent();

	while let Some(directory) = parent {
		if directory.as_os_str().is_empty() || directory == Path::new(".") {
			break;
		}

		directories.insert(directory.to_path_buf());
		parent = directory.parent();
	}
}

fn count_parent_directories<'a>(paths: impl IntoIterator<Item = &'a Path>) -> usize {
	let mut directories = HashSet::new();

	for path in paths {
		insert_parent_directories(
			&mut directories,
			path,
		);
	}

	directories.len()
}

fn normalize_source_prefix(path: &Path) -> String {
	path.to_string_lossy().replace('\\', "/")
}

fn root_lookup_key(path: &Path) -> String {
	let normalized = path
		.to_string_lossy()
		.replace('\\', "/")
		.trim_end_matches('/')
		.to_string();

	#[cfg(target_os = "windows")]
	{
		let normalized = if let Some(value) = normalized.strip_prefix("//?/UNC/") {
			format!("//{value}")
		} else if let Some(value) = normalized.strip_prefix("//?/") {
			value.to_string()
		} else {
			normalized
		};

		return normalized.to_lowercase();
	}

	#[cfg(not(target_os = "windows"))]
	{
		normalized
	}
}

fn parse_relative_path(value: &str) -> Result<PathBuf, String> {
	let normalized = value
		.strip_prefix("./")
		.unwrap_or(value);
	let path = PathBuf::from(normalized);

	for component in path.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("Relative path {value} is invalid."));
		}
	}

	Ok(path)
}

