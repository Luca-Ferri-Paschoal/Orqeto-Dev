fn path_inside_root(
	root: &Path,
	candidate: &Path,
) -> Option<PathBuf> {
	let absolute = if candidate.is_absolute() {
		candidate.to_path_buf()
	} else {
		root.join(candidate)
	};
	let canonical = fs::canonicalize(absolute).ok()?;
	canonical.starts_with(root).then_some(canonical)
}

fn parse_number(value: &str) -> Option<usize> {
	value.parse::<usize>().ok()
}

fn bounded_detail(value: &str) -> String {
	let mut characters = value.chars();
	let detail = characters
		.by_ref()
		.take(MAX_DIAGNOSTIC_DETAIL_CHARS)
		.collect::<String>();

	if characters.next().is_some() {
		format!("{detail}\n… output truncated …")
	} else {
		detail
	}
}

fn parse_tsc_primary_line(
	root: &Path,
	line: &str,
) -> Option<ParsedDiagnostic> {
	let marker = "): error TS";
	let marker_index = line.find(marker)?;
	let before = &line[..marker_index];
	let open_index = before.rfind('(')?;
	let location = &before[open_index + 1..];
	let (line_text, column_text) = location.split_once(',')?;
	let file_text = before[..open_index].trim();
	let after = &line[marker_index + marker.len()..];
	let (code, message) = after.split_once(':')?;
	let file_path = path_inside_root(root, Path::new(file_text));

	Some(ParsedDiagnostic {
		file_path,
		line: parse_number(line_text.trim()),
		column: parse_number(column_text.trim()),
		code: format!("TS{}", code.trim()),
		message: message.trim().to_string(),
		severity: "error".to_string(),
	})
}

fn parse_tsc_global_line(line: &str) -> Option<ParsedDiagnostic> {
	let trimmed = line.trim();
	let after = trimmed.strip_prefix("error TS")?;
	let (code, message) = after.split_once(':')?;
	Some(ParsedDiagnostic {
		file_path: None,
		line: None,
		column: None,
		code: format!("TS{}", code.trim()),
		message: message.trim().to_string(),
		severity: "error".to_string(),
	})
}

fn append_tsc_output(
	root: &Path,
	output: &str,
	diagnostics: &mut Vec<ParsedDiagnostic>,
) {
	for line in output.lines() {
		if let Some(diagnostic) = parse_tsc_primary_line(root, line)
			.or_else(|| parse_tsc_global_line(line))
		{
			diagnostics.push(diagnostic);
			continue;
		}

		let continuation = line.trim();
		if continuation.is_empty() {
			continue;
		}
		if let Some(last) = diagnostics.last_mut() {
			if !last.message.ends_with(continuation) {
				last.message.push(' ');
				last.message.push_str(continuation);
			}
		}
	}
}

fn run_typecheck(
	root: &Path,
	configs: &[PathBuf],
) -> Result<Vec<ParsedDiagnostic>, String> {
	let node = node_candidates()
		.into_iter()
		.next()
		.ok_or_else(|| "Node.js was not found. Install Node.js to generate TypeScript context.".to_string())?;
	let mut diagnostics = Vec::new();
	let mut missing_tool_directories = Vec::new();

	for config in configs {
		let config_directory = config.parent().unwrap_or(root);
		let Some(tsc_script) = find_node_module_entry(
			root,
			config_directory,
			&["typescript", "bin", "tsc"],
		) else {
			missing_tool_directories.push(config_directory.to_path_buf());
			continue;
		};

		let mut command = create_node_command(&node, root, &tsc_script);
		command
			.arg("--pretty")
			.arg("false")
			.arg("--noEmit")
			.arg("-p")
			.arg(child_process_path(config));
		let output = run_bounded_command(command)?;
		let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
		if !output.stderr.is_empty() {
			combined.push('\n');
			combined.push_str(&String::from_utf8_lossy(&output.stderr));
		}
		let before = diagnostics.len();
		append_tsc_output(root, &combined, &mut diagnostics);
		if !output.status.success() && diagnostics.len() == before {
			let details = combined.trim();
			let failure_detail = if details.is_empty() {
				format!("processo encerrado com status {}", output.status)
			} else {
				bounded_detail(details)
			};

			return Err(format!(
				"TypeScript could not generate the report for {}: {}",
				config.display(),
				failure_detail,
			));
		}
	}

	if diagnostics.is_empty() && missing_tool_directories.len() == configs.len() {
		return Err("TypeScript was not found in node_modules for the detected configurations.".to_string());
	}

	Ok(diagnostics)
}

fn run_eslint(
	root: &Path,
	configs: &[PathBuf],
) -> Result<Vec<ParsedDiagnostic>, String> {
	let node = node_candidates()
		.into_iter()
		.next()
		.ok_or_else(|| "Node.js was not found. Install Node.js to generate ESLint context.".to_string())?;
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
	let mut diagnostics = Vec::new();
	let mut executed = 0_usize;

	for (directory, uses_flat_config) in config_directories {
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
			.arg("--format")
			.arg("json")
			.arg(".");
		let output = run_bounded_command(command)?;
		let stdout = String::from_utf8_lossy(&output.stdout);
		let parsed = serde_json::from_str::<Vec<EslintResult>>(stdout.trim());

		match parsed {
			Ok(results) => {
				for result in results {
					let Some(file_path) = path_inside_root(root, Path::new(&result.file_path)) else {
						continue;
					};
					for message in result.messages {
						if message.severity == 0 {
							continue;
						}
						diagnostics.push(ParsedDiagnostic {
							file_path: Some(file_path.clone()),
							line: message.line,
							column: message.column,
							code: message.rule_id.unwrap_or_else(|| "parsing-error".to_string()),
							message: message.message,
							severity: if message.severity >= 2 { "error" } else { "warning" }.to_string(),
						});
					}
				}
			}
			Err(parse_error) => {
				let stderr = String::from_utf8_lossy(&output.stderr);
				let details = if !stderr.trim().is_empty() { stderr.trim() } else { stdout.trim() };
				if !output.status.success() || !details.is_empty() {
					return Err(format!(
						"ESLint could not generate the report in {}: {}",
						directory.display(),
						if details.is_empty() { parse_error.to_string() } else { bounded_detail(details) },
					));
				}
			}
		}
	}

	if executed == 0 {
		return Err("ESLint was not found in node_modules for the detected configurations.".to_string());
	}

	Ok(diagnostics)
}

struct LintFixCandidate {
	expected_source: Vec<u8>,
	fixed_source: Vec<u8>,
}

