mod config_database;
mod diagnostics;
mod external_integration;
mod git_context;
mod native_drop;
mod operation_id;
mod overlay;
mod project_ignore;
mod process_tree;
mod resource_limits;
mod safe_fs;
mod storage;

use crate::{
	project_ignore::ProjectIgnore,
	resource_limits::{
		TraversalBudget,
		TraversalLimitExceeded,
		TraversalLimitKind,
		CONTEXT_MAX_FILE_BYTES,
		CONTEXT_MAX_FILES,
		CONTEXT_MAX_PATH_BYTES,
		CONTEXT_MAX_REQUEST_PATHS,
		CONTEXT_MAX_TOTAL_BYTES,
		CONTEXT_MAX_TOTAL_PATH_BYTES,
		CONTEXT_TRAVERSAL_LIMITS,
	},
};
use serde::Serialize;
use std::{
	collections::{BTreeMap, HashSet},
	fs::{self, File},
	io::Read,
	path::{Path, PathBuf},
	process::Command,
};
#[cfg(target_os = "windows")]
use std::{
	os::windows::process::CommandExt,
	process::{Output, Stdio},
	sync::{
		atomic::{AtomicBool, AtomicUsize, Ordering},
		Arc,
	},
	thread,
	time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, AppHandle, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_sql::{DbInstances, Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:orqeto-dev.db";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextSelectionFile {
	relative_path: String,
	size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedFile {
	relative_path: String,
	content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkippedFile {
	relative_path: String,
	reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessDropResult {
	files: Vec<ContextSelectionFile>,
	directories: Vec<String>,
	skipped_files: Vec<SkippedFile>,
	skipped_directory_count: usize,
	selected_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MaterializeContextResult {
	files: Vec<GeneratedFile>,
	directories: Vec<String>,
	skipped_files: Vec<SkippedFile>,
	skipped_directory_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextRemovalPath {
	relative_path: String,
	is_directory: bool,
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
	fs::canonicalize(path)
		.map_err(|error| format!("Could not access {}: {error}", path.display()))
}

fn ensure_inside_root(
	root: &Path,
	path: &Path,
) -> Result<(), String> {
	if path.starts_with(root) {
		return Ok(());
	}

	Err(format!(
		"Item {} is not inside the project folder.",
		path.display(),
	))
}

fn collect_files(
	root: &Path,
	start: &Path,
	project_ignore: &ProjectIgnore,
	visited_directories: &mut HashSet<PathBuf>,
	files: &mut Vec<(PathBuf, u64)>,
	ignored_files: &mut Vec<PathBuf>,
	ignored_directories: &mut HashSet<PathBuf>,
	budget: &mut TraversalBudget,
) -> Result<(), String> {
	let mut stack = vec![start.to_path_buf()];

	while let Some(current) = stack.pop() {
		let canonical_path = canonicalize_existing(&current)?;
		budget
			.record_path(&canonical_path, CONTEXT_TRAVERSAL_LIMITS)
			.map_err(context_traversal_limit_error)?;
		ensure_inside_root(root, &canonical_path)?;
		let metadata = fs::metadata(&canonical_path)
			.map_err(|error| format!("Could not read {}: {error}", canonical_path.display()))?;

		if project_ignore.is_ignored(&canonical_path, metadata.is_dir()) {
			if metadata.is_dir() {
				ignored_directories.insert(canonical_path);
			} else if metadata.is_file() {
				ignored_files.push(canonical_path);
			}
			continue;
		}

		if metadata.is_file() {
			budget
				.record_file(CONTEXT_TRAVERSAL_LIMITS)
				.map_err(context_traversal_limit_error)?;
			files.push((canonical_path, metadata.len()));
			continue;
		}

		if !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				canonical_path.display(),
			));
		}

		if !visited_directories.insert(canonical_path.clone()) {
			continue;
		}
		budget
			.record_directory(CONTEXT_TRAVERSAL_LIMITS)
			.map_err(context_traversal_limit_error)?;

		for entry in fs::read_dir(&canonical_path)
			.map_err(|error| format!("Could not list {}: {error}", canonical_path.display()))?
		{
			let path = entry
				.map_err(|error| format!("Could not read a folder entry: {error}"))?
				.path();
			budget
				.record_entry(CONTEXT_TRAVERSAL_LIMITS)
				.map_err(context_traversal_limit_error)?;
			stack.push(path);
		}
	}

	Ok(())
}

fn context_traversal_limit_error(error: TraversalLimitExceeded) -> String {
	match error.kind {
		TraversalLimitKind::Files => format!(
			"The selection exceeds the limit of {} files for a context operation.",
			error.limit,
		),
		TraversalLimitKind::Directories => format!(
			"The selection exceeds the limit of {} folders for a context operation.",
			error.limit,
		),
		TraversalLimitKind::Entries => format!(
			"The selection exceeds the limit of {} traversed entries per context operation.",
			error.limit,
		),
		TraversalLimitKind::PathBytes => format!(
			"The selection contains a path longer than the {}-byte safe-discovery limit.",
			error.limit,
		),
		TraversalLimitKind::TotalPathBytes => format!(
			"The selection exceeds the aggregate limit of {} path bytes per operation.",
			error.limit,
		),
	}
}

fn decode_utf16(
	bytes: &[u8],
	little_endian: bool,
) -> Result<String, String> {
	if bytes.len() % 2 != 0 {
		return Err("The UTF-16 file has an invalid size.".to_string());
	}

	let code_units = bytes
		.chunks_exact(2)
		.map(|chunk| {
			let pair = [chunk[0], chunk[1]];

			if little_endian {
				u16::from_le_bytes(pair)
			} else {
				u16::from_be_bytes(pair)
			}
		})
		.collect::<Vec<_>>();

	String::from_utf16(&code_units)
		.map_err(|_| "The file contains an invalid UTF-16 sequence.".to_string())
}

fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
	let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
		String::from_utf8(bytes[3..].to_vec())
			.map_err(|_| "The file does not contain valid UTF-8 text.".to_string())?
	} else if bytes.starts_with(&[0xFF, 0xFE]) {
		decode_utf16(
			&bytes[2..],
			true,
		)?
	} else if bytes.starts_with(&[0xFE, 0xFF]) {
		decode_utf16(
			&bytes[2..],
			false,
		)?
	} else {
		String::from_utf8(bytes)
			.map_err(|_| "The file does not contain valid UTF-8 text.".to_string())?
	};

	if content.contains('\0') {
		return Err("The file appears to be binary and was skipped.".to_string());
	}

	Ok(content)
}

fn relative_path(
	root: &Path,
	path: &Path,
) -> Result<String, String> {
	let relative = path
		.strip_prefix(root)
		.map_err(|_| "Could not calculate the file-relative path.".to_string())?;
	let normalized = relative
		.to_string_lossy()
		.replace('\\', "/");

	Ok(format!("./{normalized}"))
}

fn is_context_zip_file(file_path: &Path) -> bool {
	file_path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

fn materialize_context_file(
	file_path: &Path,
	relative_path: String,
	paths_only: bool,
	total_content_bytes: &mut u64,
) -> Result<Result<GeneratedFile, SkippedFile>, String> {
	if is_context_zip_file(file_path) {
		return Ok(Err(SkippedFile {
			relative_path,
			reason: "ZIP files are not added to context. Use the Apply code area.".to_string(),
		}));
	}

	if paths_only {
		return Ok(Ok(GeneratedFile {
			relative_path,
			content: None,
		}));
	}

	let metadata_size = fs::metadata(file_path)
		.map_err(|error| format!("Could not read {}: {error}", file_path.display()))?
		.len();
	if metadata_size > CONTEXT_MAX_FILE_BYTES {
		return Ok(Err(SkippedFile {
			relative_path,
			reason: format!(
				"File omitted because it exceeds the {} MiB per-context-file limit.",
				CONTEXT_MAX_FILE_BYTES / (1024 * 1024),
			),
		}));
	}

	let file = File::open(file_path)
		.map_err(|error| format!("Could not open {}: {error}", file_path.display()))?;
	let mut bytes = Vec::with_capacity(metadata_size.min(CONTEXT_MAX_FILE_BYTES) as usize);
	file.take(CONTEXT_MAX_FILE_BYTES + 1)
		.read_to_end(&mut bytes)
		.map_err(|error| format!("Could not read {}: {error}", file_path.display()))?;
	if bytes.len() as u64 > CONTEXT_MAX_FILE_BYTES {
		return Ok(Err(SkippedFile {
			relative_path,
			reason: format!(
				"File omitted because it grew beyond the {} MiB limit while being read.",
				CONTEXT_MAX_FILE_BYTES / (1024 * 1024),
			),
		}));
	}

	*total_content_bytes = total_content_bytes
		.checked_add(bytes.len() as u64)
		.ok_or_else(|| "The total context size is invalid.".to_string())?;
	if *total_content_bytes > CONTEXT_MAX_TOTAL_BYTES {
		return Err(format!(
			"The selected content exceeds the {} MiB per-context-operation limit.",
			CONTEXT_MAX_TOTAL_BYTES / (1024 * 1024),
		));
	}

	match decode_text(bytes) {
		Ok(content) => Ok(Ok(GeneratedFile {
			relative_path,
			content: Some(content),
		})),
		Err(reason) => Ok(Err(SkippedFile {
			relative_path,
			reason,
		})),
	}
}

fn parse_stored_context_relative_path(
	root: &Path,
	value: &str,
) -> Result<PathBuf, String> {
	if value.is_empty() || value.len() > CONTEXT_MAX_PATH_BYTES || value.contains('\0') || value.contains('\\') {
		return Err("The context contains an invalid saved path.".to_string());
	}

	let stripped = value
		.strip_prefix("./")
		.ok_or_else(|| "The context contains a path that is not relative to the project root.".to_string())?;
	if stripped.is_empty() {
		return Err("The context contains an empty file path.".to_string());
	}

	let relative = PathBuf::from(stripped);
	safe_fs::validate_project_relative_path(
		root,
		&relative,
	)?;
	Ok(relative)
}

#[tauri::command]
fn folder_exists(path: String) -> bool {
	Path::new(&path).is_dir()
}

fn canonical_project_roots(root_folders: &[String]) -> Vec<Option<PathBuf>> {
	root_folders
		.iter()
		.map(|root_folder| {
			canonicalize_existing(Path::new(root_folder))
				.ok()
				.filter(|root| root.is_dir())
		})
		.collect()
}

#[tauri::command]
fn find_project_for_root(
	root_folders: Vec<String>,
	path: String,
) -> Result<Option<usize>, String> {
	let requested = canonicalize_existing(Path::new(&path))?;

	if !requested.is_dir() {
		return Ok(None);
	}

	Ok(canonical_project_roots(&root_folders)
		.into_iter()
		.position(|root| root.is_some_and(|root| root == requested)))
}

#[tauri::command]
fn find_project_for_paths(
	root_folders: Vec<String>,
	paths: Vec<String>,
) -> Result<Option<usize>, String> {
	if paths.is_empty() {
		return Ok(None);
	}

	let canonical_paths = paths
		.iter()
		.map(|path| canonicalize_existing(Path::new(path)))
		.collect::<Result<Vec<_>, _>>()?;
	let roots = canonical_project_roots(&root_folders);
	let mut best_match: Option<(usize, usize)> = None;

	for (index, root) in roots.into_iter().enumerate() {
		let Some(root) = root else {
			continue;
		};

		if !canonical_paths.iter().all(|path| path.starts_with(&root)) {
			continue;
		}

		let depth = root.components().count();

		if best_match.is_none_or(|(_, best_depth)| depth > best_depth) {
			best_match = Some((index, depth));
		}
	}

	Ok(best_match.map(|(index, _)| index))
}

fn resolve_executable_from_path(name: &str) -> Option<PathBuf> {
	let path = std::env::var_os("PATH")?;
	std::env::split_paths(&path)
		.map(|directory| directory.join(name))
		.find(|candidate| candidate.is_file())
		.and_then(|candidate| fs::canonicalize(candidate).ok())
}

#[cfg(target_os = "windows")]
const WINDOWS_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const MAX_EXTERNAL_COMMAND_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
#[cfg(target_os = "windows")]
const MAX_EXTERNAL_COMMAND_RUNTIME: Duration = Duration::from_secs(60);

#[cfg(target_os = "windows")]
fn read_external_output_bounded<R: Read + Send + 'static>(
	mut reader: R,
	total_bytes: Arc<AtomicUsize>,
	exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
	thread::spawn(move || {
		let mut output = Vec::new();
		let mut buffer = [0_u8; 16 * 1024];
		loop {
			let read = reader.read(&mut buffer)?;
			if read == 0 {
				break;
			}
			let previous = total_bytes.fetch_add(read, Ordering::AcqRel);
			if previous.saturating_add(read) > MAX_EXTERNAL_COMMAND_OUTPUT_BYTES {
				exceeded.store(true, Ordering::Release);
				continue;
			}
			output.extend_from_slice(&buffer[..read]);
		}
		Ok(output)
	})
}

#[cfg(target_os = "windows")]
fn run_windows_command_bounded(mut command: Command) -> Result<Output, String> {
	command.stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = command
		.spawn()
		.map_err(|error| format!("Could not start the external process: {error}"))?;
	let stdout = match child.stdout.take() {
		Some(stdout) => stdout,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The external process did not provide stdout.".to_string());
		}
	};
	let stderr = match child.stderr.take() {
		Some(stderr) => stderr,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The external process did not provide stderr.".to_string());
		}
	};
	let exceeded = Arc::new(AtomicBool::new(false));
	let total_bytes = Arc::new(AtomicUsize::new(0));
	let stdout_task = read_external_output_bounded(
		stdout,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);
	let stderr_task = read_external_output_bounded(
		stderr,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);
	let started = Instant::now();
	let status = loop {
		if exceeded.load(Ordering::Acquire) {
			process_tree::terminate_process_tree(&mut child);
			break Err(format!(
				"External process output exceeded the {} MiB limit.",
				MAX_EXTERNAL_COMMAND_OUTPUT_BYTES / (1024 * 1024),
			));
		}
		if started.elapsed() > MAX_EXTERNAL_COMMAND_RUNTIME {
			process_tree::terminate_process_tree(&mut child);
			break Err("The external process exceeded the 60-second limit and was stopped.".to_string());
		}
		match child.try_wait() {
			Ok(Some(status)) => break Ok(status),
			Ok(None) => thread::sleep(Duration::from_millis(10)),
			Err(error) => {
				process_tree::terminate_process_tree(&mut child);
				break Err(format!("Could not wait for the external process: {error}"));
			}
		}
	};
	let stdout = stdout_task
		.join()
		.map_err(|_| "Reading external-process stdout was interrupted.".to_string())?
		.map_err(|error| format!("Could not read external-process stdout: {error}"))?;
	let stderr = stderr_task
		.join()
		.map_err(|_| "Reading external-process stderr was interrupted.".to_string())?
		.map_err(|error| format!("Could not read external-process stderr: {error}"))?;

	Ok(Output {
		status: status?,
		stdout,
		stderr,
	})
}

