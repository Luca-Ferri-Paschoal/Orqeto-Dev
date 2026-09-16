use crate::overlay::{
	discard_external_undo_snapshot,
	file_fingerprint,
	finalize_external_undo_snapshot,
	prepare_external_undo_snapshot,
	protect_after_interrupted_mutation,
	record_external_undo_snapshot,
	rollback_external_undo_snapshot,
	FileFingerprint,
	OverlayUndoState,
};
use crate::{process_tree, project_ignore::ProjectIgnore, safe_fs};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	fs::{self, File, OpenOptions},
	io::{self, Read, Write},
	path::{Component, Path, PathBuf},
	process::{Command, Output, Stdio},
	sync::{
		atomic::{AtomicBool, AtomicUsize, Ordering},
		Arc,
	},
	thread,
	time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const WINDOWS_NO_WINDOW: u32 = 0x08000000;
const MAX_UNTRACKED_TEXT_BYTES: u64 = 256 * 1024;
const MAX_GIT_PATCH_BYTES: u64 = 32 * 1024 * 1024;
const MAX_GIT_PATCH_FILES: usize = 5_000;
const MAX_GIT_COMMAND_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_GIT_COMMAND_RUNTIME: Duration = Duration::from_secs(5 * 60);
const MAX_GIT_CONTEXT_FILES: usize = 50_000;
const MAX_GIT_CONTEXT_TOTAL_BYTES: usize = 128 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitUntrackedFile {
	relative_path: String,
	content: Option<String>,
	size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitContextData {
	repository_name: String,
	branch: String,
	status: String,
	staged_diff: String,
	unstaged_diff: String,
	untracked_files: Vec<GitCommitUntrackedFile>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum GitPatchChangeKind {
	Create,
	Modify,
	Delete,
	Rename,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPatchChange {
	relative_path: String,
	previous_path: Option<String>,
	kind: GitPatchChangeKind,
	added_lines: usize,
	deleted_lines: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPatchPreview {
	patch_name: String,
	patch_fingerprint: String,
	file_count: usize,
	added_lines: usize,
	deleted_lines: usize,
	changes: Vec<GitPatchChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyGitPatchResult {
	operation_id: String,
	applied_at_unix_ms: u64,
	added_files: usize,
	replaced_files: usize,
	deleted_files: usize,
	added_directories: usize,
	replaced_directories: usize,
	deleted_directories: usize,
	added_lines: usize,
	deleted_lines: usize,
}

struct PreparedGitPatch {
	project_root: PathBuf,
	repository_root: PathBuf,
	root_relative_to_repository: PathBuf,
	patch_bytes: Arc<[u8]>,
	patch_name: String,
	patch_fingerprint: String,
	added_lines: usize,
	deleted_lines: usize,
	changes: Vec<GitPatchChange>,
	affected_paths: Vec<String>,
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
	fs::canonicalize(path)
		.map_err(|error| format!("Could not access {}: {error}", path.display()))
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

fn git_candidates() -> Vec<PathBuf> {
	let mut candidates = Vec::new();

	#[cfg(target_os = "windows")]
	{
		for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
			if let Some(program_files) = std::env::var_os(variable) {
				candidates.push(PathBuf::from(program_files).join("Git").join("cmd").join("git.exe"));
			}
		}
		if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
			candidates.push(PathBuf::from(local_app_data).join("Programs").join("Git").join("cmd").join("git.exe"));
		}
		if let Some(candidate) = resolve_from_path("git.exe") {
			candidates.push(candidate);
		}
	}

	#[cfg(not(target_os = "windows"))]
	if let Some(candidate) = resolve_from_path("git") {
		candidates.push(candidate);
	}

	let mut seen = HashSet::new();
	candidates.retain(|candidate| candidate.is_file() && seen.insert(candidate.clone()));
	candidates
}

fn configure_git_command(
	executable: &Path,
	root: &Path,
) -> Command {
	let mut command = Command::new(executable);
	for (key, _) in std::env::vars_os() {
		if key.to_string_lossy().to_ascii_uppercase().starts_with("GIT_") {
			command.env_remove(key);
		}
	}
	command
		.arg("-c")
		.arg("core.quotepath=false")
		.arg("-c")
		.arg("color.ui=false")
		.arg("-c")
		.arg("status.relativePaths=true")
		.arg("-c")
		.arg("core.fsmonitor=false")
		.arg("-c")
		.arg("apply.ignoreWhitespace=false")
		.arg("-c")
		.arg("apply.whitespace=warn")
		.arg("-C")
		.arg(root)
		.env("GIT_PAGER", "cat")
		.env("GIT_TERMINAL_PROMPT", "0")
		.env("GIT_OPTIONAL_LOCKS", "0");

	#[cfg(target_os = "windows")]
	command.creation_flags(WINDOWS_NO_WINDOW);

	command
}

fn read_bounded<R: io::Read + Send + 'static>(
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
			if previous.saturating_add(read) > MAX_GIT_COMMAND_OUTPUT_BYTES {
				exceeded.store(true, Ordering::Release);
				continue;
			}

			output.extend_from_slice(&buffer[..read]);
		}
		Ok(output)
	})
}

enum GitCommandExecutionError {
	Spawn(String),
	Runtime(String),
}

impl GitCommandExecutionError {
	fn into_message(self) -> String {
		match self {
			Self::Spawn(message) | Self::Runtime(message) => message,
		}
	}
}

