pub(crate) fn reserve(
	project_root: &Path,
	required_bytes: u64,
) -> Result<StorageReservation, String> {
	reserve_with_limits(
		project_root,
		required_bytes,
		StorageLimits::default(),
		None,
	)
}

fn reserve_with_limits(
	project_root: &Path,
	required_bytes: u64,
	limits: StorageLimits,
	available_override: Option<u64>,
) -> Result<StorageReservation, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let base = ensure_storage_base()?;
	let project_key = canonical_project_key(project_root);
	let mut usage = collect_usage(&base)?;
	let (mut reserved_global, mut reserved_projects) = {
		let state = runtime_state()
			.lock()
			.map_err(|_| "The storage manager became unavailable.".to_string())?;
		reservation_totals(&state)
	};
	let project_reserved = reserved_projects.get(&project_key).copied().unwrap_or(0);
	let soft_pressure = exceeds_soft_threshold(
		limits,
		&usage,
		reserved_global,
		project_reserved,
		&project_key,
		required_bytes,
	);
	if soft_pressure {
		garbage_collect_internal(&base)?;
		usage = collect_usage(&base)?;
		let state = runtime_state()
			.lock()
			.map_err(|_| "The storage manager became unavailable.".to_string())?;
		(reserved_global, reserved_projects) = reservation_totals(&state);
	}

	let available = match available_override {
		Some(value) => value,
		None => available_space_bytes(&base)?,
	};
	check_capacity(
		limits,
		&usage,
		reserved_global,
		reserved_projects.get(&project_key).copied().unwrap_or(0),
		&project_key,
		required_bytes,
		available,
	)?;

	let mut state = runtime_state()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	state.next_reservation_id = state.next_reservation_id.wrapping_add(1).max(1);
	let id = state.next_reservation_id;
	state.reservations.insert(
		id,
		ReservationRecord {
			project_key,
			bytes: required_bytes,
		},
	);
	Ok(StorageReservation { id })
}

pub(crate) fn snapshot_reservation_bytes(
	backup_bytes: u64,
	file_count: usize,
) -> Result<u64, String> {
	let metadata = SNAPSHOT_METADATA_ALLOWANCE_BYTES
		.checked_add((file_count as u64).saturating_mul(SNAPSHOT_METADATA_ALLOWANCE_PER_FILE_BYTES))
		.ok_or_else(|| "Snapshot reservation calculation exceeded the numeric limit.".to_string())?;
	backup_bytes
		.checked_add(metadata)
		.ok_or_else(|| "Snapshot reservation calculation exceeded the numeric limit.".to_string())
}

pub(crate) fn staging_reservation_bytes(
	source_bytes: u64,
	file_count: usize,
) -> Result<u64, String> {
	let metadata = STAGING_METADATA_ALLOWANCE_BYTES
		.checked_add((file_count as u64).saturating_mul(STAGING_METADATA_ALLOWANCE_PER_FILE_BYTES))
		.ok_or_else(|| "Staging reservation calculation exceeded the numeric limit.".to_string())?;
	source_bytes
		.checked_add(metadata)
		.ok_or_else(|| "Staging reservation calculation exceeded the numeric limit.".to_string())
}

fn content_fingerprint(path: &Path) -> Result<ContentFingerprint, String> {
	let mut file = File::open(path)
		.map_err(|error| format!("Could not verify {}: {error}", path.display()))?;
	let mut buffer = vec![0_u8; 64 * 1024];
	let mut size = 0_u64;
	let mut hasher = Sha256::new();
	loop {
		let read = file
			.read(&mut buffer)
			.map_err(|error| format!("Could not verify {}: {error}", path.display()))?;
		if read == 0 {
			break;
		}
		size = size
			.checked_add(read as u64)
			.ok_or_else(|| "Backup size exceeded the numeric limit.".to_string())?;
		hasher.update(&buffer[..read]);
	}
	let digest = hasher.finalize();
	let mut hash = [0_u8; 32];
	hash.copy_from_slice(&digest);
	Ok(ContentFingerprint { size, hash })
}