#[cfg(target_os = "windows")]
fn vscode_install_roots() -> Vec<PathBuf> {
	let mut roots = Vec::new();

	if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
		roots.push(
			PathBuf::from(local_app_data)
				.join("Programs")
				.join("Microsoft VS Code"),
		);
	}

	for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
		if let Some(program_files) = std::env::var_os(variable) {
			roots.push(
				PathBuf::from(program_files)
					.join("Microsoft VS Code"),
			);
		}
	}

	roots
}

#[cfg(target_os = "windows")]
fn canonical_existing_candidates(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
	let mut seen = HashSet::new();

	candidates
		.into_iter()
		.filter(|candidate| candidate.is_file())
		.filter_map(|candidate| fs::canonicalize(candidate).ok())
		.filter(|candidate| seen.insert(candidate.clone()))
		.collect()
}

#[cfg(target_os = "windows")]
fn vscode_registry_executable_candidates() -> Vec<PathBuf> {
	use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
	use winreg::RegKey;

	const APP_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\App Paths\Code.exe";
	let mut candidates = Vec::new();

	for root in [
		RegKey::predef(HKEY_CURRENT_USER),
		RegKey::predef(HKEY_LOCAL_MACHINE),
	] {
		let Ok(key) = root.open_subkey(APP_PATH) else {
			continue;
		};
		let Ok(path) = key.get_value::<String, _>("") else {
			continue;
		};
		let trimmed = path.trim().trim_matches('"');

		if !trimmed.is_empty() {
			candidates.push(PathBuf::from(trimmed));
		}
	}

	candidates
}