fn execute_command_bounded(
	mut command: Command,
	stdin_data: Option<Arc<[u8]>>,
) -> Result<Output, GitCommandExecutionError> {
	process_tree::configure_process_tree(&mut command);
	if stdin_data.is_some() {
		command.stdin(Stdio::piped());
	} else {
		command.stdin(Stdio::null());
	}
	command.stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = command
		.spawn()
		.map_err(|error| GitCommandExecutionError::Spawn(format!("Could not start Git: {error}")))?;
	let stdin_task = if let Some(data) = stdin_data {
		let Some(mut stdin) = child.stdin.take() else {
			process_tree::terminate_process_tree(&mut child);
			return Err(GitCommandExecutionError::Runtime("Git did not provide stdin for the immutable patch.".to_string()));
		};
		Some(thread::spawn(move || -> io::Result<()> {
			stdin.write_all(&data)?;
			stdin.flush()?;
			Ok(())
		}))
	} else {
		None
	};
	let Some(stdout) = child.stdout.take() else {
		process_tree::terminate_process_tree(&mut child);
		return Err(GitCommandExecutionError::Runtime("Git did not provide stdout.".to_string()));
	};
	let Some(stderr) = child.stderr.take() else {
		process_tree::terminate_process_tree(&mut child);
		return Err(GitCommandExecutionError::Runtime("Git did not provide stderr.".to_string()));
	};
	let exceeded = Arc::new(AtomicBool::new(false));
	let total_bytes = Arc::new(AtomicUsize::new(0));
	let stdout_task = read_bounded(
		stdout,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);
	let stderr_task = read_bounded(
		stderr,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);

	let mut wait_error = None;
	let mut timed_out = false;
	let started = Instant::now();
	let status = loop {
		if exceeded.load(Ordering::Acquire) {
			process_tree::terminate_process_tree(&mut child);
			break None;
		}
		if started.elapsed() > MAX_GIT_COMMAND_RUNTIME {
			timed_out = true;
			process_tree::terminate_process_tree(&mut child);
			break None;
		}
		match child.try_wait() {
			Ok(Some(status)) => break Some(status),
			Ok(None) => thread::sleep(Duration::from_millis(5)),
			Err(error) => {
				wait_error = Some(error);
				process_tree::terminate_process_tree(&mut child);
				break None;
			}
		}
	};
	let stdin_result: Option<io::Result<()>> = stdin_task.map(|task| match task.join() {
		Ok(result) => result,
		Err(_) => Err(io::Error::other(
			"writing the patch to Git was interrupted",
		)),
	});
	let stdout = stdout_task
		.join()
		.map_err(|_| GitCommandExecutionError::Runtime("Reading Git output was interrupted.".to_string()))?
		.map_err(|error| GitCommandExecutionError::Runtime(format!("Could not read Git output: {error}")))?;
	let stderr = stderr_task
		.join()
		.map_err(|_| GitCommandExecutionError::Runtime("Reading Git stderr was interrupted.".to_string()))?
		.map_err(|error| GitCommandExecutionError::Runtime(format!("Could not read Git stderr: {error}")))?;

	let Some(status) = status else {
		if timed_out {
			return Err(GitCommandExecutionError::Runtime(
				"Git exceeded the 5-minute limit and was stopped.".to_string(),
			));
		}
		if let Some(error) = wait_error {
			return Err(GitCommandExecutionError::Runtime(format!("Could not wait for Git: {error}")));
		}
		return Err(GitCommandExecutionError::Runtime(format!(
			"Combined Git output exceeded the {} MiB limit and the operation was stopped.",
			MAX_GIT_COMMAND_OUTPUT_BYTES / (1024 * 1024),
		)));
	};

	if status.success() {
		if let Some(Err(error)) = stdin_result {
			return Err(GitCommandExecutionError::Runtime(format!(
				"Could not provide Git with the complete immutable patch bytes: {error}",
			)));
		}
	}

	Ok(Output { status, stdout, stderr })
}

fn execute_git(
	root: &Path,
	args: &[&str],
) -> Result<Output, String> {
	let mut last_error: Option<String> = None;

	for executable in git_candidates() {
		let mut command = configure_git_command(
			&executable,
			root,
		);
		command.args(args);

		match execute_command_bounded(command, None) {
			Ok(output) => return Ok(output),
			Err(GitCommandExecutionError::Spawn(error)) => {
				last_error = Some(format!(
					"Could not execute {}: {error}",
					executable.display(),
				));
			}
			Err(error @ GitCommandExecutionError::Runtime(_)) => {
				return Err(format!(
					"Execution of {} failed after the process started: {}",
					executable.display(),
					error.into_message(),
				));
			}
		}
	}

	Err(last_error.unwrap_or_else(|| {
		"Could not locate Git on this computer.".to_string()
	}))
}

struct GitApplySandbox {
	root: PathBuf,
	git_dir: PathBuf,
	global_config: PathBuf,
	xdg_config_home: PathBuf,
}

impl Drop for GitApplySandbox {
	fn drop(&mut self) {
		let _ = fs::remove_dir_all(&self.root);
	}
}

fn create_git_apply_sandbox() -> Result<GitApplySandbox, String> {
	let base = std::env::temp_dir().join("orqeto-dev").join("git-apply-sandboxes");
	safe_fs::create_dir_all_durable(&base)
		.map_err(|error| format!("Could not prepare the private Git environment: {error}"))?;
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(|error| format!("Could not identify the private Git environment: {error}"))?
		.as_nanos();

	for attempt in 0_u32..128 {
		let root = base.join(format!(
			"git-apply-{}-{timestamp}-{attempt}",
			std::process::id(),
		));
		match fs::create_dir(&root) {
			Ok(()) => {
				let git_dir = root.join("git-dir");
				let xdg_config_home = root.join("xdg");
				fs::create_dir(&git_dir).map_err(|error| {
					let _ = fs::remove_dir_all(&root);
					format!("Could not create the private Git dir: {error}")
				})?;
				fs::create_dir(&xdg_config_home).map_err(|error| {
					let _ = fs::remove_dir_all(&root);
					format!("Could not create the private Git configuration: {error}")
				})?;
				let global_config = root.join("global.gitconfig");
				OpenOptions::new()
					.write(true)
					.create_new(true)
					.open(&global_config)
					.map_err(|error| {
						let _ = fs::remove_dir_all(&root);
						format!("Could not create the private global Git configuration: {error}")
					})?;

				return Ok(GitApplySandbox {
					root,
					git_dir,
					global_config,
					xdg_config_home,
				});
			}
			Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
			Err(error) => {
				return Err(format!(
					"Could not reserve the private Git environment: {error}",
				));
			}
		}
	}

	Err("Could not reserve a private environment for Git.".to_string())
}

