use crate::overlay::OverlayUndoState;
use crate::project_ignore::ProjectIgnore;
use crate::runtime_utils::resolve_from_path;
use crate::{decode_text, ensure_inside_root, process_tree, relative_path, safe_fs};
use serde::{Deserialize, Serialize};
use std::{
	collections::{BTreeMap, HashMap, HashSet},
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
const MAX_CUSTOM_VALIDATION_RUNTIME: Duration = Duration::from_secs(15 * 60);
const MAX_DIAGNOSTIC_DETAIL_CHARS: usize = 16_000;
const DIAGNOSTIC_FILE_LIMIT_MIN: usize = 1;
const DIAGNOSTIC_FILE_LIMIT_MAX: usize = 100;
const MAX_CUSTOM_VALIDATION_COMMAND_CHARS: usize = 8_192;

#[derive(Default)]
struct DiagnosticTrustApprovals {
	roots: HashSet<PathBuf>,
	custom_commands: HashSet<(PathBuf, String)>,
}

pub struct DiagnosticTrustState(Mutex<DiagnosticTrustApprovals>);

type ValidationOperationKey = (PathBuf, String, String);

pub struct ValidationOperationState(Mutex<HashMap<ValidationOperationKey, Arc<AtomicBool>>>);

impl ValidationOperationState {
	pub fn new() -> Self {
		Self(Mutex::new(HashMap::new()))
	}

	fn begin(
		&self,
		root: PathBuf,
		kind: String,
		operation_id: String,
	) -> Result<Arc<AtomicBool>, String> {
		let key = (root, kind, operation_id);
		let token = Arc::new(AtomicBool::new(false));
		self.0
			.lock()
			.map_err(|_| "The validation operation state became unavailable.".to_string())?
			.insert(key, Arc::clone(&token));
		Ok(token)
	}

	fn cancel(
		&self,
		root: &Path,
		kind: &str,
		operation_id: &str,
	) -> Result<bool, String> {
		let operations = self.0
			.lock()
			.map_err(|_| "The validation operation state became unavailable.".to_string())?;
		let key = (root.to_path_buf(), kind.to_string(), operation_id.to_string());
		let Some(token) = operations.get(&key) else {
			return Ok(false);
		};
		token.store(true, Ordering::Release);
		Ok(true)
	}

	fn finish(
		&self,
		root: &Path,
		kind: &str,
		operation_id: &str,
	) -> Result<(), String> {
		self.0
			.lock()
			.map_err(|_| "The validation operation state became unavailable.".to_string())?
			.remove(&(root.to_path_buf(), kind.to_string(), operation_id.to_string()));
		Ok(())
	}
}

impl DiagnosticTrustState {
	pub fn new() -> Self {
		Self(Mutex::new(DiagnosticTrustApprovals::default()))
	}

	fn approve(&self, root: PathBuf) -> Result<(), String> {
		self.0
			.lock()
			.map_err(|_| "The diagnostic trust state became unavailable.".to_string())?
			.roots
			.insert(root);
		Ok(())
	}

	fn approve_custom_command(
		&self,
		root: PathBuf,
		command: String,
	) -> Result<(), String> {
		let mut approvals = self
			.0
			.lock()
			.map_err(|_| "The diagnostic trust state became unavailable.".to_string())?;
		approvals.roots.insert(root.clone());
		approvals.custom_commands.insert((root, command));
		Ok(())
	}

	fn is_approved(&self, root: &Path) -> Result<bool, String> {
		self.0
			.lock()
			.map(|approved| approved.roots.contains(root))
			.map_err(|_| "The diagnostic trust state became unavailable.".to_string())
	}

	fn is_custom_command_approved(
		&self,
		root: &Path,
		command: &str,
	) -> Result<bool, String> {
		self.0
			.lock()
			.map(|approved| {
				approved
					.custom_commands
					.contains(&(root.to_path_buf(), command.to_string()))
			})
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
	lint_fix_command: Option<String>,
	test_command: Option<String>,
	development_log_command: Option<String>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLintFixResult {
	changed_file_count: usize,
	remaining_issue_count: usize,
	remaining_error_count: usize,
	remaining_warning_count: usize,
	remaining_files_with_issues: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectValidationCommandResult {
	kind: String,
	command: String,
	exit_code: Option<i32>,
	success: bool,
	duration_ms: u64,
	stdout: String,
	stderr: String,
}

#[derive(Default)]
struct ProjectValidationCommands {
	lint_fix: Option<String>,
	test: Option<String>,
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