#[cfg(target_os = "windows")]
fn vscode_executable_candidates() -> Vec<PathBuf> {
	let mut candidates = vscode_install_roots()
		.into_iter()
		.map(|root| root.join("Code.exe"))
		.collect::<Vec<_>>();

	candidates.extend(vscode_registry_executable_candidates());

	if let Some(path_candidate) = resolve_executable_from_path("Code.exe") {
		candidates.push(path_candidate);
	}

	if let Some(cli_candidate) = resolve_executable_from_path("code.cmd") {
		if let Some(install_root) = cli_candidate.parent().and_then(Path::parent) {
			candidates.push(install_root.join("Code.exe"));
		}
	}

	canonical_existing_candidates(candidates)
}

#[cfg(target_os = "windows")]
fn vscode_cli_candidates() -> Vec<PathBuf> {
	let mut candidates = vscode_install_roots()
		.into_iter()
		.map(|root| root.join("bin").join("code.cmd"))
		.collect::<Vec<_>>();

	if let Some(path_candidate) = resolve_executable_from_path("code.cmd") {
		candidates.push(path_candidate);
	}

	// Code.exe accepts the same extension-install CLI arguments and is a safe
	// fallback when the shell wrapper is unavailable.
	candidates.extend(vscode_executable_candidates());
	canonical_existing_candidates(candidates)
}

#[cfg(target_os = "windows")]
fn is_vscode_available_blocking() -> bool {
	!vscode_executable_candidates().is_empty()
}

#[cfg(not(target_os = "windows"))]
fn is_vscode_available_blocking() -> bool {
	false
}

#[tauri::command]
async fn is_vscode_available() -> Result<bool, String> {
	tauri::async_runtime::spawn_blocking(is_vscode_available_blocking)
		.await
		.map_err(|error| format!("VS Code detection was interrupted: {error}"))
}

#[cfg(target_os = "windows")]
fn open_folder_in_vscode_blocking(path: &Path) -> Result<(), String> {
	let executable = vscode_executable_candidates()
		.into_iter()
		.next()
		.ok_or_else(|| "Could not locate a Visual Studio Code installation.".to_string())?;
	let mut command = Command::new(executable);
	command
		.arg(path)
		.stdin(Stdio::null())
		.stdout(Stdio::null())
		.stderr(Stdio::null())
		.creation_flags(WINDOWS_NO_WINDOW);
	command
		.spawn()
		.map_err(|error| format!("Could not open the project in VS Code: {error}"))?;
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_folder_in_vscode_blocking(_path: &Path) -> Result<(), String> {
	Err("Automatic VS Code integration is available only on Windows.".to_string())
}

#[tauri::command]
async fn open_folder_in_vscode(path: String) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		let folder = PathBuf::from(path);

		if !folder.is_dir() {
			return Err("The configured folder no longer exists.".to_string());
		}

		if !is_vscode_available_blocking() {
			return Err("Visual Studio Code is not available in this environment.".to_string());
		}

		open_folder_in_vscode_blocking(&folder)
	})
	.await
	.map_err(|error| format!("Opening VS Code was interrupted: {error}"))?
}

#[cfg(target_os = "windows")]
fn install_vscode_extension_blocking(vsix_path: &Path) -> Result<(), String> {
	let mut last_error: Option<String> = None;

	for cli_path in vscode_cli_candidates() {
		let mut command = Command::new(&cli_path);
		command
			.arg("--install-extension")
			.arg(vsix_path)
			.arg("--force")
			.stdin(Stdio::null())
			.creation_flags(WINDOWS_NO_WINDOW);

		let output = match run_windows_command_bounded(command) {
			Ok(output) => output,
			Err(error) => {
				last_error = Some(format!(
					"Could not execute {}: {error}",
					cli_path.display(),
				));
				continue;
			}
		};

		if output.status.success() {
			return Ok(());
		}

		let stderr = String::from_utf8_lossy(&output.stderr);
		let stdout = String::from_utf8_lossy(&output.stdout);
		let details = if !stderr.trim().is_empty() {
			stderr.trim()
		} else {
			stdout.trim()
		};

		last_error = Some(if details.is_empty() {
			format!(
				"VS Code rejected extension installation using {}.",
				cli_path.display(),
			)
		} else {
			format!(
				"VS Code rejected extension installation using {}: {details}",
				cli_path.display(),
			)
		});
	}

	Err(last_error.unwrap_or_else(|| {
		"Could not locate a Visual Studio Code installation.".to_string()
	}))
}

#[cfg(not(target_os = "windows"))]
fn install_vscode_extension_blocking(_vsix_path: &Path) -> Result<(), String> {
	Err("Automatic VS Code extension installation is available only on Windows.".to_string())
}

#[tauri::command]
async fn install_vscode_extension(app: AppHandle) -> Result<(), String> {
	let vsix_path = app
		.path()
		.resolve(
			"vscode/orqeto-dev-vscode.vsix",
			BaseDirectory::Resource,
		)
		.map_err(|error| format!("Could not locate the packaged extension: {error}"))?;

	if !vsix_path.is_file() {
		return Err("The VS Code extension was not found in the Orqeto Dev package.".to_string());
	}

	tauri::async_runtime::spawn_blocking(move || {
		if !is_vscode_available_blocking() {
			return Err("Visual Studio Code is not available in this environment.".to_string());
		}

		install_vscode_extension_blocking(&vsix_path)
	})
	.await
	.map_err(|error| format!("Extension installation was interrupted: {error}"))?
}

#[cfg(target_os = "windows")]
const WINDOWS_OPEN_OR_FOCUS_EXPLORER_SCRIPT: &str = r#"
$ErrorActionPreference = "Stop"
$requested = $env:ORQETO_DEV_EXPLORER_PATH
$target = [System.IO.Path]::GetFullPath($requested).TrimEnd([char]92)
$shell = New-Object -ComObject Shell.Application
$windows = $shell.Windows()
$match = $null

for ($index = 0; $index -lt $windows.Count; $index++) {
	$candidate = $windows.Item($index)

	try {
		$candidatePath = [System.IO.Path]::GetFullPath([string]$candidate.Document.Folder.Self.Path).TrimEnd([char]92)

		if ($candidatePath -ieq $target) {
			$match = $candidate
			break
		}
	} catch {}
}