fn configure_git_apply_sandbox(
	command: &mut Command,
	sandbox: &GitApplySandbox,
	repository_root: &Path,
) {
	command
		.env("GIT_DIR", &sandbox.git_dir)
		.env("GIT_WORK_TREE", repository_root)
		.env("GIT_CONFIG_NOSYSTEM", "1")
		.env("GIT_CONFIG_GLOBAL", &sandbox.global_config)
		.env("GIT_ATTR_NOSYSTEM", "1")
		.env("XDG_CONFIG_HOME", &sandbox.xdg_config_home);
}

fn execute_git_apply(
	repository_root: &Path,
	root_relative_to_repository: &Path,
	options: &[&str],
	patch_bytes: Arc<[u8]>,
) -> Result<Output, String> {
	let sandbox = create_git_apply_sandbox()?;
	let mut last_error: Option<String> = None;

	for executable in git_candidates() {
		let mut command = configure_git_command(
			&executable,
			repository_root,
		);
		configure_git_apply_sandbox(
			&mut command,
			&sandbox,
			repository_root,
		);
		command.arg("apply");
		command.arg("--whitespace=warn");
		command.args(options);

		if !root_relative_to_repository.as_os_str().is_empty() {
			command.arg(format!(
				"--directory={}",
				root_relative_to_repository.to_string_lossy().replace('\\', "/"),
			));
		}

		match execute_command_bounded(command, Some(Arc::clone(&patch_bytes))) {
			Ok(output) => return Ok(output),
			Err(GitCommandExecutionError::Spawn(error)) => {
				last_error = Some(format!(
					"Could not execute {}: {error}",
					executable.display(),
				));
			}
			Err(error @ GitCommandExecutionError::Runtime(_)) => {
				return Err(format!(
					"Execution of {} failed after the process started: {}",
					executable.display(),
					error.into_message(),
				));
			}
		}
	}

	Err(last_error.unwrap_or_else(|| {
		"Could not locate Git on this computer.".to_string()
	}))
}

fn output_text(output: &[u8]) -> String {
	String::from_utf8_lossy(output)
		.trim_end_matches(|character| character == '\r' || character == '\n')
		.to_string()
}

fn git_failure(output: &Output) -> String {
	let stderr = output_text(&output.stderr);
	let stdout = output_text(&output.stdout);
	let details = if stderr.is_empty() {
		stdout
	} else {
		stderr
	};

	if details.is_empty() {
		"Git could not complete the requested operation.".to_string()
	} else {
		details
	}
}

fn run_git(
	root: &Path,
	args: &[&str],
) -> Result<String, String> {
	let output = execute_git(
		root,
		args,
	)?;

	if output.status.success() {
		return Ok(output_text(&output.stdout));
	}

	Err(git_failure(&output))
}

fn is_git_repository_blocking(root_folder: &str) -> Result<bool, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Ok(false);
	}

	let output = execute_git(
		&root,
		&[
			"rev-parse",
			"--is-inside-work-tree",
		],
	)?;

	Ok(output.status.success() && output_text(&output.stdout) == "true")
}

fn decode_utf16(
	bytes: &[u8],
	little_endian: bool,
) -> Option<String> {
	if bytes.len() % 2 != 0 {
		return None;
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

	String::from_utf16(&code_units).ok()
}

fn decode_text(bytes: Vec<u8>) -> Option<String> {
	let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
		String::from_utf8(bytes[3..].to_vec()).ok()?
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
		String::from_utf8(bytes).ok()?
	};

	if content.contains('\0') {
		return None;
	}

	Some(content)
}

fn add_git_context_bytes(
	total_bytes: &mut usize,
	amount: usize,
) -> Result<(), String> {
	*total_bytes = total_bytes
		.checked_add(amount)
		.ok_or_else(|| "The commit context size is invalid.".to_string())?;
	if *total_bytes > MAX_GIT_CONTEXT_TOTAL_BYTES {
		return Err(format!(
			"The commit context exceeds the aggregate {} MiB limit.",
			MAX_GIT_CONTEXT_TOTAL_BYTES / (1024 * 1024),
		));
	}
	Ok(())
}

fn read_untracked_files(
	root: &Path,
	paths_output: &[u8],
	total_context_bytes: &mut usize,
) -> Result<Vec<GitCommitUntrackedFile>, String> {
	let mut files = Vec::new();

	for path_bytes in paths_output.split(|byte| *byte == 0) {
		if path_bytes.is_empty() {
			continue;
		}
		if files.len() >= MAX_GIT_CONTEXT_FILES {
			return Err(format!(
				"The commit context exceeds the limit of {MAX_GIT_CONTEXT_FILES} untracked files.",
			));
		}

		let relative_path = String::from_utf8_lossy(path_bytes).to_string();
		add_git_context_bytes(total_context_bytes, relative_path.len())?;
		let candidate = root.join(&relative_path);
		let metadata = match fs::symlink_metadata(&candidate) {
			Ok(metadata) => metadata,
			Err(_) => continue,
		};

		if !metadata.is_file() || safe_fs::metadata_is_link_or_reparse(&metadata) {
			files.push(GitCommitUntrackedFile {
				relative_path,
				content: None,
				size_bytes: metadata.len(),
			});
			continue;
		}

		let canonical_candidate = match fs::canonicalize(&candidate) {
			Ok(path) if path.starts_with(root) => path,
			_ => continue,
		};
		let size_bytes = metadata.len();
		let content = if size_bytes <= MAX_UNTRACKED_TEXT_BYTES {
			fs::read(canonical_candidate)
				.ok()
				.and_then(decode_text)
		} else {
			None
		};
		if let Some(content) = content.as_ref() {
			add_git_context_bytes(total_context_bytes, content.len())?;
		}

		files.push(GitCommitUntrackedFile {
			relative_path,
			content,
			size_bytes,
		});
	}

	Ok(files)
}

fn repository_name(root: &Path) -> String {
	root.file_name()
		.and_then(|name| name.to_str())
		.filter(|name| !name.is_empty())
		.unwrap_or("repository")
		.to_string()
}

fn current_branch(root: &Path) -> Result<String, String> {
	let symbolic = execute_git(
		root,
		&[
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		],
	)?;

	if symbolic.status.success() {
		let branch = output_text(&symbolic.stdout);

		if !branch.is_empty() {
			return Ok(branch);
		}
	}

	let detached = execute_git(
		root,
		&[
			"rev-parse",
			"--short",
			"HEAD",
		],
	)?;

	if detached.status.success() {
		let commit = output_text(&detached.stdout);

		if !commit.is_empty() {
			return Ok(format!("detached@{commit}"));
		}
	}

	Ok("HEAD".to_string())
}