#[cfg(target_os = "windows")]
fn permission_signature(metadata: &fs::Metadata) -> u64 {
	if metadata.permissions().readonly() { 1 } else { 0 }
}

#[cfg(unix)]
fn permission_signature(metadata: &fs::Metadata) -> u64 {
	use std::os::unix::fs::PermissionsExt;
	metadata.permissions().mode() as u64
}

#[cfg(not(any(target_os = "windows", unix)))]
fn permission_signature(metadata: &fs::Metadata) -> u64 {
	if metadata.permissions().readonly() { 1 } else { 0 }
}

fn blob_id_for(
	fingerprint: ContentFingerprint,
	permissions: u64,
) -> String {
	format!(
		"{}-{:x}",
		encode_hex(&fingerprint.hash),
		permissions,
	)
}

fn valid_blob_id(value: &str) -> bool {
	let Some((hash, permissions)) = value.split_once('-') else {
		return false;
	};
	hash.len() == 64 &&
		hash.bytes().all(|byte| byte.is_ascii_hexdigit()) &&
		!permissions.is_empty() &&
		permissions.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn blob_path(blob_id: &str) -> Result<PathBuf, String> {
	if !valid_blob_id(blob_id) {
		return Err("The recovery blob identifier is invalid.".to_string());
	}
	let path = storage_base_directory()
		.join("blobs")
		.join(format!("{blob_id}.blob"));
	validate_managed_regular_file(&path)?;
	let metadata = fs::metadata(&path)
		.map_err(|error| format!("Could not validate recovery blob {}: {error}", path.display()))?;
	let fingerprint = content_fingerprint(&path)?;
	if blob_id_for(fingerprint, permission_signature(&metadata)) != blob_id {
		return Err(format!(
			"Recovery blob {} does not match the expected content identifier.",
			path.display(),
		));
	}
	Ok(path)
}

fn ensure_blob(
	source: &Path,
	fingerprint: ContentFingerprint,
	expected_permissions: u64,
	blob_id: &str,
) -> Result<PathBuf, String> {
	let base = ensure_storage_base()?;
	let blob_root = safe_fs::create_descendant_directories_no_reparse(
		&base,
		Path::new("blobs"),
	)
	.map_err(|error| format!("Could not prepare blob storage: {error}"))?;
	let path = blob_root.join(format!("{blob_id}.blob"));
	match fs::symlink_metadata(&path) {
		Ok(metadata) => {
			if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
				return Err("An existing internal blob is not a safe file.".to_string());
			}
		}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			match safe_fs::atomic_copy_create_new(source, &path) {
				Ok(_) => {}
				Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
				Err(error) => {
					return Err(format!("Could not persist the recovery blob: {error}"));
				}
			}
		}
		Err(error) => return Err(format!("Could not validate the recovery blob: {error}")),
	}
	let stored_metadata = fs::metadata(&path)
		.map_err(|error| format!("Could not validate recovery blob permissions: {error}"))?;
	let stored = content_fingerprint(&path)?;
	if stored != fingerprint || permission_signature(&stored_metadata) != expected_permissions {
		return Err("An internal blob does not match the content/permissions it is supposed to preserve.".to_string());
	}
	Ok(path)
}

fn add_blob_reference(
	snapshot_directory: &Path,
	blob_id: &str,
) -> Result<(), String> {
	let mut marker = read_marker(snapshot_directory)?
		.ok_or_else(|| "The snapshot has no storage metadata.".to_string())?;
	if !marker.blob_ids.iter().any(|value| value == blob_id) {
		marker.blob_ids.push(blob_id.to_string());
		marker.blob_ids.sort();
		write_marker(snapshot_directory, &marker)?;
	}
	Ok(())
}