if ($null -ne $match) {
	if (-not ("OrqetoDev.NativeWindow" -as [type])) {
		Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace OrqetoDev {
	public static class NativeWindow {
		[DllImport("user32.dll")]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool IsIconic(IntPtr hWnd);

		[DllImport("user32.dll")]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

		[DllImport("user32.dll")]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool SetForegroundWindow(IntPtr hWnd);
	}
}
"@
	}

	$handle = [IntPtr][long]$match.HWND

	if ([OrqetoDev.NativeWindow]::IsIconic($handle)) {
		[OrqetoDev.NativeWindow]::ShowWindowAsync($handle, 9) | Out-Null
	}

	[OrqetoDev.NativeWindow]::SetForegroundWindow($handle) | Out-Null
	exit 0
}

$shell.Explore($requested)
"#;

#[cfg(target_os = "windows")]
const WINDOWS_CLOSE_EXPLORER_SCRIPT: &str = r#"
$ErrorActionPreference = "Stop"
$target = [System.IO.Path]::GetFullPath($env:ORQETO_DEV_EXPLORER_PATH).TrimEnd([char]92)
$shell = New-Object -ComObject Shell.Application
$windows = $shell.Windows()

for ($index = $windows.Count - 1; $index -ge 0; $index--) {
	$candidate = $windows.Item($index)

	try {
		$candidatePath = [System.IO.Path]::GetFullPath([string]$candidate.Document.Folder.Self.Path).TrimEnd([char]92)

		if ($candidatePath -ieq $target) {
			$candidate.Quit()
		}
	} catch {}
}
"#;

#[cfg(target_os = "windows")]
fn run_windows_explorer_script(
	path: &Path,
	script: &str,
) -> Result<(), String> {
	let system_root = std::env::var_os("SystemRoot")
		.ok_or_else(|| "The Windows folder is not available in the current environment.".to_string())?;
	let powershell = PathBuf::from(system_root)
		.join("System32")
		.join("WindowsPowerShell")
		.join("v1.0")
		.join("powershell.exe");
	let powershell = fs::canonicalize(&powershell)
		.map_err(|error| format!("Could not locate Windows PowerShell: {error}"))?;
	let mut command = Command::new(powershell);
	command
		.args([
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-WindowStyle",
			"Hidden",
			"-Command",
			script,
		])
		.env(
			"ORQETO_DEV_EXPLORER_PATH",
			path,
		)
		.stdin(Stdio::null())
		.creation_flags(WINDOWS_NO_WINDOW);
	let output = run_windows_command_bounded(command)
		.map_err(|error| format!("Could not control Explorer: {error}"))?;

	if output.status.success() {
		return Ok(());
	}

	let stderr = String::from_utf8_lossy(&output.stderr);
	let details = stderr.trim();

	if details.is_empty() {
		return Err("Windows could not control the Explorer window.".to_string());
	}

	Err(format!("Windows could not control the Explorer window: {details}"))
}

#[cfg(target_os = "windows")]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	run_windows_explorer_script(
		path,
		WINDOWS_OPEN_OR_FOCUS_EXPLORER_SCRIPT,
	)
}

#[cfg(target_os = "macos")]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	Command::new("/usr/bin/open")
		.arg(path)
		.spawn()
		.map_err(|error| format!("Could not open the file explorer: {error}"))?;

	Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	let executable = if Path::new("/usr/bin/xdg-open").is_file() {
		PathBuf::from("/usr/bin/xdg-open")
	} else {
		resolve_executable_from_path("xdg-open")
			.ok_or_else(|| "Could not locate xdg-open.".to_string())?
	};
	Command::new(executable)
		.arg(path)
		.spawn()
		.map_err(|error| format!("Could not open the file explorer: {error}"))?;

	Ok(())
}

#[cfg(target_os = "windows")]
fn close_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	run_windows_explorer_script(
		path,
		WINDOWS_CLOSE_EXPLORER_SCRIPT,
	)
}

#[cfg(not(target_os = "windows"))]
fn close_folder_in_explorer_blocking(_path: &Path) -> Result<(), String> {
	Ok(())
}

#[tauri::command]
async fn open_folder_in_explorer(path: String) -> Result<(), String> {
	let folder = PathBuf::from(path);

	if !folder.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	tauri::async_runtime::spawn_blocking(move || open_folder_in_explorer_blocking(&folder))
		.await
		.map_err(|error| format!("Opening Explorer was interrupted: {error}"))?
}

#[tauri::command]
async fn close_folder_in_explorer(path: String) -> Result<(), String> {
	let folder = PathBuf::from(path);

	tauri::async_runtime::spawn_blocking(move || close_folder_in_explorer_blocking(&folder))
		.await
		.map_err(|error| format!("Closing Explorer was interrupted: {error}"))?
}

fn context_path_payload_too_large(paths: &[String]) -> bool {
	paths
		.iter()
		.fold(0_usize, |total, path| total.saturating_add(path.len())) > CONTEXT_MAX_TOTAL_PATH_BYTES
}

fn process_drop_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<ProcessDropResult, String> {
	if paths.len() > CONTEXT_MAX_REQUEST_PATHS ||
		context_path_payload_too_large(&paths) ||
		root_folder.len() > CONTEXT_MAX_PATH_BYTES ||
		paths.iter().any(|path| path.is_empty() || path.len() > CONTEXT_MAX_PATH_BYTES || path.contains('\0'))
	{
		return Err("The context selection contains too many paths or an invalid path.".to_string());
	}

	if paths.is_empty() {
		return Ok(ProcessDropResult {
			files: Vec::new(),
			directories: Vec::new(),
			skipped_files: Vec::new(),
			skipped_directory_count: 0,
			selected_bytes: 0,
		});
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut collected_files = Vec::new();
	let mut ignored_files = Vec::new();
	let mut ignored_directories = HashSet::new();
	let mut visited_directories = HashSet::new();
	let mut traversal_budget = TraversalBudget::default();

	let mut dropped_paths = paths
		.into_iter()
		.map(PathBuf::from)
		.collect::<Vec<_>>();

	dropped_paths.sort();

	for dropped_path in dropped_paths {
		collect_files(
			&root,
			&dropped_path,
			&project_ignore,
			&mut visited_directories,
			&mut collected_files,
			&mut ignored_files,
			&mut ignored_directories,
			&mut traversal_budget,
		)?;
	}

	collected_files.sort_by(|(left, _), (right, _)| left.cmp(right));
	collected_files.dedup_by(|(left, _), (right, _)| left == right);
	ignored_files.sort();
	ignored_files.dedup();

	let mut directories = visited_directories
		.into_iter()
		.map(|path| relative_path(
			&root,
			&path,
		))
		.collect::<Result<Vec<_>, _>>()?;
	directories.sort();
	directories.dedup();

	let mut selected_files = Vec::new();
	let mut selected_bytes = 0_u64;
	let mut skipped_files = ignored_files
		.into_iter()
		.map(|path| {
			Ok(SkippedFile {
				relative_path: relative_path(
					&root,
					&path,
				)?,
				reason: "File omitted because it is covered by .orqeto-devignore.".to_string(),
			})
		})
		.collect::<Result<Vec<_>, String>>()?;

	for (file_path, file_size) in collected_files {
		let relative_path = relative_path(
			&root,
			&file_path,
		)?;

		if is_context_zip_file(&file_path) {
			skipped_files.push(SkippedFile {
				relative_path,
				reason: "ZIP files are not added to context. Use the Apply code area.".to_string(),
			});
			continue;
		}

		selected_bytes = selected_bytes
			.checked_add(file_size)
			.ok_or_else(|| "The aggregate context-selection size is invalid.".to_string())?;

		selected_files.push(ContextSelectionFile {
			relative_path,
			size_bytes: file_size,
		});
	}

	Ok(ProcessDropResult {
		files: selected_files,
		directories,
		skipped_files,
		skipped_directory_count: ignored_directories.len(),
		selected_bytes,
	})
}

#[tauri::command]
async fn process_drop(
	root_folder: String,
	paths: Vec<String>,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<ProcessDropResult, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		process_drop_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("Reading files was interrupted: {error}"))?
}