fn generate_git_commit_context_blocking(
	root_folder: String,
) -> Result<GitCommitContextData, String> {
	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	if !is_git_repository_blocking(&root_folder)? {
		return Err("The selected folder does not belong to a Git repository.".to_string());
	}

	let status = run_git(
		&root,
		&[
			"status",
			"--short",
			"--untracked-files=all",
			"--",
			".",
		],
	)?;
	if status.lines().count() > MAX_GIT_CONTEXT_FILES {
		return Err(format!(
			"The commit context exceeds the limit of {MAX_GIT_CONTEXT_FILES} changed files.",
		));
	}
	let staged_diff = run_git(
		&root,
		&[
			"diff",
			"--cached",
			"--relative",
			"--no-ext-diff",
			"--no-textconv",
			"--find-renames",
			"--find-copies",
			"--submodule=short",
			"--",
			".",
		],
	)?;
	let unstaged_diff = run_git(
		&root,
		&[
			"diff",
			"--relative",
			"--no-ext-diff",
			"--no-textconv",
			"--find-renames",
			"--find-copies",
			"--submodule=short",
			"--",
			".",
		],
	)?;
	let untracked_output = execute_git(
		&root,
		&[
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			".",
		],
	)?;

	if !untracked_output.status.success() {
		let error = output_text(&untracked_output.stderr);
		return Err(if error.is_empty() {
			"Could not list untracked Git files.".to_string()
		} else {
			error
		});
	}

	let branch = current_branch(&root)?;
	let repository_name = repository_name(&root);
	let mut total_context_bytes = 0_usize;
	for value in [
		&repository_name,
		&branch,
		&status,
		&staged_diff,
		&unstaged_diff,
	] {
		add_git_context_bytes(&mut total_context_bytes, value.len())?;
	}
	let untracked_files = read_untracked_files(
		&root,
		&untracked_output.stdout,
		&mut total_context_bytes,
	)?;

	Ok(GitCommitContextData {
		repository_name,
		branch,
		status,
		staged_diff,
		unstaged_diff,
		untracked_files,
	})
}

fn validate_patch_extension(path: &Path) -> Result<(), String> {
	let supported = path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| {
			extension.eq_ignore_ascii_case("patch") ||
				extension.eq_ignore_ascii_case("diff")
		});

	if supported {
		Ok(())
	} else {
		Err("In Git Mode, only .patch and .diff files can be applied.".to_string())
	}
}

fn validate_text_patch(content: &str) -> Result<(), String> {
	if content.trim().is_empty() {
		return Err("The patch file is empty.".to_string());
	}

	for line in content.lines() {
		if line == "GIT binary patch" || line.starts_with("Binary files ") {
			return Err("Binary patches are not accepted in Git Mode.".to_string());
		}

		if line.starts_with("old mode ") || line.starts_with("new mode ") {
			return Err("File permission/mode changes are not accepted in Git Mode.".to_string());
		}

		if line.starts_with("copy from ") || line.starts_with("copy to ") {
			return Err("Git copy operations are not accepted in Git Mode. Create the new file directly in the patch.".to_string());
		}

		if let Some(mode) = line.strip_prefix("new file mode ") {
			if mode != "100644" {
				return Err("New files with special permission/mode are not accepted in Git Mode.".to_string());
			}
		}

		if [
			"deleted file mode 120000",
			"new file mode 160000",
			"deleted file mode 160000",
		]
		.iter()
		.any(|prefix| line.starts_with(prefix)) ||
			(line.starts_with("index ") &&
				(line.ends_with(" 120000") || line.ends_with(" 160000")))
		{
			return Err("Symlink or submodule patches are not accepted in Git Mode.".to_string());
		}
	}

	Ok(())
}


struct PatchMetadata {
	rename_sources: HashMap<String, String>,
	deleted_paths: HashSet<String>,
}

fn path_key(path: &str) -> String {
	#[cfg(target_os = "windows")]
	{
		path.to_lowercase()
	}

	#[cfg(not(target_os = "windows"))]
	{
		path.to_string()
	}
}

fn normalize_declared_patch_path(
	value: &str,
	strip_git_prefix: bool,
) -> Result<String, String> {
	let path_value = value
		.split_once('\t')
		.map(|(path, _)| path)
		.unwrap_or(value);

	if path_value.is_empty() || path_value.starts_with('"') || path_value.contains('\\') {
		return Err("The patch uses a path format that is not accepted by safe Git Mode.".to_string());
	}

	let normalized = if strip_git_prefix && (path_value.starts_with("a/") || path_value.starts_with("b/")) {
		&path_value[2..]
	} else {
		path_value
	};
	let path = Path::new(normalized);

	if path.as_os_str().is_empty() {
		return Err("The patch contains an empty file path.".to_string());
	}

	for component in path.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("The patch contains an unsafe path: {normalized}."));
		}
	}

	Ok(path.to_string_lossy().replace('\\', "/"))
}

