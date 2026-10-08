use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TraversalLimits {
	pub(crate) max_files: usize,
	pub(crate) max_directories: usize,
	pub(crate) max_entries: usize,
	pub(crate) max_path_bytes: usize,
	pub(crate) max_total_path_bytes: usize,
}

impl TraversalLimits {
	pub(crate) const fn new(
		max_files: usize,
		max_directories: usize,
		max_entries: usize,
		max_path_bytes: usize,
		max_total_path_bytes: usize,
	) -> Self {
		Self {
			max_files,
			max_directories,
			max_entries,
			max_path_bytes,
			max_total_path_bytes,
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TraversalLimitKind {
	Files,
	Directories,
	Entries,
	PathBytes,
	TotalPathBytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TraversalLimitExceeded {
	pub(crate) kind: TraversalLimitKind,
	pub(crate) limit: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct TraversalBudget {
	files: usize,
	directories: usize,
	entries: usize,
	path_bytes: usize,
}

impl TraversalBudget {
	pub(crate) fn record_file(
		&mut self,
		limits: TraversalLimits,
	) -> Result<(), TraversalLimitExceeded> {
		self.files = self.files.saturating_add(1);
		if self.files > limits.max_files {
			return Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::Files,
				limit: limits.max_files,
			});
		}

		Ok(())
	}

	pub(crate) fn record_directory(
		&mut self,
		limits: TraversalLimits,
	) -> Result<(), TraversalLimitExceeded> {
		self.directories = self.directories.saturating_add(1);
		if self.directories > limits.max_directories {
			return Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::Directories,
				limit: limits.max_directories,
			});
		}

		Ok(())
	}

	pub(crate) fn record_entry(
		&mut self,
		limits: TraversalLimits,
	) -> Result<(), TraversalLimitExceeded> {
		self.entries = self.entries.saturating_add(1);
		if self.entries > limits.max_entries {
			return Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::Entries,
				limit: limits.max_entries,
			});
		}

		Ok(())
	}

	pub(crate) fn record_path(
		&mut self,
		path: &Path,
		limits: TraversalLimits,
	) -> Result<(), TraversalLimitExceeded> {
		let path_bytes = platform_path_bytes(path);
		if path_bytes > limits.max_path_bytes {
			return Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::PathBytes,
				limit: limits.max_path_bytes,
			});
		}

		self.path_bytes = self.path_bytes.saturating_add(path_bytes);
		if self.path_bytes > limits.max_total_path_bytes {
			return Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::TotalPathBytes,
				limit: limits.max_total_path_bytes,
			});
		}

		Ok(())
	}
}

#[cfg(target_os = "windows")]
fn platform_path_bytes(path: &Path) -> usize {
	use std::os::windows::ffi::OsStrExt;

	path.as_os_str().encode_wide().count().saturating_mul(2)
}

#[cfg(unix)]
fn platform_path_bytes(path: &Path) -> usize {
	use std::os::unix::ffi::OsStrExt;

	path.as_os_str().as_bytes().len()
}

#[cfg(not(any(target_os = "windows", unix)))]
fn platform_path_bytes(path: &Path) -> usize {
	path.as_os_str().to_string_lossy().len()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MachineResourcePolicy {
	pub(crate) worker_count: usize,
	pub(crate) stream_buffer_bytes: usize,
}

pub(crate) fn machine_resource_policy() -> MachineResourcePolicy {
	let available = std::thread::available_parallelism()
		.map(|value| value.get())
		.unwrap_or(1);

	MachineResourcePolicy {
		worker_count: available.clamp(1, MAX_BACKGROUND_IO_WORKERS),
		stream_buffer_bytes: STREAM_BUFFER_BYTES,
	}
}

pub(crate) const PROJECT_DISCOVERY_MAX_FILES: usize = 500_000;
pub(crate) const PROJECT_DISCOVERY_MAX_DIRECTORIES: usize = 1_000_000;
pub(crate) const PROJECT_DISCOVERY_MAX_ENTRIES: usize = 1_500_000;
pub(crate) const DISCOVERY_MAX_PATH_BYTES: usize = 32 * 1024;
pub(crate) const DISCOVERY_MAX_TOTAL_PATH_BYTES: usize = 512 * 1024 * 1024;
pub(crate) const PROJECT_DISCOVERY_LIMITS: TraversalLimits = TraversalLimits::new(
	PROJECT_DISCOVERY_MAX_FILES,
	PROJECT_DISCOVERY_MAX_DIRECTORIES,
	PROJECT_DISCOVERY_MAX_ENTRIES,
	DISCOVERY_MAX_PATH_BYTES,
	DISCOVERY_MAX_TOTAL_PATH_BYTES,
);

pub(crate) const CONTEXT_MAX_FILES: usize = PROJECT_DISCOVERY_MAX_FILES;
pub(crate) const CONTEXT_MAX_DIRECTORIES: usize = PROJECT_DISCOVERY_MAX_DIRECTORIES;
pub(crate) const CONTEXT_MAX_REQUEST_PATHS: usize = 50_000;
pub(crate) const CONTEXT_MAX_PATH_BYTES: usize = DISCOVERY_MAX_PATH_BYTES;
pub(crate) const CONTEXT_MAX_TOTAL_PATH_BYTES: usize = DISCOVERY_MAX_TOTAL_PATH_BYTES;
pub(crate) const CONTEXT_MAX_TRAVERSAL_ENTRIES: usize = PROJECT_DISCOVERY_MAX_ENTRIES;
pub(crate) const CONTEXT_MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
pub(crate) const CONTEXT_MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
pub(crate) const CONTEXT_TRAVERSAL_LIMITS: TraversalLimits = TraversalLimits::new(
	CONTEXT_MAX_FILES,
	CONTEXT_MAX_DIRECTORIES,
	CONTEXT_MAX_TRAVERSAL_ENTRIES,
	CONTEXT_MAX_PATH_BYTES,
	CONTEXT_MAX_TOTAL_PATH_BYTES,
);

pub(crate) const MAX_BACKGROUND_IO_WORKERS: usize = 8;
pub(crate) const STREAM_BUFFER_BYTES: usize = 64 * 1024;

