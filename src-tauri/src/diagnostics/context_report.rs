fn build_context_data(
	root: &Path,
	kind: DiagnosticKind,
	file_limit: usize,
	diagnostics: Vec<ParsedDiagnostic>,
) -> Result<ProjectDiagnosticContextData, String> {
	if !(DIAGNOSTIC_FILE_LIMIT_MIN..=DIAGNOSTIC_FILE_LIMIT_MAX).contains(&file_limit) {
		return Err(format!(
			"The diagnostic file limit must be between {DIAGNOSTIC_FILE_LIMIT_MIN} and {DIAGNOSTIC_FILE_LIMIT_MAX}.",
		));
	}

	let diagnostics = filter_and_deduplicate(root, diagnostics)?;
	let error_count = diagnostics
		.iter()
		.filter(|diagnostic| diagnostic.severity == "error")
		.count();
	let warning_count = diagnostics
		.iter()
		.filter(|diagnostic| diagnostic.severity == "warning")
		.count();
	let preferred_severity = if diagnostics.iter().any(|diagnostic| diagnostic.file_path.is_some() && diagnostic.severity == "error") {
		"error"
	} else if diagnostics.iter().any(|diagnostic| diagnostic.file_path.is_some() && diagnostic.severity == "warning") {
		"warning"
	} else {
		"error"
	};
	let mut by_file: BTreeMap<PathBuf, Vec<ProjectDiagnosticMessage>> = BTreeMap::new();
	let mut global_messages = Vec::new();

	for diagnostic in diagnostics {
		let message = ProjectDiagnosticMessage {
			line: diagnostic.line,
			column: diagnostic.column,
			code: diagnostic.code,
			message: diagnostic.message,
			severity: diagnostic.severity,
		};
		match diagnostic.file_path {
			Some(file_path) => {
				by_file.entry(file_path).or_default().push(message);
			}
			None => global_messages.push(message),
		}
	}

	let total_files_with_issues = by_file.len();
	let issue_count = by_file.values().map(Vec::len).sum::<usize>() + global_messages.len();
	let mut selected_paths = by_file
		.iter()
		.map(|(path, messages)| {
			let has_preferred_severity = messages.iter().any(|message| message.severity == preferred_severity);
			(path.clone(), has_preferred_severity)
		})
		.collect::<Vec<_>>();
	selected_paths.sort_by(|(left_path, left_preferred), (right_path, right_preferred)| {
		right_preferred
			.cmp(left_preferred)
			.then_with(|| left_path.cmp(right_path))
	});
	let selected_paths = selected_paths
		.into_iter()
		.take(file_limit)
		.map(|(path, _)| path)
		.collect::<Vec<_>>();
	let mut total_content_bytes = 0_u64;
	let mut files = Vec::with_capacity(selected_paths.len());

	for path in selected_paths {
		let current_relative_path = relative_path(root, &path)?;
		let content = read_context_file(
			&path,
			&current_relative_path,
		)?;
		if let Some(value) = content.as_ref() {
			total_content_bytes = total_content_bytes
				.checked_add(value.len() as u64)
				.ok_or_else(|| "The diagnostic context size is invalid.".to_string())?;
			if total_content_bytes > MAX_DIAGNOSTIC_CONTEXT_BYTES {
				return Err(format!(
					"The diagnostic context exceeded the {} MiB limit.",
					MAX_DIAGNOSTIC_CONTEXT_BYTES / (1024 * 1024),
				));
			}
		}
		files.push(ProjectDiagnosticFile {
			relative_path: current_relative_path,
			content,
			messages: by_file.remove(&path).unwrap_or_default(),
		});
	}

	Ok(ProjectDiagnosticContextData {
		kind: kind.as_str().to_string(),
		severity: preferred_severity.to_string(),
		issue_count,
		error_count,
		warning_count,
		total_files_with_issues,
		selected_file_count: files.len(),
		files,
		global_messages,
	})
}