fn parse_patch_metadata(content: &str) -> Result<PatchMetadata, String> {
	let mut rename_sources = HashMap::new();
	let mut deleted_paths = HashSet::new();
	let mut pending_rename_from: Option<String> = None;
	let mut previous_header: Option<String> = None;
	let mut in_file_header = false;
	let mut saw_git_header = false;

	for line in content.lines() {
		if line.starts_with("diff --git ") {
			if pending_rename_from.is_some() {
				return Err("The patch contains an incomplete rename.".to_string());
			}

			in_file_header = true;
			saw_git_header = true;
			previous_header = None;
			continue;
		}

		if !in_file_header {
			continue;
		}

		if line.starts_with("@@") {
			in_file_header = false;
			previous_header = None;
			continue;
		}

		if let Some(value) = line.strip_prefix("rename from ") {
			pending_rename_from = Some(normalize_declared_patch_path(
				value,
				false,
			)?);
			continue;
		}

		if let Some(value) = line.strip_prefix("rename to ") {
			let source = pending_rename_from
				.take()
				.ok_or_else(|| "The patch contains an incomplete rename.".to_string())?;
			let destination = normalize_declared_patch_path(
				value,
				false,
			)?;

			rename_sources.insert(
				path_key(&destination),
				source,
			);
			continue;
		}

		if let Some(value) = line.strip_prefix("--- ") {
			previous_header = if value == "/dev/null" {
				None
			} else {
				Some(normalize_declared_patch_path(
					value,
					true,
				)?)
			};
			continue;
		}

		if let Some(value) = line.strip_prefix("+++ ") {
			if value == "/dev/null" {
				let deleted = previous_header
					.take()
					.ok_or_else(|| "The patch contains a deletion without a valid source path.".to_string())?;

				deleted_paths.insert(path_key(&deleted));
			} else {
				let _ = normalize_declared_patch_path(
					value,
					true,
				)?;
				previous_header = None;
			}
		}
	}

	if !saw_git_header {
		return Err("Git Mode requires a Git unified diff patch with diff --git headers.".to_string());
	}

	if pending_rename_from.is_some() {
		return Err("The patch contains an incomplete rename.".to_string());
	}

	Ok(PatchMetadata {
		rename_sources,
		deleted_paths,
	})
}

fn repository_layout(root: &Path) -> Result<(PathBuf, PathBuf), String> {
	let top_level = run_git(
		root,
		&[
			"rev-parse",
			"--show-toplevel",
		],
	)?;
	let repository_root = canonicalize_existing(Path::new(&top_level))?;
	let relative = root
		.strip_prefix(&repository_root)
		.map_err(|_| "The selected folder is not inside the root reported by Git.".to_string())?
		.to_path_buf();

	Ok((
		repository_root,
		relative,
	))
}

fn patch_fingerprint(patch_bytes: &[u8]) -> String {
	const HEX: &[u8; 16] = b"0123456789abcdef";
	let digest = Sha256::digest(patch_bytes);
	let mut output = String::with_capacity(digest.len() * 2);
	for byte in digest {
		output.push(HEX[(byte >> 4) as usize] as char);
		output.push(HEX[(byte & 0x0f) as usize] as char);
	}
	output
}

fn validate_patch_targets(
	root: &Path,
	affected_paths: &[String],
) -> Result<(), String> {
	let project_ignore = ProjectIgnore::load(root)?;

	for relative_path in affected_paths {
		let relative = Path::new(relative_path);
		safe_fs::validate_project_relative_path(root, relative)?;
		let candidate = root.join(relative);

		if project_ignore.is_ignored(
			&candidate,
			false,
		) {
			return Err(format!(
				"The patch attempts to modify an item ignored by .orqeto-devignore: {relative_path}.",
			));
		}

		match fs::symlink_metadata(&candidate) {
			Ok(metadata) if safe_fs::metadata_is_link_or_reparse(&metadata) => {
				return Err(format!(
					"The patch attempts to modify an unsupported symbolic link/junction: {relative_path}.",
				));
			}
			Ok(metadata) if !metadata.is_file() => {
				return Err(format!(
					"The patch attempts to use a destination that is not a regular file: {relative_path}.",
				));
			}
			Ok(_) => {}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {}
			Err(error) => {
				return Err(format!(
					"Could not validate {relative_path}: {error}",
				));
			}
		}
	}

	Ok(())
}

fn parse_count(value: &[u8]) -> Result<usize, String> {
	if value == b"-" {
		return Err("Binary patches are not accepted in Git Mode.".to_string());
	}

	let text = std::str::from_utf8(value)
		.map_err(|_| "Git returned an invalid patch statistic.".to_string())?;

	text.parse::<usize>()
		.map_err(|_| "Git returned an invalid patch statistic.".to_string())
}

fn normalize_git_patch_path(
	repository_path: &[u8],
	root_relative_to_repository: &Path,
) -> Result<String, String> {
	let text = std::str::from_utf8(repository_path)
		.map_err(|_| "The patch contains a file name that is not UTF-8.".to_string())?;
	let path = PathBuf::from(text);
	let relative = if root_relative_to_repository.as_os_str().is_empty() {
		path.as_path()
	} else {
		path.strip_prefix(root_relative_to_repository)
			.map_err(|_| "The patch attempts to modify a file outside the folder selected in Orqeto Dev.".to_string())?
	};

	if relative.as_os_str().is_empty() {
		return Err("The patch contains an empty file path.".to_string());
	}

	for component in relative.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("The patch contains an unsafe path: {}.", relative.display()));
		}
	}

	Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn parse_numstat(
	output: &[u8],
	root: &Path,
	root_relative_to_repository: &Path,
	metadata: &PatchMetadata,
) -> Result<(Vec<GitPatchChange>, Vec<String>, usize, usize), String> {
	let fields = output.split(|byte| *byte == 0).collect::<Vec<_>>();
	let mut index = 0_usize;
	let mut changes = Vec::new();
	let mut affected_paths = Vec::new();
	let mut affected_seen = HashSet::new();
	let mut added_lines = 0_usize;
	let mut deleted_lines = 0_usize;

	while index < fields.len() {
		let field = fields[index];
		index += 1;

		if field.is_empty() {
			continue;
		}

		let mut parts = field.splitn(3, |byte| *byte == b'\t');
		let added = parse_count(parts.next().unwrap_or_default())?;
		let deleted = parse_count(parts.next().unwrap_or_default())?;
		let path_field = parts
			.next()
			.ok_or_else(|| "O Git retornou um formato de patch inesperado.".to_string())?;

		added_lines = added_lines
			.checked_add(added)
			.ok_or_else(|| "The patch contains too many lines to count.".to_string())?;
		deleted_lines = deleted_lines
			.checked_add(deleted)
			.ok_or_else(|| "The patch contains too many lines to count.".to_string())?;

		let (reported_previous_path, relative_path) = if path_field.is_empty() {
			let previous_field = fields
				.get(index)
				.ok_or_else(|| "O Git retornou um rename incompleto no patch.".to_string())?;
			let next_field = fields
				.get(index + 1)
				.ok_or_else(|| "O Git retornou um rename incompleto no patch.".to_string())?;
			index += 2;

			(
				Some(normalize_git_patch_path(
					previous_field,
					root_relative_to_repository,
				)?),
				normalize_git_patch_path(
					next_field,
					root_relative_to_repository,
				)?,
			)
		} else {
			(
				None,
				normalize_git_patch_path(
					path_field,
					root_relative_to_repository,
				)?,
			)
		};
		let metadata_previous_path = metadata
			.rename_sources
			.get(&path_key(&relative_path))
			.cloned();
		let previous_path = reported_previous_path.or(metadata_previous_path);
		let kind = if previous_path.is_some() {
			GitPatchChangeKind::Rename
		} else if metadata.deleted_paths.contains(&path_key(&relative_path)) {
			GitPatchChangeKind::Delete
		} else if fs::symlink_metadata(root.join(&relative_path)).is_ok() {
			GitPatchChangeKind::Modify
		} else {
			GitPatchChangeKind::Create
		};

		for path in previous_path
			.iter()
			.chain(std::iter::once(&relative_path))
		{
			if affected_seen.insert(path_key(path)) {
				affected_paths.push(path.clone());
			}
		}

		changes.push(GitPatchChange {
			relative_path,
			previous_path,
			kind,
			added_lines: added,
			deleted_lines: deleted,
		});

		if changes.len() > MAX_GIT_PATCH_FILES {
			return Err(format!(
				"The patch exceeds the limit of {MAX_GIT_PATCH_FILES} files per application.",
			));
		}
	}

	if changes.is_empty() {
		return Err("The patch contains no applicable text changes.".to_string());
	}

	Ok((
		changes,
		affected_paths,
		added_lines,
		deleted_lines,
	))
}

