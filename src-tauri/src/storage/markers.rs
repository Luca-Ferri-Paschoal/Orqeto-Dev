fn read_marker(directory: &Path) -> Result<Option<StorageMarker>, String> {
	let path = directory.join(STORAGE_MARKER_FILE_NAME);
	let mut last_error = None;
	for attempt in 0..WINDOWS_MARKER_RETRY_ATTEMPTS {
		let metadata = match fs::symlink_metadata(&path) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
			Err(error) if is_transient_windows_marker_error(&error) => {
				last_error = Some(("validar", error));
				if attempt + 1 < WINDOWS_MARKER_RETRY_ATTEMPTS {
					std::thread::sleep(WINDOWS_MARKER_RETRY_DELAY);
					continue;
				}
				break;
			}
			Err(error) => {
				return Err(format!(
					"Could not validate storage metadata {}: {error}",
					path.display(),
				));
			}
		};
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!(
				"Storage metadata {} is not a safe regular file.",
				path.display(),
			));
		}
		match fs::read(&path) {
			Ok(content) => {
				let marker: StorageMarker = serde_json::from_slice(&content)
					.map_err(|error| format!("Storage metadata {} is invalid: {error}", path.display()))?;
				if marker.format != STORAGE_MARKER_FORMAT || marker.version != STORAGE_MARKER_VERSION {
					return Err(format!(
						"Storage metadata {} uses an unsupported format.",
						path.display(),
					));
				}
				return Ok(Some(marker));
			}
			Err(error) if is_transient_windows_marker_error(&error) => {
				last_error = Some(("ler", error));
				if attempt + 1 < WINDOWS_MARKER_RETRY_ATTEMPTS {
					std::thread::sleep(WINDOWS_MARKER_RETRY_DELAY);
					continue;
				}
				break;
			}
			Err(error) => {
				return Err(format!(
					"Could not read storage metadata {}: {error}",
					path.display(),
				));
			}
		}
	}
	let (action, error) = last_error.expect("marker retry exhausted without error");
	Err(format!(
		"Could not {action} storage metadata {} after transient retries: {error}",
		path.display(),
	))
}

fn create_marked_directory(
	parent: &Path,
	prefix: &str,
	project_root: &Path,
	class: StorageClass,
) -> Result<PathBuf, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	for _ in 0..128 {
		let token = random_token()?;
		let candidate = parent.join(format!("{prefix}-{token}"));
		match fs::create_dir(&candidate) {
			Ok(()) => {
				let metadata = fs::symlink_metadata(&candidate)
					.map_err(|error| format!("Could not validate the created internal directory: {error}"))?;
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
					let _ = fs::remove_dir_all(&candidate);
					return Err("The created internal directory is not safe.".to_string());
				}
				let marker = StorageMarker {
					format: STORAGE_MARKER_FORMAT.to_string(),
					version: STORAGE_MARKER_VERSION,
					project_key: canonical_project_key(project_root),
					class,
					created_at_unix_ms: current_unix_ms(),
					blob_ids: Vec::new(),
				};
				if let Err(error) = write_marker(&candidate, &marker) {
					let _ = fs::remove_dir_all(&candidate);
					return Err(error);
				}
				safe_fs::sync_directory(parent)
					.map_err(|error| format!("Could not sync internal storage: {error}"))?;
				register_active_path(&candidate)?;
				return Ok(candidate);
			}
			Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
			Err(error) => {
				return Err(format!("Could not create a safe internal directory: {error}"));
			}
		}
	}
	Err("Could not reserve a unique internal directory.".to_string())
}

pub(crate) fn create_files_apply_staging_directory(project_root: &Path) -> Result<PathBuf, String> {
	let base = ensure_storage_base()?;
	let staging_root = safe_fs::create_descendant_directories_no_reparse(
		&base,
		Path::new("files-apply"),
	)
	.map_err(|error| format!("Could not prepare safe Apply staging: {error}"))?;
	create_marked_directory(
		&staging_root,
		"apply",
		project_root,
		StorageClass::ActiveStaging,
	)
}