fn materialize_context_files_blocking(
	root_folder: String,
	relative_paths: Vec<String>,
	paths_only: bool,
) -> Result<MaterializeContextResult, String> {
	if relative_paths.len() > CONTEXT_MAX_FILES ||
		context_path_payload_too_large(&relative_paths) ||
		root_folder.len() > CONTEXT_MAX_PATH_BYTES ||
		relative_paths.iter().any(|path| path.is_empty() || path.len() > CONTEXT_MAX_PATH_BYTES || path.contains('\0'))
	{
		return Err("The saved context contains too many paths or an invalid path.".to_string());
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;
	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut selected = relative_paths;
	selected.sort();
	selected.dedup();

	let mut generated_files = Vec::with_capacity(selected.len());
	let mut skipped_files = Vec::new();
	let mut total_content_bytes = 0_u64;

	for stored_path in selected {
		let relative = parse_stored_context_relative_path(
			&root,
			&stored_path,
		)?;
		let candidate = root.join(&relative);
		let metadata = match fs::symlink_metadata(&candidate) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				skipped_files.push(SkippedFile {
					relative_path: stored_path,
					reason: "File omitted because it no longer exists in the project.".to_string(),
				});
				continue;
			}
			Err(error) => {
				return Err(format!(
					"Could not validate {}: {error}",
					candidate.display(),
				));
			}
		};

		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!(
				"Saved path {} no longer points to a safe regular file.",
				stored_path,
			));
		}

		let canonical = canonicalize_existing(&candidate)?;
		ensure_inside_root(
			&root,
			&canonical,
		)?;
		if project_ignore.is_ignored(&canonical, false) {
			skipped_files.push(SkippedFile {
				relative_path: stored_path,
				reason: "File omitted because it is now covered by .orqeto-devignore.".to_string(),
			});
			continue;
		}

		let current_relative = relative_path(
			&root,
			&canonical,
		)?;
		match materialize_context_file(
			&canonical,
			current_relative,
			paths_only,
			&mut total_content_bytes,
		)? {
			Ok(file) => generated_files.push(file),
			Err(skipped) => skipped_files.push(skipped),
		}
	}

	Ok(MaterializeContextResult {
		files: generated_files,
		directories: Vec::new(),
		skipped_files,
		skipped_directory_count: 0,
	})
}

#[tauri::command]
async fn materialize_context_files(
	root_folder: String,
	relative_paths: Vec<String>,
	paths_only: bool,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<MaterializeContextResult, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		materialize_context_files_blocking(
			root_folder,
			relative_paths,
			paths_only,
		)
	})
	.await
	.map_err(|error| format!("Context update was interrupted: {error}"))?
}

fn resolve_context_removal_paths_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<Vec<ContextRemovalPath>, String> {
	if paths.len() > CONTEXT_MAX_REQUEST_PATHS ||
		context_path_payload_too_large(&paths) ||
		root_folder.len() > CONTEXT_MAX_PATH_BYTES ||
		paths.iter().any(|path| path.is_empty() || path.len() > CONTEXT_MAX_PATH_BYTES || path.contains('\0'))
	{
		return Err("The removal selection contains too many paths or an invalid path.".to_string());
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let mut canonical_paths = paths
		.into_iter()
		.map(|path| canonicalize_existing(Path::new(&path)))
		.collect::<Result<Vec<_>, _>>()?;

	canonical_paths.sort();
	canonical_paths.dedup();

	let mut resolved = Vec::with_capacity(canonical_paths.len());

	for path in canonical_paths {
		ensure_inside_root(
			&root,
			&path,
		)?;

		let metadata = fs::metadata(&path)
			.map_err(|error| format!("Could not read {}: {error}", path.display()))?;

		if !metadata.is_file() && !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				path.display(),
			));
		}

		resolved.push(ContextRemovalPath {
			relative_path: relative_path(
				&root,
				&path,
			)?,
			is_directory: metadata.is_dir(),
		});
	}

	Ok(resolved)
}

#[tauri::command]
async fn resolve_context_removal_paths(
	root_folder: String,
	paths: Vec<String>,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<Vec<ContextRemovalPath>, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		resolve_context_removal_paths_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("Path validation was interrupted: {error}"))?
}


#[derive(Default)]
struct ContextTreeNode {
	files: Vec<ContextTreeFile>,
	directories: BTreeMap<String, ContextTreeNode>,
}

struct ContextTreeFile {
	name: String,
	content: Option<String>,
}

struct ContextProtocol {
	header: &'static str,
	label: &'static str,
	work_mode_files: &'static str,
	files_patch_instruction: &'static str,
	work_mode_git: &'static str,
	git_patch_instruction: &'static str,
	git_patch_safety: &'static str,
	root_description: &'static str,
	folder_description: &'static str,
	back_description: &'static str,
	file_description: &'static str,
	content_description: &'static str,
	path_only_description: &'static str,
	delete_manifest_description: &'static str,
	delete_manifest_format: &'static str,
	delete_manifest_paths: &'static str,
	delete_manifest_optional: &'static str,
	root: &'static str,
	folder: &'static str,
	back: &'static str,
	file: &'static str,
	content_start: &'static str,
	content_end: &'static str,
	end: &'static str,
}