fn prepare_git_patch_blocking(
	root_folder: &str,
	patch_path: &str,
) -> Result<PreparedGitPatch, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	if !is_git_repository_blocking(root_folder)? {
		return Err("Git Mode requires the selected folder to belong to a Git repository.".to_string());
	}

	let patch_path = canonicalize_existing(Path::new(patch_path))?;
	validate_patch_extension(&patch_path)?;
	let patch_file = File::open(&patch_path)
		.map_err(|error| format!("Could not open the patch: {error}"))?;
	let metadata = patch_file
		.metadata()
		.map_err(|error| format!("Could not inspect the patch: {error}"))?;

	if !metadata.is_file() {
		return Err("In Git Mode, drop a single .patch or .diff file.".to_string());
	}

	if metadata.len() > MAX_GIT_PATCH_BYTES {
		return Err(format!(
			"The patch exceeds the {} MiB limit.",
			MAX_GIT_PATCH_BYTES / (1024 * 1024),
		));
	}

	let mut patch_bytes = Vec::with_capacity(metadata.len() as usize);
	patch_file
		.take(MAX_GIT_PATCH_BYTES + 1)
		.read_to_end(&mut patch_bytes)
		.map_err(|error| format!("Could not read the patch: {error}"))?;
	if patch_bytes.len() as u64 > MAX_GIT_PATCH_BYTES {
		return Err(format!(
			"The patch exceeds the {} MiB limit.",
			MAX_GIT_PATCH_BYTES / (1024 * 1024),
		));
	}
	let patch_bytes: Arc<[u8]> = Arc::from(patch_bytes);
	let patch_text = std::str::from_utf8(&patch_bytes)
		.map_err(|_| "Git Mode accepts only textual UTF-8 patches.".to_string())?;

	if patch_text.contains('\0') {
		return Err("Git Mode accepts only textual patches.".to_string());
	}

	validate_text_patch(patch_text)?;
	let patch_metadata = parse_patch_metadata(patch_text)?;
	let patch_name = patch_path
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("changes.patch")
		.to_string();
	let (repository_root, root_relative_to_repository) = repository_layout(&root)?;
	let patch_fingerprint = patch_fingerprint(&patch_bytes);
	let numstat = execute_git_apply(
		&repository_root,
		&root_relative_to_repository,
		&[
			"--numstat",
			"-z",
		],
		Arc::clone(&patch_bytes),
	)?;

	if !numstat.status.success() {
		return Err(git_failure(&numstat));
	}

	let (
		changes,
		affected_paths,
		added_lines,
		deleted_lines,
	) = parse_numstat(
		&numstat.stdout,
		&root,
		&root_relative_to_repository,
		&patch_metadata,
	)?;
	validate_patch_targets(
		&root,
		&affected_paths,
	)?;
	let check = execute_git_apply(
		&repository_root,
		&root_relative_to_repository,
		&["--check"],
		Arc::clone(&patch_bytes),
	)?;

	if !check.status.success() {
		return Err(format!(
			"The patch cannot be applied safely: {}",
			git_failure(&check),
		));
	}

	Ok(PreparedGitPatch {
		project_root: root,
		repository_root,
		root_relative_to_repository,
		patch_bytes,
		patch_name,
		patch_fingerprint,
		added_lines,
		deleted_lines,
		changes,
		affected_paths,
	})
}

struct GitSimulationDirectory(PathBuf);

impl Drop for GitSimulationDirectory {
	fn drop(&mut self) {
		let _ = fs::remove_dir_all(&self.0);
	}
}

fn create_git_simulation_directory() -> Result<GitSimulationDirectory, String> {
	let base = std::env::temp_dir().join("orqeto-dev").join("git-simulations");
	safe_fs::create_dir_all_durable(&base)
		.map_err(|error| format!("Could not prepare the private Git patch simulation: {error}"))?;
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(|error| format!("Could not identify the Git patch simulation: {error}"))?
		.as_nanos();

	for attempt in 0_u32..128 {
		let directory = base.join(format!(
			"git-sim-{}-{timestamp}-{attempt}",
			std::process::id(),
		));
		match fs::create_dir(&directory) {
			Ok(()) => return Ok(GitSimulationDirectory(directory)),
			Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
			Err(error) => {
				return Err(format!(
					"Could not create the private Git patch simulation: {error}",
				));
			}
		}
	}

	Err("Could not reserve a private folder for Git patch simulation.".to_string())
}

