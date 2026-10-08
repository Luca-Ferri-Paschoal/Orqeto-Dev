fn collect_eslint_fix_plan(
	root: &Path,
	configs: &[PathBuf],
	cancellation: &AtomicBool,
) -> Result<(BTreeMap<PathBuf, LintFixCandidate>, Vec<ParsedDiagnostic>), String> {
	let node = node_candidates()
		.into_iter()
		.next()
		.ok_or_else(|| "Node.js was not found. Install Node.js to run ESLint auto-fix.".to_string())?;
	let project_ignore = ProjectIgnore::load(root)?;
	let mut config_directories = BTreeMap::<PathBuf, bool>::new();
	for config in configs {
		let Some(directory) = config.parent() else {
			continue;
		};
		let file_name = config
			.file_name()
			.and_then(|name| name.to_str())
			.unwrap_or_default()
			.to_ascii_lowercase();
		let uses_flat_config = file_name.starts_with("eslint.config.");
		config_directories
			.entry(directory.to_path_buf())
			.and_modify(|flat| *flat |= uses_flat_config)
			.or_insert(uses_flat_config);
	}

	let mut candidates = BTreeMap::<PathBuf, LintFixCandidate>::new();
	let mut diagnostics = Vec::new();
	let mut executed = 0_usize;

	for (directory, uses_flat_config) in config_directories {
		if cancellation.load(Ordering::Acquire) {
			return Err("ESLint auto-fix was cancelled.".to_string());
		}
		let Some(eslint_script) = find_node_module_entry(
			root,
			&directory,
			&["eslint", "bin", "eslint.js"],
		) else {
			continue;
		};
		executed += 1;

		let mut command = create_node_command(&node, &directory, &eslint_script);
		if !uses_flat_config {
			command.env("ESLINT_USE_FLAT_CONFIG", "false");
		}
		command
			.arg("--fix-dry-run")
			.arg("--format")
			.arg("json")
			.arg(".");
		let output = run_bounded_cancellable_diagnostic_command(
			command,
			cancellation,
		)?;
		let stdout = String::from_utf8_lossy(&output.stdout);
		let results = match serde_json::from_str::<Vec<EslintResult>>(stdout.trim()) {
			Ok(results) => results,
			Err(parse_error) => {
				let stderr = String::from_utf8_lossy(&output.stderr);
				let details = if !stderr.trim().is_empty() {
					stderr.trim()
				} else {
					stdout.trim()
				};
				return Err(format!(
					"ESLint could not prepare auto-fixes in {}: {}",
					directory.display(),
					if details.is_empty() {
						parse_error.to_string()
					} else {
						bounded_detail(details)
					},
				));
			}
		};

		for result in results {
			let EslintResult {
				file_path,
				messages,
				output,
			} = result;
			let Some(file_path) = path_inside_root(
				root,
				Path::new(&file_path),
			) else {
				continue;
			};

			if project_ignore.is_ignored(
				&file_path,
				false,
			) {
				continue;
			}

			for message in messages {
				if message.severity == 0 {
					continue;
				}
				diagnostics.push(ParsedDiagnostic {
					file_path: Some(file_path.clone()),
					line: message.line,
					column: message.column,
					code: message.rule_id.unwrap_or_else(|| "parsing-error".to_string()),
					message: message.message,
					severity: if message.severity >= 2 {
						"error"
					} else {
						"warning"
					}
					.to_string(),
				});
			}

			let Some(fixed_source) = output else {
				continue;
			};
			let expected_source = fs::read(&file_path)
				.map_err(|error| format!(
					"Could not snapshot {} after ESLint prepared the auto-fix: {error}",
					file_path.display(),
				))?;
			if fixed_source.as_bytes() == expected_source.as_slice() {
				continue;
			}

			let metadata = fs::symlink_metadata(&file_path)
				.map_err(|error| format!(
					"Could not inspect {} before applying ESLint auto-fixes: {error}",
					file_path.display(),
				))?;
			if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
				return Err(format!(
					"ESLint auto-fix refused the unsafe destination {}.",
					file_path.display(),
				));
			}
			let relative = file_path
				.strip_prefix(root)
				.map_err(|_| format!(
					"ESLint auto-fix attempted to escape the selected project through {}.",
					file_path.display(),
				))?;
			safe_fs::validate_project_relative_path(
				root,
				relative,
			)?;

			let candidate = LintFixCandidate {
				expected_source,
				fixed_source: fixed_source.into_bytes(),
			};
			if let Some(existing) = candidates.get(&file_path) {
				if existing.expected_source.as_slice() != candidate.expected_source.as_slice() ||
					existing.fixed_source.as_slice() != candidate.fixed_source.as_slice()
				{
					return Err(format!(
						"Multiple ESLint configurations produced conflicting auto-fixes for {}. No file was changed.",
						file_path.display(),
					));
				}
				continue;
			}
			candidates.insert(
				file_path,
				candidate,
			);
		}
	}

	if executed == 0 {
		return Err("ESLint was not found in node_modules for the detected configurations.".to_string());
	}

	Ok((candidates, diagnostics))
}

fn checked_atomic_replace(
	path: &Path,
	expected: &[u8],
	replacement: &[u8],
) -> Result<(), String> {
	let mut replacement_reader = replacement;
	safe_fs::atomic_write_from_reader_checked(
		path,
		&mut replacement_reader,
		|| {
			let current = fs::read(path)?;
			if current.as_slice() != expected {
				return Err(io::Error::new(
					io::ErrorKind::Other,
					"the file changed after ESLint prepared the auto-fix",
				));
			}
			Ok(())
		},
	)
	.map(|_| ())
	.map_err(|error| format!(
		"Could not safely update {}: {error}",
		path.display(),
	))
}

fn rollback_eslint_fix_plan(
	candidates: &BTreeMap<PathBuf, LintFixCandidate>,
	applied: &[PathBuf],
) -> Vec<String> {
	let mut rollback_errors = Vec::new();
	for applied_path in applied.iter().rev() {
		let Some(applied_candidate) = candidates.get(applied_path) else {
			continue;
		};
		if let Err(rollback_error) = checked_atomic_replace(
			applied_path,
			&applied_candidate.fixed_source,
			&applied_candidate.expected_source,
		) {
			rollback_errors.push(rollback_error);
		}
	}
	rollback_errors
}

