fn collect_delete_directory_tree(
	root: &Path,
	directory: &Path,
	project_ignore: &ProjectIgnore,
	files: &mut HashSet<PathBuf>,
	directories: &mut HashSet<PathBuf>,
) -> Result<(), String> {
	let resource_policy = machine_resource_policy();
	let mut budget = TraversalBudget::default();
	budget
		.record_path(directory, PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The folder marked for deletion", error))?;
	budget
		.record_directory(PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The folder marked for deletion", error))?;

	let relative_root = directory
		.strip_prefix(root)
		.map_err(|_| "Could not calculate the project-relative folder deletion path.".to_string())?
		.to_path_buf();
	directories.insert(relative_root);

	let entries = fs::read_dir(directory)
		.map_err(|error| format!("Could not list folder marked for deletion {}: {error}", directory.display()))?;
	let mut stack = Vec::with_capacity(resource_policy.worker_count.saturating_mul(4).max(4));
	stack.push((directory.to_path_buf(), entries));

	while !stack.is_empty() {
		let next = stack
			.last_mut()
			.and_then(|(_, entries)| entries.next());
		let Some(next) = next else {
			stack.pop();
			continue;
		};
		let entry = next.map_err(|error| {
			let parent = stack
				.last()
				.map(|(path, _)| path.as_path())
				.unwrap_or(directory);
			format!("Could not read an entry from folder marked for deletion {}: {error}", parent.display())
		})?;
		let path = entry.path();
		budget
			.record_entry(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The folder marked for deletion", error))?;
		budget
			.record_path(&path, PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The folder marked for deletion", error))?;

		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| format!("Could not validate deletion target {}: {error}", path.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!(
				"Folder deletion was rejected because {} is a symbolic link or junction.",
				path.display(),
			));
		}

		let canonical = canonicalize_existing(&path)?;
		if !canonical.starts_with(root) {
			return Err(format!(
				"Folder deletion was rejected because {} escapes the project root.",
				path.display(),
			));
		}
		let relative = canonical
			.strip_prefix(root)
			.map_err(|_| "Could not calculate a project-relative deletion path.".to_string())?
			.to_path_buf();

		if metadata.is_file() {
			budget
				.record_file(PROJECT_DISCOVERY_LIMITS)
				.map_err(|error| overlay_traversal_limit_error("The folder marked for deletion", error))?;
			if project_ignore.is_ignored(&canonical, false) {
				return Err(format!(
					"Folder deletion was rejected because .orqeto-devignore protects {}.",
					normalize_relative_display(&relative),
				));
			}
			files.insert(relative);
			continue;
		}

		if !metadata.is_dir() {
			return Err(format!(
				"Folder deletion was rejected because {} is neither a regular file nor a folder.",
				path.display(),
			));
		}

		budget
			.record_directory(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The folder marked for deletion", error))?;
		if project_ignore.is_ignored(&canonical, true) {
			return Err(format!(
				"Folder deletion was rejected because .orqeto-devignore protects {}.",
				normalize_relative_display(&relative),
			));
		}
		directories.insert(relative);
		let child_entries = fs::read_dir(&canonical)
			.map_err(|error| format!("Could not list folder marked for deletion {}: {error}", canonical.display()))?;
		stack.push((canonical, child_entries));
	}

	Ok(())
}