fn copy_git_attributes_for_simulation(
	prepared: &PreparedGitPatch,
	simulation_repository: &Path,
) -> Result<(), String> {
	let mut attribute_paths = HashSet::new();
	for relative_path in &prepared.affected_paths {
		let repository_relative = prepared
			.root_relative_to_repository
			.join(relative_path);
		let mut current = repository_relative.parent();
		while let Some(directory) = current {
			attribute_paths.insert(directory.join(".gitattributes"));
			if directory.as_os_str().is_empty() {
				break;
			}
			current = directory.parent();
		}
	}

	let mut attribute_paths = attribute_paths.into_iter().collect::<Vec<_>>();
	attribute_paths.sort();
	for relative in attribute_paths {
		safe_fs::validate_project_relative_path(
			&prepared.repository_root,
			&relative,
		)?;
		let source = prepared.repository_root.join(&relative);
		let metadata = match fs::symlink_metadata(&source) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
			Err(error) => {
				return Err(format!(
					"Could not inspect {} for the Git simulation: {error}",
					source.display(),
				));
			}
		};
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!(
				"{} is not a safe regular .gitattributes file.",
				source.display(),
			));
		}

		let before = file_fingerprint(&source)?;
		let destination = simulation_repository.join(&relative);
		let parent = destination.parent().ok_or_else(|| {
			"The private .gitattributes copy produced a destination without a parent folder.".to_string()
		})?;
		safe_fs::create_dir_all_durable(parent)
			.map_err(|error| format!("Could not prepare {}: {error}", destination.display()))?;
		fs::copy(&source, &destination)
			.map_err(|error| format!("Could not copy {}: {error}", source.display()))?;
		let copied = file_fingerprint(&destination)?;
		let after = file_fingerprint(&source)?;
		if before != after || before != copied {
			return Err(format!(
				"{} changed during private Git patch preparation.",
				source.display(),
			));
		}
	}

	Ok(())
}

fn simulate_git_patch_after_states(
	prepared: &PreparedGitPatch,
) -> Result<HashMap<String, Option<FileFingerprint>>, String> {
	let simulation = create_git_simulation_directory()?;
	let simulation_repository = simulation.0.join("repository");
	let simulation_project = simulation_repository.join(&prepared.root_relative_to_repository);
	safe_fs::create_dir_all_durable(&simulation_project)
		.map_err(|error| format!("Could not prepare the private Git patch tree: {error}"))?;
	copy_git_attributes_for_simulation(
		prepared,
		&simulation_repository,
	)?;

	for relative_path in &prepared.affected_paths {
		let relative = Path::new(relative_path);
		let source = prepared.project_root.join(relative);
		let destination = simulation_project.join(relative);

		match fs::symlink_metadata(&source) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					return Err(format!(
						"Could not simulate {relative_path}: the current state is not a safe regular file.",
					));
				}
				let before = file_fingerprint(&source)?;
				let parent = destination
					.parent()
					.ok_or_else(|| "The Git patch simulation produced a destination without a parent folder.".to_string())?;
				safe_fs::create_dir_all_durable(parent)
					.map_err(|error| format!("Could not prepare the simulation for {relative_path}: {error}"))?;
				fs::copy(&source, &destination)
					.map_err(|error| format!("Could not copy {relative_path} into the simulation: {error}"))?;
				let copied = file_fingerprint(&destination)?;
				let after = file_fingerprint(&source)?;
				if before != after || before != copied {
					return Err(format!(
						"{relative_path} changed during Git patch simulation. The application was cancelled to preserve concurrent work.",
					));
				}
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {}
			Err(error) => {
				return Err(format!(
					"Could not prepare {relative_path} for Git patch simulation: {error}",
				));
			}
		}
	}

	let simulation_apply = execute_git_apply(
		&simulation_repository,
		&prepared.root_relative_to_repository,
		&[],
		Arc::clone(&prepared.patch_bytes),
	)?;
	if !simulation_apply.status.success() {
		return Err(format!(
			"The private simulation rejected the Git patch: {}",
			git_failure(&simulation_apply),
		));
	}

	let mut expected = HashMap::with_capacity(prepared.affected_paths.len());
	for relative_path in &prepared.affected_paths {
		let destination = simulation_project.join(relative_path);
		let fingerprint = match fs::symlink_metadata(&destination) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					return Err(format!(
						"The Git patch simulation produced an unsupported destination at {relative_path}.",
					));
				}
				Some(file_fingerprint(&destination)?)
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => None,
			Err(error) => {
				return Err(format!(
					"Could not verify {relative_path} in the Git patch simulation: {error}",
				));
			}
		};
		expected.insert(path_key(relative_path), fingerprint);
	}

	Ok(expected)
}

fn apply_prepared_git_patch(prepared: &PreparedGitPatch) -> Result<(), String> {
	let output = execute_git_apply(
		&prepared.repository_root,
		&prepared.root_relative_to_repository,
		&[],
		Arc::clone(&prepared.patch_bytes),
	)?;

	if output.status.success() {
		Ok(())
	} else {
		Err(git_failure(&output))
	}
}

#[tauri::command]
pub async fn is_git_repository(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<bool, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || is_git_repository_blocking(&root_folder))
		.await
		.map_err(|error| format!("Git repository verification was interrupted: {error}"))?
}

#[tauri::command]
pub async fn generate_git_commit_context(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<GitCommitContextData, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || generate_git_commit_context_blocking(root_folder))
		.await
		.map_err(|error| format!("Commit context generation was interrupted: {error}"))?
}

#[tauri::command]
pub async fn prepare_git_patch(
	root_folder: String,
	patch_path: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<GitPatchPreview, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let prepared = tauri::async_runtime::spawn_blocking(move || {
		prepare_git_patch_blocking(
			&root_folder,
			&patch_path,
		)
	})
	.await
	.map_err(|error| format!("Git patch validation was interrupted: {error}"))??;

	Ok(GitPatchPreview {
		patch_name: prepared.patch_name,
		patch_fingerprint: prepared.patch_fingerprint,
		file_count: prepared.changes.len(),
		added_lines: prepared.added_lines,
		deleted_lines: prepared.deleted_lines,
		changes: prepared.changes,
	})
}