fn generate_project_diagnostic_context_blocking(
	root_folder: String,
	kind: DiagnosticKind,
	file_limit: usize,
) -> Result<ProjectDiagnosticContextData, String> {
	let root = canonical_project_root(&root_folder)?;
	let configs = scan_diagnostic_configs(&root)?;
	let diagnostics = match kind {
		DiagnosticKind::Typecheck => {
			if configs.typecheck.is_empty() {
				return Err("No TypeScript configuration was found in this project.".to_string());
			}
			run_typecheck(&root, &configs.typecheck)?
		}
		DiagnosticKind::Eslint => {
			if configs.eslint.is_empty() {
				return Err("No ESLint configuration was found in this project.".to_string());
			}
			run_eslint(&root, &configs.eslint)?
		}
	};

	build_context_data(&root, kind, file_limit, diagnostics)
}

#[tauri::command]
pub async fn generate_project_diagnostic_context(
	root_folder: String,
	kind: String,
	file_limit: usize,
	trust_state: State<'_, DiagnosticTrustState>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ProjectDiagnosticContextData, String> {
	let kind = match kind.as_str() {
		"typecheck" => DiagnosticKind::Typecheck,
		"eslint" => DiagnosticKind::Eslint,
		_ => return Err("The requested diagnostic type is invalid.".to_string()),
	};
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let canonical_root = canonical_project_root(&root_folder)?;
	if !trust_state.is_approved(&canonical_root)? {
		return Err(
			"Diagnostic execution was refused because this project has not received explicit trust in this session.".to_string(),
		);
	}

	tauri::async_runtime::spawn_blocking(move || {
		generate_project_diagnostic_context_blocking(
			root_folder,
			kind,
			file_limit,
		)
	})
	.await
	.map_err(|error| format!("Diagnostic context generation was interrupted: {error}"))?
}

#[tauri::command]
pub async fn run_project_validation_command(
	root_folder: String,
	kind: String,
	operation_id: String,
	trust_state: State<'_, DiagnosticTrustState>,
	validation_state: State<'_, ValidationOperationState>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ProjectValidationCommandResult, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	let commands = read_project_validation_commands(&root);
	let command_text = get_project_validation_command(
		&commands,
		&kind,
	)?;
	if !trust_state.is_custom_command_approved(
		&root,
		&command_text,
	)? {
		return Err(
			"Custom validation command execution was refused because this exact command has not received explicit trust in this session.".to_string(),
		);
	}

	let cancellation = validation_state.begin(
		root.clone(),
		kind.clone(),
		operation_id.clone(),
	)?;
	let operation_root = root.clone();
	let operation_kind = kind.clone();
	let result = tauri::async_runtime::spawn_blocking(move || {
		run_custom_validation_command_blocking(
			root,
			kind,
			command_text,
			&cancellation,
		)
	})
	.await
	.map_err(|error| format!("Custom validation command execution was interrupted: {error}"))
	.and_then(|value| value);

	validation_state.finish(
		&operation_root,
		&operation_kind,
		&operation_id,
	)?;
	result
}

#[tauri::command]
pub async fn fix_project_eslint(
	root_folder: String,
	operation_id: String,
	trust_state: State<'_, DiagnosticTrustState>,
	validation_state: State<'_, ValidationOperationState>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ProjectLintFixResult, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	if !trust_state.is_approved(&root)? {
		return Err(
			"ESLint auto-fix was refused because this project has not received explicit trust in this session.".to_string(),
		);
	}

	let kind = "lintfix".to_string();
	let cancellation = validation_state.begin(
		root.clone(),
		kind.clone(),
		operation_id.clone(),
	)?;
	let operation_root = root.clone();
	let result = tauri::async_runtime::spawn_blocking(move || {
		fix_project_eslint_blocking(
			root,
			&cancellation,
		)
	})
	.await
	.map_err(|error| format!("ESLint auto-fix was interrupted: {error}"))
	.and_then(|value| value);

	validation_state.finish(
		&operation_root,
		&kind,
		&operation_id,
	)?;
	result
}