fn context_protocol(locale: &str) -> Result<ContextProtocol, String> {
	match locale {
		"pt-BR" => Ok(ContextProtocol {
			header: "===== ORQETO DEV: CONTEXTO =====",
			label: "PROTOCOLO:",
			work_mode_files: "- MODO DE TRABALHO: ARQUIVOS.",
			files_patch_instruction: "- Ao propor alterações, entregue arquivos completos preservando os paths relativos à RAIZ. Para múltiplos arquivos, prefira um ZIP incremental contendo somente arquivos novos/alterados. Não gere .patch ou .diff.",
			work_mode_git: "- MODO DE TRABALHO: GIT.",
			git_patch_instruction: "- Ao propor alterações, entregue um único arquivo textual .patch ou .diff no formato Git unified diff compatível com git apply. Use somente paths relativos à RAIZ e / como separador.",
			git_patch_safety: "- Baseie cada hunk exclusivamente no conteúdo atual fornecido. Não use uma versão anterior, presumida ou memorizada do arquivo. O patch deve aplicar limpo e não deve conter binários, symlinks, submodules, operações Git de copy ou alterações de modo/permissão. Não dependa de --3way nem de tolerância de whitespace.",
			root_description: "- RAIZ representa a pasta selecionada no aplicativo.",
			folder_description: "- PASTA entra no caminho informado a partir da pasta atual.",
			back_description: "- VOLTAR retorna ao contexto de pasta anterior.",
			file_description: "- ARQUIVO pertence à pasta atual. O nome pode incluir subpastas quando esse ramo foi condensado.",
			content_description: "- Somente o texto entre INÍCIO DO CONTEÚDO e FIM DO CONTEÚDO pertence ao arquivo.",
			path_only_description: "- Quando um ARQUIVO não tiver delimitadores de conteúdo em seguida, ele representa somente o path do arquivo; não infira conteúdo ausente.",
			delete_manifest_description: "- Se a implementação remover ou renomear arquivos existentes, inclua na raiz do ZIP/pasta do patch o arquivo reservado .orqeto-dev-delete.json.",
			delete_manifest_format: "- Formato exato: {\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/arquivo-antigo.ts\"]}",
			delete_manifest_paths: "- delete contém somente paths relativos à RAIZ, usando /, e somente de arquivos existentes que devem ser excluídos. Não liste diretórios, paths absolutos, ./, .. ou barras invertidas.",
			delete_manifest_optional: "- Omita .orqeto-dev-delete.json quando não houver exclusões. Esse arquivo é metadado de controle do patch e nunca deve virar arquivo do projeto.",
			root: "RAIZ",
			folder: "PASTA",
			back: "VOLTAR",
			file: "ARQUIVO",
			content_start: "INÍCIO DO CONTEÚDO",
			content_end: "FIM DO CONTEÚDO",
			end: "===== FIM DO ORQETO DEV: CONTEXTO =====",
		}),
		"en" => Ok(ContextProtocol {
			header: "===== ORQETO DEV: CONTEXT =====",
			label: "PROTOCOL:",
			work_mode_files: "- WORK MODE: FILES.",
			files_patch_instruction: "- When proposing changes, deliver complete files while preserving ROOT-relative paths. For multiple files, prefer an incremental ZIP containing only new/changed files. Do not generate .patch or .diff.",
			work_mode_git: "- WORK MODE: GIT.",
			git_patch_instruction: "- When proposing changes, deliver one textual .patch or .diff file as a Git unified diff compatible with git apply. Use only ROOT-relative paths and / as the separator.",
			git_patch_safety: "- Base every hunk exclusively on the current content provided. Do not use an older, assumed, or remembered version of the file. The patch must apply cleanly and must not contain binaries, symlinks, submodules, Git copy operations, or file mode/permission changes. Do not depend on --3way or whitespace tolerance.",
			root_description: "- ROOT represents the folder selected in the application.",
			folder_description: "- FOLDER enters the given path relative to the current folder.",
			back_description: "- BACK returns to the previous folder context.",
			file_description: "- FILE belongs to the current folder. Its name may include subfolders when that branch was condensed.",
			content_description: "- Only text between CONTENT START and CONTENT END belongs to the file.",
			path_only_description: "- When a FILE is not followed by content delimiters, it represents only that file path; do not infer missing content.",
			delete_manifest_description: "- If the implementation removes or renames existing files, include the reserved .orqeto-dev-delete.json file at the root of the patch ZIP/folder.",
			delete_manifest_format: "- Exact format: {\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/old-file.ts\"]}",
			delete_manifest_paths: "- delete contains only ROOT-relative paths using /, and only for existing files that must be removed. Do not list directories, absolute paths, ./, .., or backslashes.",
			delete_manifest_optional: "- Omit .orqeto-dev-delete.json when there are no deletions. This file is patch control metadata and must never become a project file.",
			root: "ROOT",
			folder: "FOLDER",
			back: "BACK",
			file: "FILE",
			content_start: "CONTENT START",
			content_end: "CONTENT END",
			end: "===== END OF ORQETO DEV: CONTEXT =====",
		}),
		_ => Err("The requested context language is invalid.".to_string()),
	}
}

fn context_path_parts(relative_path: &str) -> Vec<&str> {
	relative_path
		.trim_start_matches("./")
		.split(|character| character == '/' || character == '\\')
		.filter(|part| !part.is_empty())
		.collect()
}

fn insert_context_tree_file(root: &mut ContextTreeNode, file: GeneratedFile) {
	let parts = context_path_parts(&file.relative_path);
	let Some(file_name) = parts.last() else {
		return;
	};
	let mut current = root;
	for directory in &parts[..parts.len().saturating_sub(1)] {
		current = current.directories.entry((*directory).to_string()).or_default();
	}
	current.files.push(ContextTreeFile {
		name: (*file_name).to_string(),
		content: file.content,
	});
}

fn compressed_context_directory(
	name: String,
	mut node: ContextTreeNode,
) -> (String, ContextTreeNode) {
	let mut path = name;
	while node.files.is_empty() && node.directories.len() == 1 {
		let Some((next_name, next_node)) = node.directories.pop_first() else {
			break;
		};
		path.push('/');
		path.push_str(&next_name);
		node = next_node;
	}
	(path, node)
}

fn format_context_file(
	name: &str,
	content: Option<String>,
	protocol: &ContextProtocol,
) -> String {
	let marker = format!("===== {}: {} =====", protocol.file, name);
	let Some(mut content) = content else {
		return marker;
	};
	if !content.ends_with('\n') {
		content.push('\n');
	}
	format!(
		"{marker}\n===== {} =====\n{content}===== {} =====",
		protocol.content_start,
		protocol.content_end,
	)
}

fn append_context_tree(
	mut node: ContextTreeNode,
	blocks: &mut Vec<String>,
	is_root: bool,
	protocol: &ContextProtocol,
) {
	node.files.sort_by(|left, right| left.name.cmp(&right.name));
	for file in node.files {
		blocks.push(format_context_file(
			&file.name,
			file.content,
			protocol,
		));
	}
	for (directory_name, directory_node) in node.directories {
		let (directory_path, mut compressed) = compressed_context_directory(
			directory_name,
			directory_node,
		);
		if compressed.files.len() == 1 && compressed.directories.is_empty() {
			let file = compressed.files.pop().expect("single file should exist");
			let relative_name = if is_root {
				format!("./{directory_path}/{}", file.name)
			} else {
				format!("{directory_path}/{}", file.name)
			};
			blocks.push(format_context_file(
				&relative_name,
				file.content,
				protocol,
			));
			continue;
		}
		blocks.push(format!(
			"===== {}: {} =====",
			protocol.folder,
			if is_root {
				format!("./{directory_path}")
			} else {
				directory_path
			},
		));
		append_context_tree(
			compressed,
			blocks,
			false,
			protocol,
		);
		blocks.push(format!("===== {} =====", protocol.back));
	}
}

