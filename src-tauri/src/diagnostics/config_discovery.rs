fn scan_diagnostic_configs(root: &Path) -> Result<DiagnosticConfigs, String> {
	let project_ignore = ProjectIgnore::load(root)?;
	let mut stack = vec![root.to_path_buf()];
	let mut typecheck = Vec::new();
	let mut eslint = Vec::new();
	let mut package_json_files = Vec::new();
	let mut visited_entries = 0_usize;

	while let Some(directory) = stack.pop() {
		let mut entries = fs::read_dir(&directory)
			.map_err(|error| format!("Could not list {}: {error}", directory.display()))?
			.collect::<Result<Vec<_>, _>>()
			.map_err(|error| format!("Could not read a project entry: {error}"))?;
		entries.sort_by_key(|entry| entry.file_name());

		for entry in entries {
			visited_entries = visited_entries.saturating_add(1);
			if visited_entries > MAX_CONFIG_SCAN_ENTRIES {
				return Err(format!(
					"Diagnostic configuration discovery exceeded the limit of {MAX_CONFIG_SCAN_ENTRIES} entries.",
				));
			}

			let entry_path = entry.path();
			let metadata = fs::symlink_metadata(&entry_path)
				.map_err(|error| format!("Could not identify {}: {error}", entry_path.display()))?;
			if safe_fs::metadata_is_link_or_reparse(&metadata) {
				continue;
			}

			if project_ignore.is_ignored(&entry_path, metadata.is_dir()) {
				continue;
			}

			let name = entry.file_name().to_string_lossy().into_owned();
			if metadata.is_dir() {
				if !is_scan_directory_excluded(&name) {
					stack.push(entry_path.clone());
				}
				continue;
			}

			if !metadata.is_file() {
				continue;
			}

			if name.eq_ignore_ascii_case("package.json") {
				package_json_files.push(entry_path.clone());
			}
			if is_typecheck_config(&name) {
				typecheck.push(entry_path.clone());
			} else if is_eslint_config(&name) {
				eslint.push(entry_path);
			}

			if typecheck.len() > MAX_DIAGNOSTIC_CONFIGS || eslint.len() > MAX_DIAGNOSTIC_CONFIGS {
				return Err(format!(
					"The project has too many diagnostic configurations. The limit is {MAX_DIAGNOSTIC_CONFIGS} per tool.",
				));
			}
		}
	}

	typecheck.sort();
	typecheck.dedup();
	package_json_files.sort();
	package_json_files.dedup();
	let typecheck = select_typecheck_configs(
		root,
		typecheck,
		&package_json_files,
	);
	eslint.sort();
	eslint.dedup();

	Ok(DiagnosticConfigs { typecheck, eslint })
}

#[tauri::command]
pub fn get_project_diagnostic_capabilities(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ProjectDiagnosticCapabilities, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	let configs = scan_diagnostic_configs(&root)?;

	let commands = read_project_validation_commands(&root);

	Ok(ProjectDiagnosticCapabilities {
		typecheck: !configs.typecheck.is_empty(),
		eslint: !configs.eslint.is_empty(),
		lint_fix_command: commands.lint_fix,
		test_command: commands.test,
		development_log_command: crate::project_logs::read_development_log_command(&root),
	})
}

#[tauri::command]
pub fn approve_project_diagnostics(
	root_folder: String,
	trust_state: State<'_, DiagnosticTrustState>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<(), String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	trust_state.approve(root)
}

#[tauri::command]
pub fn approve_project_validation_command(
	root_folder: String,
	kind: String,
	expected_command: String,
	trust_state: State<'_, DiagnosticTrustState>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<(), String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	let commands = read_project_validation_commands(&root);
	let current_command = get_project_validation_command(
		&commands,
		&kind,
	)?;

	if current_command != expected_command {
		return Err(
			"The configured validation command changed before approval. Review the current command and try again.".to_string(),
		);
	}

	trust_state.approve_custom_command(
		root,
		current_command,
	)
}

fn read_custom_validation_command(
	value: Option<&serde_json::Value>,
) -> Option<String> {
	let value = value?.as_str()?.trim();
	if value.is_empty() || value.chars().count() > MAX_CUSTOM_VALIDATION_COMMAND_CHARS {
		return None;
	}

	Some(value.to_string())
}

fn read_project_validation_commands(root: &Path) -> ProjectValidationCommands {
	let package_json = root.join("package.json");
	let Ok(content) = fs::read_to_string(package_json) else {
		return ProjectValidationCommands::default();
	};
	let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
		return ProjectValidationCommands::default();
	};
	let validation = value
		.get("orqetoDev")
		.and_then(|orqeto| orqeto.get("validation"));

	ProjectValidationCommands {
		lint_fix: read_custom_validation_command(
			validation.and_then(|validation| validation.get("lintFix")),
		),
		test: read_custom_validation_command(
			validation.and_then(|validation| validation.get("test")),
		),
	}
}

fn get_project_validation_command(
	commands: &ProjectValidationCommands,
	kind: &str,
) -> Result<String, String> {
	match kind {
		"lintfix" => commands.lint_fix.clone().ok_or_else(|| {
			"No custom Lint Fix command is configured at orqetoDev.validation.lintFix.".to_string()
		}),
		"test" => commands.test.clone().ok_or_else(|| {
			"No Test command is configured at orqetoDev.validation.test.".to_string()
		}),
		_ => Err("The requested custom validation command is invalid.".to_string()),
	}
}


fn node_candidates() -> Vec<PathBuf> {
	let mut candidates = Vec::new();

	#[cfg(target_os = "windows")]
	{
		for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
			if let Some(program_files) = std::env::var_os(variable) {
				candidates.push(PathBuf::from(program_files).join("nodejs").join("node.exe"));
			}
		}
		if let Some(candidate) = resolve_from_path("node.exe") {
			candidates.push(candidate);
		}
	}

	#[cfg(not(target_os = "windows"))]
	if let Some(candidate) = resolve_from_path("node") {
		candidates.push(candidate);
	}

	let mut seen = HashSet::new();
	candidates.retain(|candidate| candidate.is_file() && seen.insert(candidate.clone()));
	candidates
}

fn find_node_module_entry(
	root: &Path,
	start: &Path,
	package_path: &[&str],
) -> Option<PathBuf> {
	let mut directory = start.to_path_buf();

	loop {
		let mut candidate = directory.join("node_modules");
		for component in package_path {
			candidate.push(component);
		}
		if candidate.is_file() {
			let canonical = fs::canonicalize(candidate).ok()?;
			if canonical.starts_with(root) {
				return Some(canonical);
			}
			return None;
		}

		if directory == root {
			break;
		}
		let parent = directory.parent()?;
		if !parent.starts_with(root) {
			break;
		}
		directory = parent.to_path_buf();
	}

	None
}

