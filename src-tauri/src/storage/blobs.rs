pub(crate) fn store_stable_backup(
	source: &Path,
	snapshot_directory: &Path,
) -> Result<StoredBackup, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let metadata = fs::symlink_metadata(source)
		.map_err(|error| format!("Could not verify {}: {error}", source.display()))?;
	if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
		return Err(format!(
			"{} is not a safe regular file that can be preserved.",
			source.display(),
		));
	}
	let expected_permissions = permission_signature(&metadata);
	let before = content_fingerprint(source)?;
	let blob_id = blob_id_for(before, expected_permissions);
	let path = ensure_blob(
		source,
		before,
		expected_permissions,
		&blob_id,
	)?;
	let after = content_fingerprint(source)?;
	let after_metadata = fs::symlink_metadata(source)
		.map_err(|error| format!("Could not revalidate {}: {error}", source.display()))?;
	if safe_fs::metadata_is_link_or_reparse(&after_metadata) ||
		!after_metadata.is_file() ||
		before != after ||
		permission_signature(&after_metadata) != expected_permissions
	{
		return Err(format!(
			"{} changed while the backup was being preserved. The operation was cancelled before changing the project.",
			source.display(),
		));
	}
	add_blob_reference(
		snapshot_directory,
		&blob_id,
	)?;
	Ok(StoredBackup { blob_id, path })
}

pub(crate) fn set_snapshot_active_undo(directory: &Path) -> Result<(), String> {
	mark_storage_class(
		directory,
		StorageClass::ActiveUndo,
	)
}

pub(crate) fn storage_class(directory: &Path) -> Result<StorageClass, String> {
	validate_managed_directory(directory)?;
	let marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	Ok(marker.class)
}

pub(crate) fn snapshot_directories_by_class(
	class: StorageClass,
) -> Result<Vec<PathBuf>, String> {
	let base = ensure_storage_base()?;
	let entries = fs::read_dir(&base)
		.map_err(|error| format!("Could not inspect Orqeto internal storage: {error}"))?;
	let mut directories = Vec::new();

	for entry in entries {
		let entry = entry
			.map_err(|error| format!("Could not inspect an Orqeto storage entry: {error}"))?;
		let name = entry.file_name().to_string_lossy().to_string();
		if !name.starts_with("undo-") {
			continue;
		}

		let directory = entry.path();
		validate_managed_directory(&directory)?;
		let marker = read_marker(&directory)?
			.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
		if marker.class == class {
			directories.push(directory);
		}
	}

	directories.sort();
	Ok(directories)
}

pub(crate) fn snapshot_blob_references(directory: &Path) -> Result<HashSet<String>, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	Ok(marker.blob_ids.into_iter().collect())
}

pub(crate) fn retain_snapshot_blob_references(
	directory: &Path,
	live_blob_ids: &HashSet<String>,
) -> Result<usize, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let mut marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	let previous_len = marker.blob_ids.len();
	marker.blob_ids.retain(|blob_id| live_blob_ids.contains(blob_id));
	if marker.blob_ids.len() != previous_len {
		write_marker(directory, &marker)?;
	}
	Ok(marker.blob_ids.len())
}

fn usage_metadata_no_follow(path: &Path) -> Result<Option<fs::Metadata>, String> {
	match fs::symlink_metadata(path) {
		Ok(metadata) => Ok(Some(metadata)),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
		Err(error) => Err(format!("Could not measure {}: {error}", path.display())),
	}
}

fn directory_size_no_follow(path: &Path) -> Result<u64, String> {
	let Some(metadata) = usage_metadata_no_follow(path)? else {
		return Ok(0);
	};
	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", path.display()));
	}
	if metadata.is_file() {
		return Ok(metadata.len());
	}
	if !metadata.is_dir() {
		return Ok(0);
	}
	let mut total = 0_u64;
	let mut stack = vec![path.to_path_buf()];
	while let Some(directory) = stack.pop() {
		let entries = match fs::read_dir(&directory) {
			Ok(entries) => entries,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
			Err(error) => {
				return Err(format!("Could not measure {}: {error}", directory.display()));
			}
		};
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not measure an internal entry: {error}"))?;
			let child = entry.path();
			let Some(metadata) = usage_metadata_no_follow(&child)? else {
				continue;
			};
			if safe_fs::metadata_is_link_or_reparse(&metadata) {
				return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", child.display()));
			}
			if metadata.is_dir() {
				stack.push(child);
			} else if metadata.is_file() {
				total = total
					.checked_add(metadata.len())
					.ok_or_else(|| "Internal storage usage exceeded the numeric limit.".to_string())?;
			}
		}
	}
	Ok(total)
}

fn add_usage(
	usage: &mut StorageUsage,
	project_key: Option<&str>,
	bytes: u64,
) {
	usage.global_bytes = usage.global_bytes.saturating_add(bytes);
	if let Some(project_key) = project_key {
		let value = usage.projects.entry(project_key.to_string()).or_insert(0);
		*value = value.saturating_add(bytes);
	}
}

fn validate_managed_path_components(
	base: &Path,
	candidate: &Path,
) -> Result<fs::Metadata, String> {
	if candidate == base || !candidate.starts_with(base) {
		return Err("The internal path does not belong to Orqeto-managed storage.".to_string());
	}
	let base_metadata = fs::symlink_metadata(base)
		.map_err(|error| format!("Could not validate internal storage: {error}"))?;
	if safe_fs::metadata_is_link_or_reparse(&base_metadata) || !base_metadata.is_dir() {
		return Err("The internal storage root is not a stable directory.".to_string());
	}

	let relative = candidate
		.strip_prefix(base)
		.map_err(|_| "The internal path does not belong to Orqeto-managed storage.".to_string())?;
	let mut current = base.to_path_buf();
	let mut final_metadata = None;
	for component in relative.components() {
		let std::path::Component::Normal(name) = component else {
			return Err("The internal path contains an unsafe component.".to_string());
		};
		current.push(name);
		let metadata = fs::symlink_metadata(&current)
			.map_err(|error| format!("Could not validate {}: {error}", current.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", current.display()));
		}
		final_metadata = Some(metadata);
	}
	final_metadata.ok_or_else(|| "The internal path does not identify a managed entry.".to_string())
}

pub(crate) fn validate_managed_directory(path: &Path) -> Result<(), String> {
	let base = storage_base_directory();
	let metadata = validate_managed_path_components(&base, path)?;
	if !metadata.is_dir() {
		return Err(format!(
			"Internal entry {} is not a safe directory.",
			path.display(),
		));
	}
	Ok(())
}

pub(crate) fn validate_managed_regular_file(path: &Path) -> Result<(), String> {
	let base = storage_base_directory();
	let metadata = validate_managed_path_components(&base, path)?;
	if !metadata.is_file() {
		return Err(format!(
			"Internal file {} is not a safe regular file.",
			path.display(),
		));
	}
	Ok(())
}