fn format_materialized_context(
	files: Vec<GeneratedFile>,
	locale: &str,
	work_mode: &str,
) -> Result<String, String> {
	if files.is_empty() {
		return Ok(String::new());
	}
	let protocol = context_protocol(locale)?;
	let mode_lines = match work_mode {
		"files" => vec![
			protocol.work_mode_files,
			protocol.files_patch_instruction,
			protocol.delete_manifest_description,
			protocol.delete_manifest_format,
			protocol.delete_manifest_paths,
			protocol.delete_manifest_optional,
		],
		"git" => vec![
			protocol.work_mode_git,
			protocol.git_patch_instruction,
			protocol.git_patch_safety,
		],
		_ => return Err("The requested context work mode is invalid.".to_string()),
	};
	let mut header_lines = vec![
		protocol.header,
		protocol.label,
	];
	header_lines.extend(mode_lines);
	header_lines.extend([
		protocol.root_description,
		protocol.folder_description,
		protocol.back_description,
		protocol.file_description,
		protocol.content_description,
		protocol.path_only_description,
	]);
	let mut blocks = vec![format!(
		"{}\n===== {}: ./ =====",
		header_lines.join("\n"),
		protocol.root,
	)];
	let mut tree = ContextTreeNode::default();
	for file in files {
		insert_context_tree_file(
			&mut tree,
			file,
		);
	}
	append_context_tree(
		tree,
		&mut blocks,
		true,
		&protocol,
	);
	blocks.push(protocol.end.to_string());
	Ok(format!("{}\n", blocks.join("\n\n")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullProjectContextExportResult {
	saved: bool,
	file_count: usize,
	skipped_file_count: usize,
	skipped_directory_count: usize,
}

#[tauri::command]
async fn save_full_project_context_export_file(
	app: AppHandle,
	root_folder: String,
	relative_paths: Vec<String>,
	paths_only: bool,
	locale: String,
	work_mode: String,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<FullProjectContextExportResult, String> {
	let materialized = {
		let _read_guard = undo_state.begin_project_read(&root_folder)?;
		tauri::async_runtime::spawn_blocking(move || {
			materialize_context_files_blocking(
				root_folder,
				relative_paths,
				paths_only,
			)
		})
		.await
		.map_err(|error| format!("Project-context generation was interrupted: {error}"))??
	};
	let file_count = materialized.files.len();
	let skipped_file_count = materialized.skipped_files.len();
	let skipped_directory_count = materialized.skipped_directory_count;
	if file_count == 0 {
		return Ok(FullProjectContextExportResult {
			saved: false,
			file_count,
			skipped_file_count,
			skipped_directory_count,
		});
	}
	let content = format_materialized_context(
		materialized.files,
		&locale,
		&work_mode,
	)?;
	let saved = save_export_file(
		app,
		suggested_file_name,
		dialog_title,
		filter_name,
		extension,
		content,
	).await?;
	Ok(FullProjectContextExportResult {
		saved,
		file_count,
		skipped_file_count,
		skipped_directory_count,
	})
}

const MAX_EXPORT_BYTES: usize = 128 * 1024 * 1024;

#[tauri::command]
async fn save_export_file(
	app: AppHandle,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	content: String,
) -> Result<bool, String> {
	if suggested_file_name.is_empty() ||
		suggested_file_name.len() > 255 ||
		suggested_file_name.chars().any(|character| matches!(character, '/' | '\\' | '\0'))
	{
		return Err("The suggested export name is invalid.".to_string());
	}

	if dialog_title.len() > 256 || filter_name.is_empty() || filter_name.len() > 128 {
		return Err("The export-window data is invalid.".to_string());
	}

	if extension != "txt" {
		return Err("The requested export format is not allowed.".to_string());
	}

	if content.len() > MAX_EXPORT_BYTES {
		return Err(format!(
			"The export file exceeds the {} MiB limit.",
			MAX_EXPORT_BYTES / (1024 * 1024),
		));
	}

	tauri::async_runtime::spawn_blocking(move || {
		let selected = app
			.dialog()
			.file()
			.set_title(dialog_title)
			.set_file_name(suggested_file_name)
			.add_filter(filter_name, &[extension.as_str()])
			.blocking_save_file();
		let Some(selected) = selected else {
			return Ok(false);
		};
		let path = selected
			.into_path()
			.map_err(|error| format!("The selected export destination is invalid: {error}"))?;
		safe_fs::atomic_write_bytes(&path, content.as_bytes())
			.map_err(|error| format!("Could not save the file: {error}"))?;
		Ok(true)
	})
	.await
	.map_err(|error| format!("Writing the file was interrupted: {error}"))?
}

#[tauri::command]
async fn save_context_history_export_file(
	app: AppHandle,
	root_folder: String,
	id: i64,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	instances: State<'_, DbInstances>,
) -> Result<bool, String> {
	let content = config_database::load_context_history_content(
		&root_folder,
		id,
		instances,
	).await?;

	save_export_file(
		app,
		suggested_file_name,
		dialog_title,
		filter_name,
		extension,
		content,
	).await
}

#[tauri::command]
fn destroy_main_window(
	app: AppHandle,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<(), String> {
	if undo_state.has_active_mutations() {
		return Err("A critical project operation is in progress. Wait for it to finish before closing the application.".to_string());
	}

	let window = app
		.get_webview_window("main")
		.ok_or_else(|| "The main window is not available.".to_string())?;
	window
		.destroy()
		.map_err(|error| format!("Could not close the main window: {error}"))
}

#[cfg(test)]
mod context_selection_tests {
	use super::*;
	use std::time::{SystemTime, UNIX_EPOCH};

	fn test_root(name: &str) -> PathBuf {
		let nonce = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time")
			.as_nanos();

		std::env::temp_dir().join(format!(
			"orqeto-live-context-{name}-{}-{nonce}",
			std::process::id(),
		))
	}

	#[test]
	fn br_ctx_004_materialization_reads_current_content_instead_of_selection_time_content() {
		let root = test_root("fresh");
		fs::create_dir_all(&root).expect("create root");
		let file = root.join("example.txt");
		fs::write(&file, "first").expect("write first");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![file.to_string_lossy().into_owned()],
		).expect("select file");
		assert_eq!(selected.files[0].relative_path, "./example.txt");
		assert_eq!(selected.selected_bytes, 5);

		fs::write(&file, "second").expect("write second");
		let current = materialize_context_files_blocking(
			root.to_string_lossy().into_owned(),
			vec!["./example.txt".to_string()],
			false,
		).expect("materialize current file");

		assert_eq!(current.files.len(), 1);
		assert_eq!(current.files[0].content.as_deref(), Some("second"));
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn br_ctx_005_selection_keeps_binary_file_as_reference_without_materializing_body() {
		let root = test_root("reference-only");
		fs::create_dir_all(&root).expect("create root");
		let file = root.join("binary.dat");
		fs::write(
			&file,
			[0_u8, 0xFF, 0xFE, 0x00, 0x80],
		).expect("write binary");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![file.to_string_lossy().into_owned()],
		).expect("select binary path");

		assert_eq!(selected.files.len(), 1);
		assert_eq!(selected.files[0].relative_path, "./binary.dat");
		assert!(selected.skipped_files.is_empty());

		let materialized = materialize_context_files_blocking(
			root.to_string_lossy().into_owned(),
			vec!["./binary.dat".to_string()],
			false,
		).expect("materialize binary path");

		assert!(materialized.files.is_empty());
		assert_eq!(materialized.skipped_files.len(), 1);
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn br_ctx_006_unavailable_selected_members_never_use_stale_content() {
		let root = test_root("unavailable");
		fs::create_dir_all(&root).expect("create root");
		let missing_file = root.join("missing.txt");
		let ignored_file = root.join("ignored.txt");
		fs::write(&missing_file, "selection-time missing content").expect("write missing candidate");
		fs::write(&ignored_file, "selection-time ignored content").expect("write ignored candidate");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![
				missing_file.to_string_lossy().into_owned(),
				ignored_file.to_string_lossy().into_owned(),
			],
		).expect("select files");
		assert_eq!(selected.files.len(), 2);

		fs::remove_file(&missing_file).expect("remove selected file");
		fs::write(
			root.join(".orqeto-devignore"),
			"ignored.txt\n",
		).expect("ignore selected file");

		let materialized = materialize_context_files_blocking(
			root.to_string_lossy().into_owned(),
			vec![
				"./missing.txt".to_string(),
				"./ignored.txt".to_string(),
			],
			false,
		).expect("materialize unavailable files");

		assert!(materialized.files.is_empty());
		assert_eq!(materialized.skipped_files.len(), 2);
		assert!(materialized.skipped_files.iter().any(|file| {
			file.relative_path == "./missing.txt" &&
			file.reason.contains("no longer exists")
		}));
		assert!(materialized.skipped_files.iter().any(|file| {
			file.relative_path == "./ignored.txt" &&
			file.reason.contains(".orqeto-devignore")
		}));
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn br_perf_003_backend_full_project_formatter_preserves_context_protocol() {
		let formatted = format_materialized_context(
			vec![
				GeneratedFile {
					relative_path: "./src/main.ts".to_string(),
					content: Some("export {}".to_string()),
				},
				GeneratedFile {
					relative_path: "./README.md".to_string(),
					content: None,
				},
			],
			"en",
			"files",
		).expect("format backend full-project context");

		assert!(formatted.starts_with("===== ORQETO DEV: CONTEXT =====\nPROTOCOL:"));
		assert!(formatted.contains("===== ROOT: ./ ====="));
		assert!(formatted.contains("===== FILE: README.md ====="));
		assert!(formatted.contains("===== FILE: ./src/main.ts =====\n===== CONTENT START =====\nexport {}\n===== CONTENT END ====="));
		assert!(formatted.ends_with("===== END OF ORQETO DEV: CONTEXT =====\n"));
	}

	#[test]
	fn recursive_selection_reports_child_directories() {
		let root = test_root("directories");
		let nested = root.join("src").join("feature");
		fs::create_dir_all(&nested).expect("create nested root");
		fs::write(nested.join("index.ts"), "export {}\n").expect("write file");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![root.join("src").to_string_lossy().into_owned()],
		).expect("select tree");

		assert_eq!(selected.files.len(), 1);
		assert!(selected.directories.contains(&"./src".to_string()));
		assert!(selected.directories.contains(&"./src/feature".to_string()));
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn overlapping_selection_deduplicates_ignored_directories() {
		let root = test_root("ignored-dedup");
		let ignored = root.join("ignored");
		fs::create_dir_all(&ignored).expect("create ignored root");
		fs::write(root.join(".orqeto-devignore"), "ignored/\n").expect("write ignore");
		fs::write(root.join("keep.txt"), "keep").expect("write keep");
		fs::write(ignored.join("hidden.txt"), "hidden").expect("write hidden");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![
				root.to_string_lossy().into_owned(),
				ignored.to_string_lossy().into_owned(),
			],
		).expect("select overlapping tree");

		assert_eq!(selected.skipped_directory_count, 1);
		fs::remove_dir_all(root).expect("cleanup");
	}
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let migrations = vec![
		Migration {
			version: 1,
			description: "create_app_settings",
			sql: "
				CREATE TABLE IF NOT EXISTS app_settings (
					key TEXT PRIMARY KEY NOT NULL,
					value TEXT NOT NULL
				);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 2,
			description: "create_context_filter_history",
			sql: "
				CREATE TABLE IF NOT EXISTS context_filter_history (
					root_folder TEXT NOT NULL,
					pattern TEXT NOT NULL,
					target TEXT NOT NULL,
					mode TEXT NOT NULL,
					last_used_at INTEGER NOT NULL,
					PRIMARY KEY (root_folder, pattern, target, mode)
				);

				CREATE INDEX IF NOT EXISTS context_filter_history_recent
				ON context_filter_history (root_folder, last_used_at DESC);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 3,
			description: "create_project_tabs",
			sql: "
				CREATE TABLE IF NOT EXISTS project_tabs (
					id TEXT PRIMARY KEY NOT NULL,
					root_folder TEXT,
					position INTEGER NOT NULL
				);

				CREATE UNIQUE INDEX IF NOT EXISTS project_tabs_root_unique
					ON project_tabs (root_folder);

				INSERT OR IGNORE INTO project_tabs (id, root_folder, position)
				SELECT 'legacy-root', value, 0
				FROM app_settings
				WHERE key = 'root_folder';

				DELETE FROM app_settings WHERE key = 'root_folder';
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 4,
			description: "create_context_export_history",
			sql: "
				CREATE TABLE IF NOT EXISTS context_export_history (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					root_folder TEXT NOT NULL,
					content TEXT NOT NULL,
					file_count INTEGER NOT NULL,
					byte_count INTEGER NOT NULL,
					created_at INTEGER NOT NULL
				);

				CREATE INDEX IF NOT EXISTS context_export_history_recent
					ON context_export_history (root_folder, created_at DESC, id DESC);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 5,
			description: "persist_project_section_expansion",
			sql: "
				ALTER TABLE project_tabs
					ADD COLUMN folder_section_expanded INTEGER NOT NULL DEFAULT 1;
				ALTER TABLE project_tabs
					ADD COLUMN context_section_expanded INTEGER NOT NULL DEFAULT 1;
				ALTER TABLE project_tabs
					ADD COLUMN apply_section_expanded INTEGER NOT NULL DEFAULT 1;
			",
			kind: MigrationKind::Up,
		},
	];

	let builder = tauri::Builder::default()
		.manage(external_integration::PendingExternalActions::from_current_process())
		.manage(overlay::OverlayUndoState::new())
		.manage(diagnostics::DiagnosticTrustState::new())
		.manage(config_database::ConfigDatabaseState::new())
		.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
			external_integration::handle_second_instance(
				app,
				&args,
			)
		}))
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_clipboard_manager::init())
		.plugin(
			tauri_plugin_sql::Builder::default()
				.add_migrations(
					DATABASE_URL,
					migrations,
				)
				.build(),
		)
		.setup(|app| {
			if external_integration::is_forward_only_process() {
				app.handle().cleanup_before_exit();
				std::process::exit(external_integration::FORWARD_ONLY_NO_PRIMARY_EXIT_CODE);
			}

			if let Err(error) = overlay::recover_stale_snapshots() {
				eprintln!("{error}");
			}

			if let Err(error) = external_integration::register_system_integrations() {
				eprintln!("{error}");
			}

			if let Some(window) = app.get_webview_window("main") {
				if let Err(error) = native_drop::install(&window) {
					eprintln!("{error}");
				}

				let native_window = window.clone();
				window.on_window_event(move |event| {
					if matches!(
						event,
						WindowEvent::Focused(true) | WindowEvent::Resized(_)
					) {
						let _ = native_drop::refresh(&native_window);
					}
				});
			}

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			config_database::config_get_settings,
			config_database::config_get_project_tabs,
			config_database::config_get_active_project_tab_id,
			config_database::config_get_context_filter_history,
			config_database::config_get_context_history,
			config_database::config_get_context_history_content,
			config_database::config_set_setting,
			config_database::config_upsert_project_tab,
			config_database::config_delete_project_tab,
			config_database::config_save_project_tab_order,
			config_database::config_set_project_tab_section_expanded,
			config_database::config_save_context_filter_history_entry,
			config_database::config_delete_context_filter_history_entry,
			config_database::config_save_context_history_entry,
			config_database::config_delete_context_history_entry,
			external_integration::peek_external_actions,
			external_integration::next_external_action,
			external_integration::ack_external_action,
			external_integration::set_external_integration_state,
			project_ignore::project_ignore_exists,
			project_ignore::create_project_ignore,
			project_ignore::update_project_ignore,
			git_context::is_git_repository,
			git_context::generate_git_commit_context,
			diagnostics::get_project_diagnostic_capabilities,
			diagnostics::approve_project_diagnostics,
			diagnostics::generate_project_diagnostic_context,
			git_context::prepare_git_patch,
			git_context::apply_git_patch,
			folder_exists,
			find_project_for_root,
			find_project_for_paths,
			open_folder_in_explorer,
			close_folder_in_explorer,
			is_vscode_available,
			open_folder_in_vscode,
			install_vscode_extension,
			native_drop::cleanup_native_drop,
			process_drop,
			materialize_context_files,
			save_full_project_context_export_file,
			resolve_context_removal_paths,
			overlay::overlay_recovery_status,
			overlay::prepare_project_overlay,
			overlay::apply_project_overlay,
			overlay::project_overlay_undo_history,
			overlay::undo_project_overlay,
			overlay::discard_project_overlay_undo,
			destroy_main_window,
			save_context_history_export_file,
			save_export_file,
		]);

	builder
		.run(tauri::generate_context!())
		.expect("error while running Orqeto Dev");
}
