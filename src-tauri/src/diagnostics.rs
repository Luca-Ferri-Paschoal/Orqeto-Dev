use crate::overlay::OverlayUndoState;
use crate::project_ignore::ProjectIgnore;
use crate::{decode_text, ensure_inside_root, process_tree, relative_path, safe_fs};
use serde::{Deserialize, Serialize};
use std::{
	collections::{BTreeMap, HashSet},
	ffi::OsString,
	fs::{self, File},
	io::{self, Read},
	path::{Path, PathBuf},
	process::{Command, ExitStatus, Stdio},
	sync::{
		atomic::{AtomicBool, AtomicUsize, Ordering},
		Arc,
		Mutex,
	},
	thread,
	time::{Duration, Instant},
};
use tauri::State;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const WINDOWS_NO_WINDOW: u32 = 0x08000000;
const MAX_CONFIG_SCAN_ENTRIES: usize = 100_000;
const MAX_DIAGNOSTIC_CONFIGS: usize = 64;
const MAX_DIAGNOSTIC_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_DIAGNOSTIC_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_CONTEXT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_DIAGNOSTIC_RUNTIME: Duration = Duration::from_secs(5 * 60);
const MAX_DIAGNOSTIC_DETAIL_CHARS: usize = 16_000;
const DIAGNOSTIC_FILE_LIMIT_MIN: usize = 1;
const DIAGNOSTIC_FILE_LIMIT_MAX: usize = 100;

pub struct DiagnosticTrustState(Mutex<HashSet<PathBuf>>);

impl DiagnosticTrustState {
	pub fn new() -> Self {
		Self(Mutex::new(HashSet::new()))
	}

	fn approve(&self, root: PathBuf) -> Result<(), String> {
		self.0
			.lock()
			.map_err(|_| "The diagnostic trust state became unavailable.".to_string())?
			.insert(root);
		Ok(())
	}

	fn is_approved(&self, root: &Path) -> Result<bool, String> {
		self.0
			.lock()
			.map(|approved| approved.contains(root))
			.map_err(|_| "The diagnostic trust state became unavailable.".to_string())
	}
}

#[derive(Clone, Copy)]
enum DiagnosticKind {
	Typecheck,
	Eslint,
}

