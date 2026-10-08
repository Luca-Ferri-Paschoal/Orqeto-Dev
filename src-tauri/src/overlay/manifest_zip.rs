fn build_zip_manifest(
	root: &Path,
	archive_path: &Path,
	selected_internal_path: Option<&Path>,
) -> Result<OverlayManifest, String> {
	let archive_canonical = canonicalize_existing(archive_path)?;

	if archive_canonical.starts_with(root) {
		return Err("The ZIP file used as the source must be outside the configured folder.".to_string());
	}

	let archive_file = File::open(&archive_canonical)
		.map_err(|error| format!("Could not open {}: {error}", archive_canonical.display()))?;
	let mut archive = ZipArchive::new(archive_file)
		.map_err(|error| format!("File {} is not a valid ZIP: {error}", archive_canonical.display()))?;

	if archive.len() > MAX_ZIP_ENTRIES {
		return Err(format!(
			"The ZIP contains more than {MAX_ZIP_ENTRIES} entries and was rejected.",
		));
	}

	let mut total_uncompressed_bytes = 0_u64;
	let mut seen_paths = HashSet::new();
	let mut file_paths = HashSet::new();
	let mut files = Vec::new();
	let mut delete_paths = Vec::new();
	let mut delete_directories = Vec::new();
	let mut permanent_delete_directories = Vec::new();

	for index in 0..archive.len() {
		let mut entry = archive
			.by_index(index)
			.map_err(|error| format!("Could not read a ZIP entry: {error}"))?;
		let enclosed_path = entry
			.enclosed_name()
			.ok_or_else(|| format!("The ZIP contains an unsafe path: {}", entry.name()))?;
		let relative_path = normalize_zip_entry_path(&enclosed_path)?;

		if relative_path.as_os_str().is_empty() {
			if entry.is_dir() {
				continue;
			}

			return Err(format!(
				"The ZIP contains an entry without a valid path: {}",
				entry.name(),
			));
		}

		let normalized_path = relative_path
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if seen_paths.contains(&normalized_path) {
			return Err(format!(
				"The ZIP contains the same path more than once: {}",
				entry.name(),
			));
		}

		if entry.encrypted() {
			return Err(format!(
				"The ZIP contains an encrypted entry and cannot be applied: {}",
				entry.name(),
			));
		}

		if entry.is_symlink() {
			return Err(format!(
				"The ZIP contains a symbolic link and cannot be applied: {}",
				entry.name(),
			));
		}

		let mut ancestor = normalized_path.as_str();

		while let Some(separator_index) = ancestor.rfind('/') {
			ancestor = &ancestor[..separator_index];

			if file_paths.contains(ancestor) {
				return Err(format!(
					"The ZIP contains a conflicting structure at {}.",
					entry.name(),
				));
			}
		}

		if entry.is_file() {
			let descendant_prefix = format!("{normalized_path}/");

			if seen_paths
				.iter()
				.any(|path: &String| path.starts_with(&descendant_prefix))
			{
				return Err(format!(
					"The ZIP contains a conflicting structure at {}.",
					entry.name(),
				));
			}
		}

		seen_paths.insert(normalized_path.clone());

		if entry.is_file() {
			file_paths.insert(normalized_path);
		}

		if entry.is_dir() {
			continue;
		}

		if !entry.is_file() {
			return Err(format!(
				"The ZIP contains an unsupported entry: {}",
				entry.name(),
			));
		}

		let is_delete_manifest = relative_path
			.file_name()
			.is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME));

		if is_delete_manifest {
			if normal_components(&relative_path).len() != 1 {
				return Err(format!(
					"Reserved file {DELETE_MANIFEST_FILE_NAME} must be at the root of the ZIP.",
				));
			}

			if selected_internal_path.is_none() {
				if entry.size() > MAX_DELETE_MANIFEST_BYTES {
					return Err(delete_manifest_size_error(entry.size()));
				}

				let mut content = String::new();
				entry
					.read_to_string(&mut content)
					.map_err(|error| format!("Could not read {DELETE_MANIFEST_FILE_NAME} as UTF-8: {error}"))?;
				let delete_plan = parse_delete_manifest_content(
					root,
					&content,
				)?;
				delete_paths = delete_plan.files;
				delete_directories = delete_plan.directories;
				permanent_delete_directories = delete_plan.permanent_directories;
			}

			continue;
		}

		total_uncompressed_bytes = total_uncompressed_bytes
			.checked_add(entry.size())
			.ok_or_else(|| "The uncompressed ZIP size is invalid.".to_string())?;

		if total_uncompressed_bytes > MAX_ZIP_UNCOMPRESSED_BYTES {
			return Err("The ZIP exceeds 1 GB uncompressed and was rejected.".to_string());
		}

		files.push(ManifestFile {
			relative_path,
			source: ManifestFileSource::Zip(index),
		});
	}

	files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

	if let Some(selected_internal_path) = selected_internal_path {
		let selected_prefix = resolve_zip_selection_prefix(
			&files,
			selected_internal_path,
		)?;

		files.retain(|file| path_starts_with_case_insensitive(
			&file.relative_path,
			&selected_prefix,
		));

		if files.is_empty() {
			return Err(format!(
				"Selection {} inside the ZIP contains no files to apply.",
				selected_internal_path.display(),
			));
		}
	}

	let prefixes = common_directory_prefixes(&files);

	Ok(OverlayManifest {
		kind: ManifestKind::Zip {
			archive_path: archive_canonical,
		},
		delete_paths,
		delete_directories,
		permanent_delete_directories,
		common_directory_prefixes: prefixes,
		files,
	})
}

fn build_manifest(
	root_folder: &str,
	paths: &[String],
) -> Result<(PathBuf, OverlayManifest), String> {
	if paths.len() != 1 {
		return Err("Each application item must be analyzed separately.".to_string());
	}

	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let source_path = PathBuf::from(&paths[0]);

	if let Some((archive_path, internal_path)) = find_virtual_zip_source(&source_path) {
		return Ok((
			root.clone(),
			build_zip_manifest(
				&root,
				&archive_path,
				Some(&internal_path),
			)?,
		));
	}

	let metadata = fs::symlink_metadata(&source_path)
		.map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err("Symbolic links and junctions cannot be used as a source.".to_string());
	}

	if metadata.is_dir() {
		return Ok((
			root.clone(),
			build_directory_manifest(
				&root,
				&source_path,
			)?,
		));
	}

	if !metadata.is_file() {
		return Err("The Apply area accepts only files, folders, or ZIPs.".to_string());
	}

	let is_zip = source_path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

	if is_zip {
		return Ok((
			root.clone(),
			build_zip_manifest(
				&root,
				&source_path,
				None,
			)?,
		));
	}

	Ok((
		root.clone(),
		build_file_manifest(
			&root,
			&source_path,
		)?,
	))
}

