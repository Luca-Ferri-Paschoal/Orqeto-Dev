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
use crate::{
	process_tree,
	project_ignore::ProjectIgnore,
	runtime_utils::{canonicalize_existing, resolve_from_path},
	safe_fs,
};
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

struct GitPatchSource {
	bytes: Arc<[u8]>,
	name: String,
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

