fn apply_eslint_fix_plan(
	candidates: &BTreeMap<PathBuf, LintFixCandidate>,
	cancellation: &AtomicBool,
) -> Result<(), String> {
	for (path, candidate) in candidates {
		if cancellation.load(Ordering::Acquire) {
			return Err("ESLint auto-fix was cancelled before any file was changed.".to_string());
		}

		let current = fs::read(path)
			.map_err(|error| format!(
				"Could not revalidate {} before applying ESLint auto-fixes: {error}",
				path.display(),
			))?;
		if current.as_slice() != candidate.expected_source.as_slice() {
			return Err(format!(
				"{} changed while ESLint auto-fix was being prepared. No file was changed; run Lint Fix again.",
				path.display(),
			));
		}
	}

	let mut applied = Vec::<PathBuf>::new();
	for (path, candidate) in candidates {
		if cancellation.load(Ordering::Acquire) {
			let rollback_errors = rollback_eslint_fix_plan(
				candidates,
				&applied,
			);
			if rollback_errors.is_empty() {
				return Err("ESLint auto-fix was cancelled. Previously written fixes from this operation were restored.".to_string());
			}
			return Err(format!(
				"ESLint auto-fix was cancelled, but rollback could not safely restore every previously written file: {}",
				rollback_errors.join(" | "),
			));
		}

		if let Err(error) = checked_atomic_replace(
			path,
			&candidate.expected_source,
			&candidate.fixed_source,
		) {
			let rollback_errors = rollback_eslint_fix_plan(
				candidates,
				&applied,
			);

			if rollback_errors.is_empty() {
				return Err(format!(
					"{error} Previously written ESLint fixes from this operation were restored.",
				));
			}

			return Err(format!(
				"{error} Rollback could not safely restore every previously written file: {}",
				rollback_errors.join(" | "),
			));
		}
		applied.push(path.clone());
	}

	Ok(())
}

fn fix_project_eslint_blocking(
	root: PathBuf,
	cancellation: &AtomicBool,
) -> Result<ProjectLintFixResult, String> {
	let configs = scan_diagnostic_configs(&root)?;
	if configs.eslint.is_empty() {
		return Err("No ESLint configuration was found in this project.".to_string());
	}

	let (candidates, diagnostics) = collect_eslint_fix_plan(
		&root,
		&configs.eslint,
		cancellation,
	)?;
	apply_eslint_fix_plan(
		&candidates,
		cancellation,
	)?;

	let diagnostics = filter_and_deduplicate(
		&root,
		diagnostics,
	)?;
	let remaining_error_count = diagnostics
		.iter()
		.filter(|diagnostic| diagnostic.severity == "error")
		.count();
	let remaining_warning_count = diagnostics
		.iter()
		.filter(|diagnostic| diagnostic.severity == "warning")
		.count();
	let remaining_files_with_issues = diagnostics
		.iter()
		.filter_map(|diagnostic| diagnostic.file_path.clone())
		.collect::<HashSet<_>>()
		.len();

	Ok(ProjectLintFixResult {
		changed_file_count: candidates.len(),
		remaining_issue_count: diagnostics.len(),
		remaining_error_count,
		remaining_warning_count,
		remaining_files_with_issues,
	})
}

fn diagnostic_key(diagnostic: &ParsedDiagnostic) -> String {
	format!(
		"{}|{:?}|{:?}|{}|{}|{}",
		diagnostic.file_path.as_ref().map(|path| path.to_string_lossy()).unwrap_or_default(),
		diagnostic.line,
		diagnostic.column,
		diagnostic.code,
		diagnostic.severity,
		diagnostic.message,
	)
}

fn filter_and_deduplicate(
	root: &Path,
	diagnostics: Vec<ParsedDiagnostic>,
) -> Result<Vec<ParsedDiagnostic>, String> {
	let project_ignore = ProjectIgnore::load(root)?;
	let mut seen = HashSet::new();
	let mut filtered = Vec::new();

	for diagnostic in diagnostics {
		if let Some(file_path) = diagnostic.file_path.as_ref() {
			ensure_inside_root(root, file_path)?;
			if project_ignore.is_ignored(file_path, false) {
				continue;
			}
		}
		let key = diagnostic_key(&diagnostic);
		if seen.insert(key) {
			filtered.push(diagnostic);
		}
	}

	Ok(filtered)
}

fn read_context_file(
	path: &Path,
	relative_path: &str,
) -> Result<Option<String>, String> {
	let metadata_size = fs::metadata(path)
		.map_err(|error| format!("Could not read {}: {error}", path.display()))?
		.len();
	if metadata_size > MAX_DIAGNOSTIC_FILE_BYTES {
		return Ok(None);
	}
	let file = File::open(path)
		.map_err(|error| format!("Could not open {}: {error}", path.display()))?;
	let mut bytes = Vec::with_capacity(metadata_size.min(MAX_DIAGNOSTIC_FILE_BYTES) as usize);
	file.take(MAX_DIAGNOSTIC_FILE_BYTES + 1)
		.read_to_end(&mut bytes)
		.map_err(|error| format!("Could not read {}: {error}", path.display()))?;
	if bytes.len() as u64 > MAX_DIAGNOSTIC_FILE_BYTES {
		return Ok(None);
	}
	match decode_text(bytes) {
		Ok(content) => Ok(Some(crate::context_redaction::redact_file_content(
			relative_path,
			content,
		))),
		Err(_) => Ok(None),
	}
}

