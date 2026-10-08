use crate::{
	runtime_utils::{current_unix_ms, encode_hex},
	safe_fs,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	fs::{self, File},
	io::Read,
	path::{Path, PathBuf},
	sync::{Mutex, OnceLock},
	time::{Duration, SystemTime},
};

pub(crate) const DEFAULT_PROJECT_HARD_QUOTA_BYTES: u64 = 10 * 1024 * 1024 * 1024;
pub(crate) const DEFAULT_GLOBAL_HARD_QUOTA_BYTES: u64 = 100 * 1024 * 1024 * 1024;
const SOFT_QUOTA_NUMERATOR: u64 = 8;
const SOFT_QUOTA_DENOMINATOR: u64 = 10;
const MIN_FREE_SPACE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;
const SNAPSHOT_METADATA_ALLOWANCE_BYTES: u64 = 1024 * 1024;
const SNAPSHOT_METADATA_ALLOWANCE_PER_FILE_BYTES: u64 = 1024;
const STAGING_METADATA_ALLOWANCE_BYTES: u64 = 1024 * 1024;
const STAGING_METADATA_ALLOWANCE_PER_FILE_BYTES: u64 = 1024;
const STORAGE_MARKER_FILE_NAME: &str = ".orqeto-storage.json";
const STORAGE_MARKER_FORMAT: &str = "orqeto-dev-storage";
const STORAGE_MARKER_VERSION: u32 = 1;
const STALE_NATIVE_DROP_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const WINDOWS_MARKER_RETRY_ATTEMPTS: usize = 8;
const WINDOWS_MARKER_RETRY_DELAY: Duration = Duration::from_millis(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StorageClass {
	RebuildableCache,
	OrdinaryHistory,
	CompletedStaging,
	ActiveUndo,
	ActiveStaging,
	RecoveryCritical,
}

impl StorageClass {
	fn gc_rank(self) -> Option<u8> {
		match self {
			Self::RebuildableCache => Some(0),
			Self::CompletedStaging => Some(1),
			Self::OrdinaryHistory => Some(2),
			Self::ActiveUndo | Self::ActiveStaging | Self::RecoveryCritical => None,
		}
	}
}

#[derive(Debug, Clone, Copy)]
struct StorageLimits {
	project_hard_bytes: u64,
	global_hard_bytes: u64,
	soft_numerator: u64,
	soft_denominator: u64,
	free_space_margin_bytes: u64,
}

impl Default for StorageLimits {
	fn default() -> Self {
		Self {
			project_hard_bytes: DEFAULT_PROJECT_HARD_QUOTA_BYTES,
			global_hard_bytes: DEFAULT_GLOBAL_HARD_QUOTA_BYTES,
			soft_numerator: SOFT_QUOTA_NUMERATOR,
			soft_denominator: SOFT_QUOTA_DENOMINATOR,
			free_space_margin_bytes: MIN_FREE_SPACE_MARGIN_BYTES,
		}
	}
}

impl StorageLimits {
	fn project_soft_bytes(self) -> u64 {
		self.project_hard_bytes
			.saturating_mul(self.soft_numerator) /
			self.soft_denominator.max(1)
	}

	fn global_soft_bytes(self) -> u64 {
		self.global_hard_bytes
			.saturating_mul(self.soft_numerator) /
			self.soft_denominator.max(1)
	}
}

#[derive(Debug, Default, Clone)]
struct StorageUsage {
	global_bytes: u64,
	projects: HashMap<String, u64>,
}

impl StorageUsage {
	fn project_bytes(&self, project_key: &str) -> u64 {
		self.projects.get(project_key).copied().unwrap_or(0)
	}
}

#[derive(Debug, Default)]
struct RuntimeStorageState {
	next_reservation_id: u64,
	reservations: HashMap<u64, ReservationRecord>,
	active_paths: HashSet<PathBuf>,
}

#[derive(Debug)]
struct ReservationRecord {
	project_key: String,
	bytes: u64,
}

static RUNTIME_STORAGE_STATE: OnceLock<Mutex<RuntimeStorageState>> = OnceLock::new();
static STORAGE_COORDINATION: OnceLock<Mutex<()>> = OnceLock::new();

fn runtime_state() -> &'static Mutex<RuntimeStorageState> {
	RUNTIME_STORAGE_STATE.get_or_init(|| Mutex::new(RuntimeStorageState::default()))
}

fn storage_coordination() -> &'static Mutex<()> {
	STORAGE_COORDINATION.get_or_init(|| Mutex::new(()))
}

pub(crate) struct StorageReservation {
	id: u64,
}

impl Drop for StorageReservation {
	fn drop(&mut self) {
		if let Ok(mut state) = runtime_state().lock() {
			state.reservations.remove(&self.id);
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StorageMarker {
	format: String,
	version: u32,
	project_key: String,
	class: StorageClass,
	created_at_unix_ms: u64,
	#[serde(default)]
	blob_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredBackup {
	pub(crate) blob_id: String,
	pub(crate) path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ContentFingerprint {
	size: u64,
	hash: [u8; 32],
}

fn storage_base_directory() -> PathBuf {
	std::env::temp_dir().join("orqeto-dev")
}

fn ensure_storage_base() -> Result<PathBuf, String> {
	let temp_root = std::env::temp_dir();
	safe_fs::create_descendant_directories_no_reparse(
		&temp_root,
		Path::new("orqeto-dev"),
	)
	.map_err(|error| format!("Could not prepare Orqeto internal storage: {error}"))
}

fn canonical_project_key(root: &Path) -> String {
	let mut value = root.to_string_lossy().replace('\\', "/");
	#[cfg(target_os = "windows")]
	{
		value = value.to_lowercase();
	}
	let digest = Sha256::digest(value.as_bytes());
	encode_hex(&digest)
}



fn random_token() -> Result<String, String> {
	let mut bytes = [0_u8; 16];
	getrandom::fill(&mut bytes)
		.map_err(|error| format!("Could not generate a safe storage identifier: {error}"))?;
	Ok(encode_hex(&bytes))
}

fn write_marker(
	directory: &Path,
	marker: &StorageMarker,
) -> Result<(), String> {
	let content = serde_json::to_vec(marker)
		.map_err(|error| format!("Could not serialize storage metadata: {error}"))?;
	safe_fs::atomic_write_bytes(&directory.join(STORAGE_MARKER_FILE_NAME), &content)
		.map_err(|error| format!("Could not persist storage metadata: {error}"))
}

fn is_transient_windows_marker_error(error: &std::io::Error) -> bool {
	#[cfg(windows)]
	{
		matches!(error.raw_os_error(), Some(32 | 33))
	}
	#[cfg(not(windows))]
	{
		let _ = error;
		false
	}
}