pub(crate) fn create_snapshot_directory(project_root: &Path) -> Result<PathBuf, String> {
	let base = ensure_storage_base()?;
	create_marked_directory(
		&base,
		"undo",
		project_root,
		StorageClass::RecoveryCritical,
	)
}

pub(crate) fn mark_storage_class(
	directory: &Path,
	class: StorageClass,
) -> Result<(), String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let mut marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	marker.class = class;
	write_marker(directory, &marker)
}

pub(crate) fn register_active_path(path: &Path) -> Result<(), String> {
	let mut state = runtime_state()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	state.active_paths.insert(path.to_path_buf());
	Ok(())
}

pub(crate) fn release_active_path(path: &Path) {
	if let Ok(mut state) = runtime_state().lock() {
		state.active_paths.remove(path);
	}
}

pub(crate) fn register_native_drop(path: &Path) -> Result<(), String> {
	let base = storage_base_directory().join("native-drop");
	let canonical_base = fs::canonicalize(&base)
		.map_err(|error| format!("Could not validate the temporary-drop root: {error}"))?;
	let canonical_path = fs::canonicalize(path)
		.map_err(|error| format!("Could not validate the temporary drop: {error}"))?;
	if !canonical_path.starts_with(&canonical_base) || canonical_path == canonical_base {
		return Err("The temporary drop does not belong to the expected internal storage.".to_string());
	}
	let metadata = fs::symlink_metadata(&canonical_path)
		.map_err(|error| format!("Could not validate the temporary drop: {error}"))?;
	if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
		return Err("The temporary drop is not a safe directory.".to_string());
	}
	register_active_path(&canonical_path)
}

pub(crate) fn release_native_drop(path: &Path) {
	release_active_path(path);
}

fn reservation_totals(state: &RuntimeStorageState) -> (u64, HashMap<String, u64>) {
	let mut global = 0_u64;
	let mut projects = HashMap::new();
	for reservation in state.reservations.values() {
		global = global.saturating_add(reservation.bytes);
		let project_total = projects
			.entry(reservation.project_key.clone())
			.or_insert(0_u64);
		*project_total = project_total.saturating_add(reservation.bytes);
	}
	(global, projects)
}

fn exceeds_soft_threshold(
	limits: StorageLimits,
	usage: &StorageUsage,
	reserved_global: u64,
	reserved_project: u64,
	project_key: &str,
	required_bytes: u64,
) -> bool {
	usage
		.project_bytes(project_key)
		.saturating_add(reserved_project)
		.saturating_add(required_bytes) > limits.project_soft_bytes() ||
		usage
			.global_bytes
			.saturating_add(reserved_global)
			.saturating_add(required_bytes) > limits.global_soft_bytes()
}

fn check_capacity(
	limits: StorageLimits,
	usage: &StorageUsage,
	reserved_global: u64,
	reserved_project: u64,
	project_key: &str,
	required_bytes: u64,
	available_bytes: u64,
) -> Result<(), String> {
	let project_total = usage
		.project_bytes(project_key)
		.saturating_add(reserved_project)
		.checked_add(required_bytes)
		.ok_or_else(|| "Project storage quota calculation exceeded the numeric limit.".to_string())?;
	if project_total > limits.project_hard_bytes {
		return Err(format!(
			"The operation requires safe internal storage but would exceed this project's {} GiB quota.",
			limits.project_hard_bytes / (1024 * 1024 * 1024),
		));
	}

	let global_total = usage
		.global_bytes
		.saturating_add(reserved_global)
		.checked_add(required_bytes)
		.ok_or_else(|| "Global storage quota calculation exceeded the numeric limit.".to_string())?;
	if global_total > limits.global_hard_bytes {
		return Err(format!(
			"The operation requires safe internal storage but would exceed Orqeto's global {} GiB quota.",
			limits.global_hard_bytes / (1024 * 1024 * 1024),
		));
	}

	let required_physical = required_bytes
		.saturating_add(reserved_global)
		.saturating_add(limits.free_space_margin_bytes);
	if available_bytes < required_physical {
		return Err(format!(
			"There is not enough free space to reserve the operation safely. At least {} free bytes are required including the safety margin.",
			required_physical,
		));
	}
	Ok(())
}