impl DiagnosticKind {
	fn as_str(self) -> &'static str {
		match self {
			Self::Typecheck => "typecheck",
			Self::Eslint => "eslint",
		}
	}
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDiagnosticCapabilities {
	typecheck: bool,
	eslint: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDiagnosticMessage {
	line: Option<usize>,
	column: Option<usize>,
	code: String,
	message: String,
	severity: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDiagnosticFile {
	relative_path: String,
	content: Option<String>,
	messages: Vec<ProjectDiagnosticMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDiagnosticContextData {
	kind: String,
	severity: String,
	issue_count: usize,
	error_count: usize,
	warning_count: usize,
	total_files_with_issues: usize,
	selected_file_count: usize,
	files: Vec<ProjectDiagnosticFile>,
	global_messages: Vec<ProjectDiagnosticMessage>,
}

#[derive(Clone)]
struct ParsedDiagnostic {
	file_path: Option<PathBuf>,
	line: Option<usize>,
	column: Option<usize>,
	code: String,
	message: String,
	severity: String,
}

struct DiagnosticConfigs {
	typecheck: Vec<PathBuf>,
	eslint: Vec<PathBuf>,
}

struct CapturedOutput {
	status: ExitStatus,
	stdout: Vec<u8>,
	stderr: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintResult {
	file_path: String,
	messages: Vec<EslintMessage>,
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

	Ok(ProjectDiagnosticCapabilities {
		typecheck: !configs.typecheck.is_empty(),
		eslint: !configs.eslint.is_empty(),
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

fn resolve_from_path(executable: &str) -> Option<PathBuf> {
	let path = std::env::var_os("PATH")?;
	for directory in std::env::split_paths(&path) {
		let candidate = directory.join(executable);
		if candidate.is_file() {
			if let Ok(canonical) = fs::canonicalize(&candidate) {
				return Some(canonical);
			}
		}
	}
	None
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

fn read_bounded<R: Read + Send + 'static>(
	mut reader: R,
	total_bytes: Arc<AtomicUsize>,
	exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<io::Result<Vec<u8>>> {
	thread::spawn(move || {
		let mut output = Vec::new();
		let mut buffer = [0_u8; 64 * 1024];
		loop {
			let read = reader.read(&mut buffer)?;
			if read == 0 {
				break;
			}
			let previous = total_bytes.fetch_add(read, Ordering::AcqRel);
			if previous.saturating_add(read) > MAX_DIAGNOSTIC_OUTPUT_BYTES {
				exceeded.store(true, Ordering::Release);
				continue;
			}
			output.extend_from_slice(&buffer[..read]);
		}
		Ok(output)
	})
}

fn run_bounded_command(mut command: Command) -> Result<CapturedOutput, String> {
	process_tree::configure_process_tree(&mut command);
	command.stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = command
		.spawn()
		.map_err(|error| format!("Could not start the diagnostic tool: {error}"))?;
	let stdout = match child.stdout.take() {
		Some(stdout) => stdout,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The diagnostic tool did not provide stdout.".to_string());
		}
	};
	let stderr = match child.stderr.take() {
		Some(stderr) => stderr,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The diagnostic tool did not provide stderr.".to_string());
		}
	};
	let exceeded = Arc::new(AtomicBool::new(false));
	let total_bytes = Arc::new(AtomicUsize::new(0));
	let stdout_task = read_bounded(stdout, Arc::clone(&total_bytes), Arc::clone(&exceeded));
	let stderr_task = read_bounded(stderr, Arc::clone(&total_bytes), Arc::clone(&exceeded));
	let started = Instant::now();
	let status_result = loop {
		if exceeded.load(Ordering::Acquire) {
			process_tree::terminate_process_tree(&mut child);
			break Err(format!(
				"Diagnostic output exceeded the {} MiB limit.",
				MAX_DIAGNOSTIC_OUTPUT_BYTES / (1024 * 1024),
			));
		}
		if started.elapsed() > MAX_DIAGNOSTIC_RUNTIME {
			process_tree::terminate_process_tree(&mut child);
			break Err("The diagnostic exceeded the 5-minute limit and was stopped.".to_string());
		}
		match child.try_wait() {
			Ok(Some(status)) => break Ok(status),
			Ok(None) => thread::sleep(Duration::from_millis(10)),
			Err(error) => {
				process_tree::terminate_process_tree(&mut child);
				break Err(format!("Could not wait for the diagnostic tool: {error}"));
			}
		}
	};
	let stdout = stdout_task
		.join()
		.map_err(|_| "Reading diagnostic output was interrupted.".to_string())?
		.map_err(|error| format!("Could not read diagnostic output: {error}"))?;
	let stderr = stderr_task
		.join()
		.map_err(|_| "Reading diagnostic stderr was interrupted.".to_string())?
		.map_err(|error| format!("Could not read diagnostic stderr: {error}"))?;
	let status = status_result?;

	Ok(CapturedOutput { status, stdout, stderr })
}

#[cfg(target_os = "windows")]
fn child_process_path(path: &Path) -> OsString {
	use std::os::windows::ffi::{OsStrExt, OsStringExt};
	use std::path::{Component, Prefix};

	let mut components = path.components();
	let Some(Component::Prefix(prefix)) = components.next() else {
		return path.as_os_str().to_os_string();
	};
	let path_wide = path.as_os_str().encode_wide().collect::<Vec<_>>();

	match prefix.kind() {
		Prefix::VerbatimDisk(_) => {
			const VERBATIM_PREFIX_LEN: usize = 4;
			if path_wide.len() > VERBATIM_PREFIX_LEN {
				OsString::from_wide(&path_wide[VERBATIM_PREFIX_LEN..])
			} else {
				path.as_os_str().to_os_string()
			}
		}
		Prefix::VerbatimUNC(_, _) => {
			const VERBATIM_UNC_PREFIX_LEN: usize = 8;
			if path_wide.len() > VERBATIM_UNC_PREFIX_LEN {
				let mut normalized = Vec::with_capacity(path_wide.len().saturating_sub(6));
				normalized.extend_from_slice(&[b'\\' as u16, b'\\' as u16]);
				normalized.extend_from_slice(&path_wide[VERBATIM_UNC_PREFIX_LEN..]);
				OsString::from_wide(&normalized)
			} else {
				path.as_os_str().to_os_string()
			}
		}
		_ => path.as_os_str().to_os_string(),
	}
}

#[cfg(not(target_os = "windows"))]
fn child_process_path(path: &Path) -> OsString {
	path.as_os_str().to_os_string()
}

fn create_node_command(
	node: &Path,
	cwd: &Path,
	script: &Path,
) -> Command {
	let mut command = Command::new(child_process_path(node));
	command
		.current_dir(cwd)
		.arg(child_process_path(script))
		.stdin(Stdio::null())
		.env_remove("NODE_OPTIONS")
		.env_remove("NODE_PATH")
		.env("NO_COLOR", "1")
		.env("FORCE_COLOR", "0")
		.env("CI", "1");

	#[cfg(target_os = "windows")]
	command.creation_flags(WINDOWS_NO_WINDOW);

	command
}

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

fn read_context_file(path: &Path) -> Result<Option<String>, String> {
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
		Ok(content) => Ok(Some(content)),
		Err(_) => Ok(None),
	}
}

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
		let content = read_context_file(&path)?;
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
			relative_path: relative_path(root, &path)?,
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

#[cfg(test)]
mod tests {
	use super::{child_process_path, select_typecheck_configs};
	use std::{
		fs,
		path::{Path, PathBuf},
		time::{SystemTime, UNIX_EPOCH},
	};

	fn temporary_test_root(label: &str) -> PathBuf {
		let nonce = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time should be after the epoch")
			.as_nanos();
		std::env::temp_dir().join(format!(
			"orqeto-diagnostics-{label}-{}-{nonce}",
			std::process::id(),
		))
	}

	#[test]
	fn typecheck_config_selection_prefers_workspace_package_configs() {
		let root = temporary_test_root("workspace");
		let api = root.join("apps").join("api");
		let scripts = root.join("scripts");
		fs::create_dir_all(&api).expect("api directory should be created");
		fs::create_dir_all(&scripts).expect("scripts directory should be created");
		fs::write(
			root.join("package.json"),
			r#"{"workspaces":["apps/*"],"scripts":{"typecheck":"npm run typecheck --workspaces --if-present"}}"#,
		).expect("root package should be written");
		fs::write(api.join("package.json"), r#"{"name":"api"}"#)
			.expect("api package should be written");
		fs::write(root.join("tsconfig.json"), "{}").expect("root tsconfig should be written");
		fs::write(root.join("tsconfig.base.json"), "{}").expect("base tsconfig should be written");
		fs::write(api.join("tsconfig.json"), "{}").expect("api tsconfig should be written");
		fs::write(scripts.join("tsconfig.json"), "{}").expect("scripts tsconfig should be written");

		let selected = select_typecheck_configs(
			&root,
			vec![
				root.join("tsconfig.json"),
				root.join("tsconfig.base.json"),
				api.join("tsconfig.json"),
				scripts.join("tsconfig.json"),
			],
			&[
				root.join("package.json"),
				api.join("package.json"),
			],
		);

		assert_eq!(selected, vec![api.join("tsconfig.json")]);
		let _ = fs::remove_dir_all(root);
	}

	#[test]
	fn typecheck_config_selection_expands_solution_config_without_base_config() {
		let root = temporary_test_root("solution");
		fs::create_dir_all(&root).expect("test root should be created");
		fs::write(root.join("package.json"), r#"{"name":"web"}"#)
			.expect("package should be written");
		fs::write(
			root.join("tsconfig.json"),
			r#"{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}]}"#,
		).expect("solution config should be written");
		for name in ["tsconfig.app.json", "tsconfig.node.json", "tsconfig.base.json"] {
			fs::write(root.join(name), "{}").expect("leaf config should be written");
		}

		let selected = select_typecheck_configs(
			&root,
			vec![
				root.join("tsconfig.json"),
				root.join("tsconfig.app.json"),
				root.join("tsconfig.node.json"),
				root.join("tsconfig.base.json"),
			],
			&[root.join("package.json")],
		);

		assert_eq!(
			selected,
			vec![
				root.join("tsconfig.app.json"),
				root.join("tsconfig.node.json"),
			],
		);
		let _ = fs::remove_dir_all(root);
	}


	#[test]
	fn diagnostic_child_process_path_preserves_normal_paths() {
		let path = Path::new("project/node_modules/typescript/bin/tsc");
		assert_eq!(child_process_path(path).as_os_str(), path.as_os_str());
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn diagnostic_child_process_path_removes_windows_verbatim_disk_prefix() {
		let path = Path::new(r"\\?\C:\Users\dev\project\node_modules\typescript\bin\tsc");
		assert_eq!(
			child_process_path(path),
			std::ffi::OsString::from(r"C:\Users\dev\project\node_modules\typescript\bin\tsc"),
		);
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn diagnostic_child_process_path_converts_windows_verbatim_unc_prefix() {
		let path = Path::new(r"\\?\UNC\server\share\project\node_modules\eslint\bin\eslint.js");
		assert_eq!(
			child_process_path(path),
			std::ffi::OsString::from(r"\\server\share\project\node_modules\eslint\bin\eslint.js"),
		);
	}
}

