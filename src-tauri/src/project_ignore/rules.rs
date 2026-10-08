fn normalize_relative_rule_path(
	root: &Path,
	path: &Path,
) -> Result<String, String> {
	let relative = path
		.strip_prefix(root)
		.map_err(|_| "The submitted item is not inside the project folder.".to_string())?;
	let normalized = relative
		.to_string_lossy()
		.replace('\\', "/");

	if normalized.is_empty() {
		return Err("The project root cannot be added to ignore.".to_string());
	}

	if normalized.contains('\r') || normalized.contains('\n') {
		return Err("The path contains a line break and cannot become an ignore rule.".to_string());
	}

	Ok(normalized)
}

fn escape_gitignore_literal(path: &str) -> String {
	let mut escaped = String::with_capacity(path.len());

	for character in path.chars() {
		if matches!(
			character,
			'\\' | '*' | '?' | '[' | ']' | '!' | '#' | ' '
		) {
			escaped.push('\\');
		}

		escaped.push(character);
	}

	escaped
}

fn exact_ignore_rule(
	relative_path: &str,
	is_directory: bool,
) -> String {
	let escaped_path = escape_gitignore_literal(relative_path);

	if is_directory {
		format!("/{escaped_path}/")
	} else {
		format!("/{escaped_path}")
	}
}

fn exact_unignore_rules(
	relative_path: &str,
	is_directory: bool,
) -> Vec<String> {
	let parts = relative_path
		.split('/')
		.filter(|part| !part.is_empty())
		.collect::<Vec<_>>();
	let mut rules = Vec::new();

	for parent_depth in 1..parts.len() {
		let parent = parts[..parent_depth].join("/");
		rules.push(format!(
			"!/{}/",
			escape_gitignore_literal(&parent),
		));
	}

	let escaped_path = escape_gitignore_literal(relative_path);

	if is_directory {
		rules.push(format!("!/{escaped_path}/"));
		rules.push(format!("!/{escaped_path}/**"));
	} else {
		rules.push(format!("!/{escaped_path}"));
	}

	rules
}

fn append_managed_rules(
	ignore_file: &Path,
	rules: &[String],
) -> Result<(), String> {
	if rules.is_empty() {
		return Ok(());
	}

	let current_content = fs::read_to_string(ignore_file)
		.map_err(|error| format!("Could not read {}: {error}", ignore_file.display()))?;
	let line_ending = if current_content.contains("\r\n") {
		"\r\n"
	} else {
		"\n"
	};
	let needs_leading_line_ending = !current_content.is_empty() &&
		!current_content.ends_with('\n') &&
		!current_content.ends_with('\r');
	let needs_header = !current_content
		.lines()
		.any(|line| line.trim() == MANAGED_SECTION_HEADER);
	let mut appended = String::new();

	if needs_leading_line_ending {
		appended.push_str(line_ending);
	}

	if needs_header {
		if !current_content.is_empty() {
			appended.push_str(line_ending);
		}

		appended.push_str(MANAGED_SECTION_HEADER);
		appended.push_str(line_ending);
	}

	for rule in rules {
		appended.push_str(rule);
		appended.push_str(line_ending);
	}

	let mut next_content = current_content;
	next_content.push_str(&appended);
	safe_fs::atomic_write_bytes(ignore_file, next_content.as_bytes())
		.map_err(|error| format!("Could not update {}: {error}", ignore_file.display()))
}

#[tauri::command]
pub fn project_ignore_exists(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<bool, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	let ignore_file = project_ignore_path(&root);

	if ignore_file.exists() && !ignore_file.is_file() {
		return Err(format!(
			"{} exists but is not a file.",
			ignore_file.display(),
		));
	}

	Ok(ignore_file.is_file())
}

fn create_project_ignore_blocking(root_folder: String) -> Result<bool, String> {
	let _guard = PROJECT_IGNORE_UPDATE_LOCK
		.lock()
		.map_err(|_| "The Dev Ignore coordinator became unavailable.".to_string())?;
	let root = canonical_project_root(&root_folder)?;
	let ignore_file = project_ignore_path(&root);

	if ignore_file.exists() {
		if ignore_file.is_file() {
			return Ok(false);
		}

		return Err(format!(
			"{} exists but is not a file.",
			ignore_file.display(),
		));
	}

	let mut file = OpenOptions::new()
		.write(true)
		.create_new(true)
		.open(&ignore_file)
		.map_err(|error| format!("Could not create {}: {error}", ignore_file.display()))?;

	file.write_all(DEFAULT_PROJECT_IGNORE.as_bytes())
		.map_err(|error| format!("Could not write {}: {error}", ignore_file.display()))?;
	file.sync_all()
		.map_err(|error| format!("Could not finish creating {}: {error}", ignore_file.display()))?;

	Ok(true)
}

