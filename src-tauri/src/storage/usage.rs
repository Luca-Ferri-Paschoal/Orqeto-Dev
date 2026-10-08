fn collect_marked_directory_usage(
	usage: &mut StorageUsage,
	project_blob_refs: &mut HashMap<String, HashSet<String>>,
	directory: &Path,
) -> Result<(), String> {
	let base = storage_base_directory();
	let metadata = validate_managed_path_components(&base, directory)?;
	if !metadata.is_dir() {
		return Err(format!("Internal entry {} is not a safe directory.", directory.display()));
	}
	let Some(marker) = read_marker(directory)? else {
		add_usage(
			usage,
			None,
			directory_size_no_follow(directory)?,
		);
		return Ok(());
	};
	add_usage(
		usage,
		Some(&marker.project_key),
		directory_size_no_follow(directory)?,
	);
	let refs = project_blob_refs.entry(marker.project_key).or_default();
	refs.extend(marker.blob_ids);
	Ok(())
}

fn collect_usage(base: &Path) -> Result<StorageUsage, String> {
	let mut usage = StorageUsage::default();
	let mut project_blob_refs = HashMap::<String, HashSet<String>>::new();
	let mut blob_sizes = HashMap::<String, u64>::new();
	let entries = match fs::read_dir(base) {
		Ok(entries) => entries,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(usage),
		Err(error) => return Err(format!("Could not measure internal storage: {error}")),
	};
	for entry in entries {
		let entry = entry.map_err(|error| format!("Could not measure an internal entry: {error}"))?;
		let path = entry.path();
		let name = entry.file_name().to_string_lossy().to_string();
		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| format!("Could not validate {}: {error}", path.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", path.display()));
		}
		if name.starts_with("undo-") && metadata.is_dir() {
			collect_marked_directory_usage(
				&mut usage,
				&mut project_blob_refs,
				&path,
			)?;
			continue;
		}
		if name == "files-apply" && metadata.is_dir() {
			for child in fs::read_dir(&path)
				.map_err(|error| format!("Could not measure internal staging: {error}"))?
			{
				let child = child.map_err(|error| format!("Could not measure a staging entry: {error}"))?;
				collect_marked_directory_usage(
					&mut usage,
					&mut project_blob_refs,
					&child.path(),
				)?;
			}
			continue;
		}
		if name == "blobs" && metadata.is_dir() {
			for blob in fs::read_dir(&path)
				.map_err(|error| format!("Could not measure internal blobs: {error}"))?
			{
				let blob = blob.map_err(|error| format!("Could not measure an internal blob: {error}"))?;
				let blob_path = blob.path();
				let blob_metadata = fs::symlink_metadata(&blob_path)
					.map_err(|error| format!("Could not validate {}: {error}", blob_path.display()))?;
				if safe_fs::metadata_is_link_or_reparse(&blob_metadata) || !blob_metadata.is_file() {
					return Err(format!("Internal blob {} is not a safe file.", blob_path.display()));
				}
				let name = blob.file_name().to_string_lossy().to_string();
				if let Some(blob_id) = name.strip_suffix(".blob") {
					blob_sizes.insert(blob_id.to_string(), blob_metadata.len());
				}
				usage.global_bytes = usage.global_bytes.saturating_add(blob_metadata.len());
			}
			continue;
		}
		add_usage(
			&mut usage,
			None,
			directory_size_no_follow(&path)?,
		);
	}
	for (project_key, refs) in project_blob_refs {
		let project_usage = usage.projects.entry(project_key).or_insert(0);
		for blob_id in refs {
			*project_usage = project_usage.saturating_add(blob_sizes.get(&blob_id).copied().unwrap_or(0));
		}
	}
	Ok(usage)
}

fn active_paths_snapshot() -> Result<HashSet<PathBuf>, String> {
	runtime_state()
		.lock()
		.map(|state| state.active_paths.clone())
		.map_err(|_| "The storage manager became unavailable.".to_string())
}

fn safe_remove_managed_tree(
	base: &Path,
	candidate: &Path,
) -> Result<(), String> {
	match fs::symlink_metadata(candidate) {
		Ok(_) => {}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
		Err(error) => {
			return Err(format!("Could not validate {} before cleanup: {error}", candidate.display()));
		}
	}
	let metadata = validate_managed_path_components(base, candidate)
		.map_err(|error| format!("A limpeza recusou {}: {error}", candidate.display()))?;
	if metadata.is_file() {
		fs::remove_file(candidate)
			.map_err(|error| format!("Could not remove {}: {error}", candidate.display()))?;
		return Ok(());
	}
	let mut stack = vec![candidate.to_path_buf()];
	while let Some(directory) = stack.pop() {
		for entry in fs::read_dir(&directory)
			.map_err(|error| format!("Could not validate {} before cleanup: {error}", directory.display()))?
		{
			let entry = entry.map_err(|error| format!("Could not validate an entry before cleanup: {error}"))?;
			let path = entry.path();
			let metadata = fs::symlink_metadata(&path)
				.map_err(|error| format!("Could not validate {} before cleanup: {error}", path.display()))?;
			if safe_fs::metadata_is_link_or_reparse(&metadata) {
				return Err(format!("Cleanup rejected the internal link/reparse point {}.", path.display()));
			}
			if metadata.is_dir() {
				stack.push(path);
			}
		}
	}
	fs::remove_dir_all(candidate)
		.map_err(|error| format!("Could not remove {}: {error}", candidate.display()))
}

pub(crate) fn remove_managed_directory(path: &Path) -> Result<(), String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	release_active_path(path);
	let base = storage_base_directory();
	safe_remove_managed_tree(
		&base,
		path,
	)
}

fn is_runtime_active(
	active: &HashSet<PathBuf>,
	path: &Path,
) -> bool {
	let protects = |candidate: &Path| {
		active.iter().any(|active_path| {
			active_path == candidate ||
				active_path.starts_with(candidate) ||
				candidate.starts_with(active_path)
		})
	};
	if protects(path) {
		return true;
	}
	fs::canonicalize(path)
		.map(|canonical| protects(&canonical))
		.unwrap_or(false)
}

fn referenced_blobs(base: &Path) -> Result<HashSet<String>, String> {
	let mut refs = HashSet::new();
	for entry in fs::read_dir(base)
		.map_err(|error| format!("Could not scan storage references: {error}"))?
	{
		let entry = entry.map_err(|error| format!("Could not scan an internal entry: {error}"))?;
		let name = entry.file_name().to_string_lossy().to_string();
		if !name.starts_with("undo-") {
			continue;
		}
		let path = entry.path();
		let metadata = validate_managed_path_components(base, &path)?;
		if !metadata.is_dir() {
			return Err(format!("Snapshot entry {} is not a safe directory.", path.display()));
		}
		if let Some(marker) = read_marker(&path)? {
			refs.extend(marker.blob_ids);
		}
	}
	Ok(refs)
}

