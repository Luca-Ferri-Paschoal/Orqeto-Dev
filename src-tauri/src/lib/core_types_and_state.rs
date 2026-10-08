use crate::{
	runtime_utils::{canonicalize_existing, current_unix_ms},
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

