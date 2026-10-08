fn build_file_manifest(
	root: &Path,
	source_path: &Path,
) -> Result<OverlayManifest, String> {
	let source = canonicalize_existing(source_path)?;
	ensure_overlay_source_separate(
		root,
		&source,
	)?;

	let metadata = fs::symlink_metadata(source_path)
		.map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err("Symbolic links and junctions cannot be used as a source.".to_string());
	}

	if !metadata.is_file() {
		return Err("The selected source is not a file.".to_string());
	}

	let source_name = source
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.ok_or_else(|| "Could not determine the applied file name.".to_string())?;

	if source_name.eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME) {
		let delete_plan = read_delete_manifest_file(
			root,
			&source,
		)?;

		return Ok(OverlayManifest {
			kind: ManifestKind::File {
				source_file: source,
				source_context: Vec::new(),
				source_components: Vec::new(),
				source_name,
			},
			delete_paths: delete_plan.files,
			delete_directories: delete_plan.directories,
			permanent_delete_directories: delete_plan.permanent_directories,
			common_directory_prefixes: Vec::new(),
			files: Vec::new(),
		});
	}
	let source_components = source
		.parent()
		.unwrap_or_else(|| Path::new(""))
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_string()),
			_ => None,
		})
		.collect::<Vec<_>>();
	let source_context = source_components
		.iter()
		.map(|component| component.to_lowercase())
		.collect::<Vec<_>>();
	let relative_path = PathBuf::from(&source_name);

	Ok(OverlayManifest {
		kind: ManifestKind::File {
			source_file: source.clone(),
			source_context,
			source_components,
			source_name,
		},
		delete_paths: Vec::new(),
		delete_directories: Vec::new(),
		permanent_delete_directories: Vec::new(),
		common_directory_prefixes: Vec::new(),
		files: vec![ManifestFile {
			relative_path,
			source: ManifestFileSource::Directory(source),
		}],
	})
}

fn find_virtual_zip_source(path: &Path) -> Option<(PathBuf, PathBuf)> {
	let mut current = path.parent();

	while let Some(candidate) = current {
		let is_zip = candidate
			.extension()
			.and_then(|extension| extension.to_str())
			.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

		if is_zip && candidate.is_file() {
			let internal_path = path
				.strip_prefix(candidate)
				.ok()?
				.to_path_buf();

			if !internal_path.as_os_str().is_empty() {
				return Some((
					candidate.to_path_buf(),
					internal_path,
				));
			}
		}

		current = candidate.parent();
	}

	None
}

fn path_starts_with_case_insensitive(
	path: &Path,
	prefix: &Path,
) -> bool {
	let path_values = path_segments(path);
	let prefix_values = path_segments(prefix);

	!prefix_values.is_empty() &&
		prefix_values.len() <= path_values.len() &&
		path_values[..prefix_values.len()] == prefix_values
}

fn path_ends_with_case_insensitive(
	path: &Path,
	suffix: &Path,
) -> bool {
	let path_values = path_segments(path);
	let suffix_values = path_segments(suffix);

	if suffix_values.is_empty() || suffix_values.len() > path_values.len() {
		return false;
	}

	path_values[path_values.len() - suffix_values.len()..] == suffix_values
}

fn zip_selection_candidates(files: &[ManifestFile]) -> Vec<PathBuf> {
	let mut values = HashSet::<PathBuf>::new();

	for file in files {
		values.insert(file.relative_path.clone());

		let mut current = file.relative_path.parent();

		while let Some(parent) = current {
			if parent.as_os_str().is_empty() {
				break;
			}

			values.insert(parent.to_path_buf());
			current = parent.parent();
		}
	}

	let mut sorted = values.into_iter().collect::<Vec<_>>();
	sorted.sort();
	sorted
}

fn resolve_zip_selection_prefix(
	files: &[ManifestFile],
	requested_prefix: &Path,
) -> Result<PathBuf, String> {
	let normalized = normalize_zip_entry_path(requested_prefix)?;

	if normalized.as_os_str().is_empty() {
		return Err("The selected subfolder inside the ZIP does not have a valid path.".to_string());
	}

	let has_exact_match = files.iter().any(|file| path_starts_with_case_insensitive(
		&file.relative_path,
		&normalized,
	));

	if has_exact_match {
		return Ok(normalized);
	}

	let suffix_matches = zip_selection_candidates(files)
		.into_iter()
		.filter(|candidate| path_ends_with_case_insensitive(
			candidate,
			&normalized,
		))
		.collect::<Vec<_>>();

	match suffix_matches.as_slice() {
		[only] => Ok(only.clone()),
		[] => Err(format!(
			"Subfolder {} was not found inside the ZIP.",
			requested_prefix.display(),
		)),
		_ => Err(format!(
			"Subfolder {} matches more than one path inside the ZIP. Select a more specific level.",
			requested_prefix.display(),
		)),
	}
}

