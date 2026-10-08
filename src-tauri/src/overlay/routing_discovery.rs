struct ProjectRoutingDiscovery {
	directory_matches: HashMap<String, Vec<PathBuf>>,
	file_matches: Vec<PathBuf>,
}

fn routing_scan_io_error(
	path: &Path,
	action: &str,
	error: &std::io::Error,
) -> String {
	format!(
		"Routing was rejected because the project scan could not be completed while {action} {}: {error}",
		path.display(),
	)
}

fn read_routing_directory(path: &Path) -> Result<fs::ReadDir, String> {
	fs::read_dir(path)
		.map_err(|error| routing_scan_io_error(path, "listar", &error))
}

fn collect_project_routing_discovery(
	root: &Path,
	target_names: &HashSet<String>,
	target_file_name: Option<&str>,
	project_ignore: &ProjectIgnore,
) -> Result<ProjectRoutingDiscovery, String> {
	let resource_policy = machine_resource_policy();
	let mut directory_matches = HashMap::<String, Vec<PathBuf>>::new();
	let mut file_matches = Vec::new();
	let mut budget = TraversalBudget::default();
	budget
		.record_path(root, PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The project", error))?;
	budget
		.record_directory(PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The project", error))?;

	let root_entries = read_routing_directory(root)?;
	let mut stack = Vec::with_capacity(resource_policy.worker_count.saturating_mul(4).max(4));
	stack.push((root.to_path_buf(), root_entries));

	while !stack.is_empty() {
		let next = stack
			.last_mut()
			.and_then(|(_, entries)| entries.next());

		let Some(next) = next else {
			stack.pop();
			continue;
		};
		let entry = next.map_err(|error| {
			let directory = stack
				.last()
				.map(|(path, _)| path.as_path())
				.unwrap_or(root);
			routing_scan_io_error(directory, "reading an entry from", &error)
		})?;
		let path = entry.path();
		budget
			.record_entry(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The project", error))?;
		budget
			.record_path(&path, PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The project", error))?;

		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| routing_scan_io_error(&path, "validar", &error))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			continue;
		}

		if metadata.is_dir() {
			budget
				.record_directory(PROJECT_DISCOVERY_LIMITS)
				.map_err(|error| overlay_traversal_limit_error("The project", error))?;
			if project_ignore.is_ignored(&path, true) {
				continue;
			}

			let normalized_name = entry
				.file_name()
				.to_string_lossy()
				.to_lowercase();
			if target_names.contains(&normalized_name) {
				let relative = path
					.strip_prefix(root)
					.map_err(|_| "Could not calculate a project-relative destination.".to_string())?
					.to_path_buf();
				directory_matches
					.entry(normalized_name)
					.or_default()
					.push(relative);
			}

			let child_entries = read_routing_directory(&path)?;
			stack.push((path, child_entries));
			continue;
		}

		if !metadata.is_file() {
			continue;
		}
		budget
			.record_file(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The project", error))?;
		if project_ignore.is_ignored(&path, false) {
			continue;
		}

		let matches_target_file = target_file_name.is_some_and(|target_name| {
			entry
				.file_name()
				.to_string_lossy()
				.eq_ignore_ascii_case(target_name)
		});
		if matches_target_file {
			let relative = path
				.strip_prefix(root)
				.map_err(|_| "Could not calculate a project-relative file.".to_string())?
				.to_path_buf();
			file_matches.push(relative);
		}
	}

	for paths in directory_matches.values_mut() {
		paths.sort();
	}
	file_matches.sort();

	Ok(ProjectRoutingDiscovery {
		directory_matches,
		file_matches,
	})
}

fn tail_match_count(
	left: &[String],
	right: &[String],
) -> usize {
	left.iter()
		.rev()
		.zip(right.iter().rev())
		.take_while(|(left_value, right_value)| left_value == right_value)
		.count()
}

fn strip_source_prefix<'a>(
	path: &'a Path,
	prefix: &Path,
) -> Option<&'a Path> {
	if prefix.as_os_str().is_empty() {
		return Some(path);
	}

	path.strip_prefix(prefix).ok()
}

fn count_existing_directory_depth(
	root: &Path,
	destination_relative_path: &Path,
	file_relative_path: &Path,
	project_ignore: &ProjectIgnore,
) -> usize {
	let mut current = root.join(destination_relative_path);
	let Some(parent) = file_relative_path.parent() else {
		return 0;
	};
	let mut count = 0_usize;

	for component in parent.components() {
		let Component::Normal(name) = component else {
			break;
		};

		current.push(name);

		if project_ignore.is_ignored(
			&current,
			true,
		) {
			break;
		}

		match fs::symlink_metadata(&current) {
			Ok(metadata) if metadata.is_dir() && !safe_fs::metadata_is_link_or_reparse(&metadata) => count += 1,
			_ => break,
		}
	}

	count
}