#[tauri::command]
pub async fn apply_git_patch(
	root_folder: String,
	patch_path: String,
	expected_patch_fingerprint: String,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ApplyGitPatchResult, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let blocking_task = tauri::async_runtime::spawn_blocking(move || {
		let prepared = prepare_git_patch_blocking(&root_folder, &patch_path)?;
		if prepared.patch_fingerprint != expected_patch_fingerprint {
			return Err("The .patch/.diff file changed after the preview. Drop it again to validate the current version.".to_string());
		}

		let expected_after_states = simulate_git_patch_after_states(&prepared)?;
		let snapshot = prepare_external_undo_snapshot(
			&root_folder,
			&prepared.affected_paths,
			&expected_after_states,
			prepared.patch_name.clone(),
			prepared.added_lines,
			prepared.deleted_lines,
		)?;

		// Re-run the strict check after the durable snapshot/journal. The same
		// immutable Arc-backed bytes used for preview, simulation and statistics
		// are fed to Git over stdin again immediately before mutation.
		let check = match execute_git_apply(
			&prepared.repository_root,
			&prepared.root_relative_to_repository,
			&["--check"],
			Arc::clone(&prepared.patch_bytes),
		) {
			Ok(check) => check,
			Err(error) => {
				discard_external_undo_snapshot(snapshot);
				return Err(error);
			}
		};
		if !check.status.success() {
			discard_external_undo_snapshot(snapshot);
			return Err(format!(
				"The patch stopped being applicable during preparation: {}",
				git_failure(&check),
			));
		}

		if let Err(error) = apply_prepared_git_patch(&prepared) {
			return match rollback_external_undo_snapshot(&snapshot) {
				Ok(()) => {
					discard_external_undo_snapshot(snapshot);
					Err(format!("Git rejected patch application: {error}"))
				}
				Err(rollback_error) => Err(format!(
					"Git rejected patch application: {error}. {rollback_error}",
				)),
			};
		}

		let rollback_snapshot = snapshot.clone();
		let (snapshot, file_result) = match finalize_external_undo_snapshot(snapshot) {
			Ok(result) => result,
			Err(error) => {
				return match rollback_external_undo_snapshot(&rollback_snapshot) {
					Ok(()) => {
						discard_external_undo_snapshot(rollback_snapshot);
						Err(format!("The patch was rolled back because final validation failed: {error}"))
					}
					Err(rollback_error) => Err(format!(
						"Final validation failed: {error}. {rollback_error}",
					)),
				};
			}
		};

		Ok((
			ApplyGitPatchResult {
				operation_id: file_result.operation_id.clone(),
				applied_at_unix_ms: file_result
					.applied_at_unix_ms
					.expect("Git Apply always records an Undo snapshot"),
				added_files: file_result.added_files,
				replaced_files: file_result.replaced_files,
				deleted_files: file_result.deleted_files,
				added_directories: file_result.added_directories,
				replaced_directories: file_result.replaced_directories,
				deleted_directories: file_result.deleted_directories,
				added_lines: prepared.added_lines,
				deleted_lines: prepared.deleted_lines,
			},
			snapshot,
		))
	})
	.await;
	let task = match blocking_task {
		Ok(result) => result?,
		Err(error) => {
			let reason = protect_after_interrupted_mutation("Git patch application");
			return Err(format!("{reason} Detalhes: {error}"));
		}
	};

	let (result, snapshot) = task;
	if let Err(error) = record_external_undo_snapshot(&undo_state, snapshot.clone(), undo_history_limit) {
		return match rollback_external_undo_snapshot(&snapshot) {
			Ok(()) => {
				discard_external_undo_snapshot(snapshot);
				Err(format!(
					"The patch was rolled back because Undo history could not be recorded: {error}",
				))
			}
			Err(rollback_error) => Err(format!(
				"Undo history could not be recorded: {error}. {rollback_error}",
			)),
		};
	}

	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn patch_fingerprint_is_content_addressed() {
		let first: Arc<[u8]> = Arc::from(&b"diff --git a/a b/a\n"[..]);
		let same: Arc<[u8]> = Arc::from(&b"diff --git a/a b/a\n"[..]);
		let changed: Arc<[u8]> = Arc::from(&b"diff --git a/a b/b\n"[..]);

		assert_eq!(patch_fingerprint(&first), patch_fingerprint(&same));
		assert_ne!(patch_fingerprint(&first), patch_fingerprint(&changed));
	}

	#[test]
	fn git_command_neutralizes_apply_configuration() {
		let command = configure_git_command(Path::new("git"), Path::new("."));
		let arguments = command
			.get_args()
			.map(|value| value.to_string_lossy().into_owned())
			.collect::<Vec<_>>();
		let joined = arguments.join(" ");

		assert!(joined.contains("apply.ignoreWhitespace=false"));
		assert!(joined.contains("apply.whitespace=warn"));
	}

	#[test]
	fn br_adv_005_git_unsupported_operation_and_path_corpus() {
		for patch in [
			"diff --git a/a.bin b/a.bin\nGIT binary patch\n",
			"diff --git a/a b/a\nold mode 100644\nnew mode 100755\n",
			"diff --git a/a b/b\ncopy from a\ncopy to b\n",
			"diff --git a/link b/link\nnew file mode 120000\n",
			"diff --git a/submodule b/submodule\nnew file mode 160000\n",
			"diff --git a/script b/script\nnew file mode 100755\n",
		] {
			assert!(
				validate_text_patch(patch).is_err(),
				"unsupported Git patch should be rejected: {patch}",
			);
		}

		for unsafe_path in [
			"../escape.ts",
			"/absolute.ts",
			"src\\windows-separator.ts",
			"\"quoted path.ts\"",
		] {
			assert!(
				normalize_declared_patch_path(unsafe_path, false).is_err(),
				"unsafe Git path {unsafe_path} should be rejected",
			);
		}

		assert_eq!(
			normalize_declared_patch_path("a/src/unicode/Δ.ts", true)
				.expect("safe Unicode Git path should be accepted"),
			"src/unicode/Δ.ts",
		);

		let incomplete_rename = "diff --git a/a.ts b/b.ts\nrename from a.ts\n";
		assert!(parse_patch_metadata(incomplete_rename).is_err());
	}

}
