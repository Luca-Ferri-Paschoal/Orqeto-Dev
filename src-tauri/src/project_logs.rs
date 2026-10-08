use crate::{context_redaction, process_tree};
use serde::Serialize;
use std::{
	collections::{HashMap, HashSet, VecDeque},
	fs,
	io::Read,
	path::{Path, PathBuf},
	process::{Command, Stdio},
	sync::{
		atomic::{AtomicBool, Ordering},
		Arc,
		Mutex,
	},
	thread,
	time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[cfg(target_os = "windows")]
use std::{
	ffi::OsString,
	os::windows::process::CommandExt,
};

include!("project_logs/model.rs");
include!("project_logs/config.rs");
include!("project_logs/process.rs");
include!("project_logs/commands.rs");

#[cfg(test)]
mod tests {
	use super::*;
	use std::time::Instant;

	include!("project_logs/tests.rs");
}
