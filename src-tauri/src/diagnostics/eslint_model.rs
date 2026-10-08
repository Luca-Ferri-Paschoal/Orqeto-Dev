#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintResult {
	file_path: String,
	messages: Vec<EslintMessage>,
	output: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintMessage {
	rule_id: Option<String>,
	severity: u8,
	message: String,
	line: Option<usize>,
	column: Option<usize>,
}

fn canonical_project_root(root_folder: &str) -> Result<PathBuf, String> {
	let root = fs::canonicalize(root_folder)
		.map_err(|error| format!("Could not access the project folder: {error}"))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	Ok(root)
}

fn is_scan_directory_excluded(name: &str) -> bool {
	matches!(
		name.to_ascii_lowercase().as_str(),
		".git" | "node_modules" | "target" | ".pnpm-store" | ".yarn"
	)
}

fn is_typecheck_config(name: &str) -> bool {
	let lower = name.to_ascii_lowercase();
	lower.starts_with("tsconfig") && lower.ends_with(".json")
}

fn is_eslint_config(name: &str) -> bool {
	matches!(
		name.to_ascii_lowercase().as_str(),
		"eslint.config.js" |
		"eslint.config.mjs" |
		"eslint.config.cjs" |
		"eslint.config.ts" |
		"eslint.config.mts" |
		"eslint.config.cts" |
		".eslintrc" |
		".eslintrc.js" |
		".eslintrc.cjs" |
		".eslintrc.json" |
		".eslintrc.yaml" |
		".eslintrc.yml"
	)
}

fn is_base_typecheck_config(path: &Path) -> bool {
	path.file_name()
		.and_then(|name| name.to_str())
		.map(|name| {
			let lower = name.to_ascii_lowercase();
			lower == "tsconfig.base.json" || lower.starts_with("tsconfig.base.")
		})
		.unwrap_or(false)
}

fn is_solution_style_typecheck_config(path: &Path) -> bool {
	let Ok(content) = fs::read_to_string(path) else {
		return false;
	};

	if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
		let has_references = value
			.get("references")
			.and_then(serde_json::Value::as_array)
			.map(|references| !references.is_empty())
			.unwrap_or(false);
		let has_includes = value
			.get("include")
			.and_then(serde_json::Value::as_array)
			.map(|include| !include.is_empty())
			.unwrap_or(false);
		let has_files = value
			.get("files")
			.and_then(serde_json::Value::as_array)
			.map(|files| !files.is_empty())
			.unwrap_or(false);

		return has_references && !has_includes && !has_files;
	}

	let compact = content
		.chars()
		.filter(|character| !character.is_whitespace())
		.collect::<String>()
		.to_ascii_lowercase();
	compact.contains("\"references\"") &&
		!compact.contains("\"include\"") &&
		(
			!compact.contains("\"files\"") ||
			compact.contains("\"files\":[]")
		)
}

fn referenced_typecheck_configs(
	config: &Path,
	available_configs: &[PathBuf],
) -> Vec<PathBuf> {
	let Ok(content) = fs::read_to_string(config) else {
		return Vec::new();
	};
	let Some(config_directory) = config.parent() else {
		return Vec::new();
	};
	let mut remaining = content.as_str();
	let mut referenced = Vec::new();

	while let Some(path_key_index) = remaining.find("\"path\"") {
		remaining = &remaining[path_key_index + "\"path\"".len()..];
		let Some(colon_index) = remaining.find(':') else {
			break;
		};
		let value = remaining[colon_index + 1..].trim_start();
		let Some(value) = value.strip_prefix('"') else {
			continue;
		};
		let Some(end_quote) = value.find('"') else {
			break;
		};
		let relative = &value[..end_quote];
		remaining = &value[end_quote + 1..];
		let candidate = config_directory.join(relative);
		let candidate = if candidate.is_dir() {
			candidate.join("tsconfig.json")
		} else {
			candidate
		};
		let Ok(candidate) = fs::canonicalize(candidate) else {
			continue;
		};
		if let Some(found) = available_configs.iter().find(|available| {
			fs::canonicalize(available).ok().as_ref() == Some(&candidate)
		}) {
			referenced.push(found.clone());
		}
	}

	referenced.sort();
	referenced.dedup();
	referenced
}

fn package_is_workspace_typecheck_aggregator(package_json: &Path) -> bool {
	let Ok(content) = fs::read_to_string(package_json) else {
		return false;
	};
	let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
		return false;
	};
	let has_workspaces = value.get("workspaces").is_some();
	let typecheck_script = value
		.get("scripts")
		.and_then(|scripts| scripts.get("typecheck"))
		.and_then(serde_json::Value::as_str)
		.unwrap_or_default();

	has_workspaces && typecheck_script.contains("--workspaces")
}

fn select_typecheck_configs(
	root: &Path,
	configs: Vec<PathBuf>,
	package_json_files: &[PathBuf],
) -> Vec<PathBuf> {
	let mut selected = Vec::new();

	for package_json in package_json_files {
		let Some(package_directory) = package_json.parent() else {
			continue;
		};
		if package_is_workspace_typecheck_aggregator(package_json) {
			continue;
		}

		let mut direct_configs = configs
			.iter()
			.filter(|config| config.parent() == Some(package_directory))
			.cloned()
			.collect::<Vec<_>>();
		direct_configs.sort();
		if direct_configs.is_empty() {
			continue;
		}

		let main_config = direct_configs.iter().find(|config| {
			config.file_name().and_then(|name| name.to_str()) == Some("tsconfig.json")
		});
		if let Some(main_config) = main_config {
			if is_solution_style_typecheck_config(main_config) {
				let referenced_configs = referenced_typecheck_configs(
					main_config,
					&configs,
				);
				if !referenced_configs.is_empty() {
					selected.extend(referenced_configs);
					continue;
				}

				let leaf_configs = direct_configs
					.iter()
					.filter(|config| *config != main_config && !is_base_typecheck_config(config))
					.cloned()
					.collect::<Vec<_>>();
				if !leaf_configs.is_empty() {
					selected.extend(leaf_configs);
					continue;
				}
			}

			selected.push(main_config.clone());
			continue;
		}

		selected.extend(
			direct_configs
				.into_iter()
				.filter(|config| !is_base_typecheck_config(config)),
		);
	}

	if selected.is_empty() {
		if let Some(root_main) = configs.iter().find(|config| {
			config.parent() == Some(root) &&
				config.file_name().and_then(|name| name.to_str()) == Some("tsconfig.json")
		}) {
			selected.push(root_main.clone());
		} else {
			selected.extend(
				configs
					.iter()
					.filter(|config| {
						config.file_name().and_then(|name| name.to_str()) == Some("tsconfig.json")
					})
					.cloned(),
			);
		}
	}

	selected.sort();
	selected.dedup();
	selected
}

