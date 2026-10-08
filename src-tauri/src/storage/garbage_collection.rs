fn garbage_collect_internal(base: &Path) -> Result<(), String> {
	let active = active_paths_snapshot()?;
	let mut candidates = Vec::<(u8, PathBuf)>::new();
	if let Ok(entries) = fs::read_dir(base) {
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan internal snapshots: {error}"))?;
			let path = entry.path();
			let name = entry.file_name().to_string_lossy().to_string();
			if !name.starts_with("undo-") || is_runtime_active(&active, &path) {
				continue;
			}
			let Some(marker) = read_marker(&path)? else {
				continue;
			};
			if let Some(rank) = marker.class.gc_rank() {
				candidates.push((rank, path));
			}
		}
	}
	let files_apply = base.join("files-apply");
	if let Ok(entries) = fs::read_dir(&files_apply) {
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan staging: {error}"))?;
			let path = entry.path();
			if is_runtime_active(&active, &path) {
				continue;
			}
			let metadata = validate_managed_path_components(base, &path)?;
			if !metadata.is_dir() {
				return Err(format!("Staging entry {} is not a safe directory.", path.display()));
			}
			let class = read_marker(&path)?
				.map(|marker| marker.class)
				.unwrap_or(StorageClass::CompletedStaging);
			let rank = match class {
				StorageClass::ActiveStaging => Some(1),
				StorageClass::ActiveUndo | StorageClass::RecoveryCritical => None,
				other => other.gc_rank(),
			};
			if let Some(rank) = rank {
				candidates.push((rank, path));
			}
		}
	}
	let native_drop = base.join("native-drop");
	if let Ok(entries) = fs::read_dir(&native_drop) {
		let now = SystemTime::now();
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan temporary drops: {error}"))?;
			let path = entry.path();
			if is_runtime_active(&active, &path) {
				continue;
			}
			let modified = fs::symlink_metadata(&path)
				.and_then(|metadata| metadata.modified())
				.unwrap_or(now);
			if now.duration_since(modified).unwrap_or_default() >= STALE_NATIVE_DROP_AGE {
				candidates.push((0, path));
			}
		}
	}
	candidates.sort_by_key(|(rank, _)| *rank);
	for (_, candidate) in candidates {
		safe_remove_managed_tree(
			base,
			&candidate,
		)?;
	}

	let refs = referenced_blobs(base)?;
	let blob_root = base.join("blobs");
	if let Ok(entries) = fs::read_dir(&blob_root) {
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan internal blobs: {error}"))?;
			let path = entry.path();
			let name = entry.file_name().to_string_lossy().to_string();
			let Some(blob_id) = name.strip_suffix(".blob") else {
				continue;
			};
			if refs.contains(blob_id) {
				continue;
			}
			let metadata = fs::symlink_metadata(&path)
				.map_err(|error| format!("Could not validate blob {}: {error}", path.display()))?;
			if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
				return Err(format!("Garbage collection rejected an unsafe internal blob at {}.", path.display()));
			}
			fs::remove_file(&path)
				.map_err(|error| format!("Could not remove unreferenced blob {}: {error}", path.display()))?;
		}
	}
	Ok(())
}

pub(crate) fn garbage_collect() -> Result<(), String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let base = ensure_storage_base()?;
	garbage_collect_internal(&base)
}

#[cfg(target_os = "windows")]
fn available_space_bytes(path: &Path) -> Result<u64, String> {
	use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
	#[link(name = "kernel32")]
	extern "system" {
		fn GetDiskFreeSpaceExW(
			lp_directory_name: *const u16,
			lp_free_bytes_available_to_caller: *mut u64,
			lp_total_number_of_bytes: *mut u64,
			lp_total_number_of_free_bytes: *mut u64,
		) -> i32;
	}
	fn wide(value: &OsStr) -> Vec<u16> {
		value.encode_wide().chain(std::iter::once(0)).collect()
	}
	let path = wide(path.as_os_str());
	let mut available = 0_u64;
	let mut total = 0_u64;
	let mut free = 0_u64;
	let result = unsafe {
		GetDiskFreeSpaceExW(
			path.as_ptr(),
			&mut available,
			&mut total,
			&mut free,
		)
	};
	if result == 0 {
		Err(format!("Could not query storage free space: {}", std::io::Error::last_os_error()))
	} else {
		Ok(available)
	}
}

#[cfg(unix)]
fn available_space_bytes(path: &Path) -> Result<u64, String> {
	let output = std::process::Command::new("df")
		.arg("-Pk")
		.arg(path)
		.output()
		.map_err(|error| format!("Could not query storage free space: {error}"))?;
	if !output.status.success() {
		return Err("Could not query storage free space.".to_string());
	}
	let text = String::from_utf8_lossy(&output.stdout);
	let line = text
		.lines()
		.filter(|line| !line.trim().is_empty())
		.next_back()
		.ok_or_else(|| "The free-space query returned no data.".to_string())?;
	let columns = line.split_whitespace().collect::<Vec<_>>();
	let available_kib = columns
		.get(columns.len().saturating_sub(3))
		.ok_or_else(|| "The free-space query returned an unexpected format.".to_string())?
		.parse::<u64>()
		.map_err(|_| "The free-space query returned an invalid value.".to_string())?;
	Ok(available_kib.saturating_mul(1024))
}

#[cfg(not(any(target_os = "windows", unix)))]
fn available_space_bytes(_path: &Path) -> Result<u64, String> {
	Err("The current platform does not provide a supported free-space query.".to_string())
}

