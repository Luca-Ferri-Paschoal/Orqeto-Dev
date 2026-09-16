use crate::safe_fs;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	fs::{self, File},
	io::Read,
	path::{Path, PathBuf},
	sync::{Mutex, OnceLock},
	time::{Duration, SystemTime, UNIX_EPOCH},
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

fn encode_hex(bytes: &[u8]) -> String {
	const HEX: &[u8; 16] = b"0123456789abcdef";
	let mut output = String::with_capacity(bytes.len() * 2);
	for byte in bytes {
		output.push(HEX[(byte >> 4) as usize] as char);
		output.push(HEX[(byte & 0x0f) as usize] as char);
	}
	output
}

fn current_unix_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
		.unwrap_or(0)
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

fn read_marker(directory: &Path) -> Result<Option<StorageMarker>, String> {
	let path = directory.join(STORAGE_MARKER_FILE_NAME);
	let mut last_error = None;
	for attempt in 0..WINDOWS_MARKER_RETRY_ATTEMPTS {
		let metadata = match fs::symlink_metadata(&path) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
			Err(error) if is_transient_windows_marker_error(&error) => {
				last_error = Some(("validar", error));
				if attempt + 1 < WINDOWS_MARKER_RETRY_ATTEMPTS {
					std::thread::sleep(WINDOWS_MARKER_RETRY_DELAY);
					continue;
				}
				break;
			}
			Err(error) => {
				return Err(format!(
					"Could not validate storage metadata {}: {error}",
					path.display(),
				));
			}
		};
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!(
				"Storage metadata {} is not a safe regular file.",
				path.display(),
			));
		}
		match fs::read(&path) {
			Ok(content) => {
				let marker: StorageMarker = serde_json::from_slice(&content)
					.map_err(|error| format!("Storage metadata {} is invalid: {error}", path.display()))?;
				if marker.format != STORAGE_MARKER_FORMAT || marker.version != STORAGE_MARKER_VERSION {
					return Err(format!(
						"Storage metadata {} uses an unsupported format.",
						path.display(),
					));
				}
				return Ok(Some(marker));
			}
			Err(error) if is_transient_windows_marker_error(&error) => {
				last_error = Some(("ler", error));
				if attempt + 1 < WINDOWS_MARKER_RETRY_ATTEMPTS {
					std::thread::sleep(WINDOWS_MARKER_RETRY_DELAY);
					continue;
				}
				break;
			}
			Err(error) => {
				return Err(format!(
					"Could not read storage metadata {}: {error}",
					path.display(),
				));
			}
		}
	}
	let (action, error) = last_error.expect("marker retry exhausted without error");
	Err(format!(
		"Could not {action} storage metadata {} after transient retries: {error}",
		path.display(),
	))
}

fn create_marked_directory(
	parent: &Path,
	prefix: &str,
	project_root: &Path,
	class: StorageClass,
) -> Result<PathBuf, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	for _ in 0..128 {
		let token = random_token()?;
		let candidate = parent.join(format!("{prefix}-{token}"));
		match fs::create_dir(&candidate) {
			Ok(()) => {
				let metadata = fs::symlink_metadata(&candidate)
					.map_err(|error| format!("Could not validate the created internal directory: {error}"))?;
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
					let _ = fs::remove_dir_all(&candidate);
					return Err("The created internal directory is not safe.".to_string());
				}
				let marker = StorageMarker {
					format: STORAGE_MARKER_FORMAT.to_string(),
					version: STORAGE_MARKER_VERSION,
					project_key: canonical_project_key(project_root),
					class,
					created_at_unix_ms: current_unix_ms(),
					blob_ids: Vec::new(),
				};
				if let Err(error) = write_marker(&candidate, &marker) {
					let _ = fs::remove_dir_all(&candidate);
					return Err(error);
				}
				safe_fs::sync_directory(parent)
					.map_err(|error| format!("Could not sync internal storage: {error}"))?;
				register_active_path(&candidate)?;
				return Ok(candidate);
			}
			Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
			Err(error) => {
				return Err(format!("Could not create a safe internal directory: {error}"));
			}
		}
	}
	Err("Could not reserve a unique internal directory.".to_string())
}

pub(crate) fn create_files_apply_staging_directory(project_root: &Path) -> Result<PathBuf, String> {
	let base = ensure_storage_base()?;
	let staging_root = safe_fs::create_descendant_directories_no_reparse(
		&base,
		Path::new("files-apply"),
	)
	.map_err(|error| format!("Could not prepare safe Apply staging: {error}"))?;
	create_marked_directory(
		&staging_root,
		"apply",
		project_root,
		StorageClass::ActiveStaging,
	)
}

pub(crate) fn create_snapshot_directory(project_root: &Path) -> Result<PathBuf, String> {
	let base = ensure_storage_base()?;
	create_marked_directory(
		&base,
		"undo",
		project_root,
		StorageClass::RecoveryCritical,
	)
}

pub(crate) fn mark_storage_class(
	directory: &Path,
	class: StorageClass,
) -> Result<(), String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let mut marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	marker.class = class;
	write_marker(directory, &marker)
}

pub(crate) fn register_active_path(path: &Path) -> Result<(), String> {
	let mut state = runtime_state()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	state.active_paths.insert(path.to_path_buf());
	Ok(())
}

pub(crate) fn release_active_path(path: &Path) {
	if let Ok(mut state) = runtime_state().lock() {
		state.active_paths.remove(path);
	}
}

pub(crate) fn register_native_drop(path: &Path) -> Result<(), String> {
	let base = storage_base_directory().join("native-drop");
	let canonical_base = fs::canonicalize(&base)
		.map_err(|error| format!("Could not validate the temporary-drop root: {error}"))?;
	let canonical_path = fs::canonicalize(path)
		.map_err(|error| format!("Could not validate the temporary drop: {error}"))?;
	if !canonical_path.starts_with(&canonical_base) || canonical_path == canonical_base {
		return Err("The temporary drop does not belong to the expected internal storage.".to_string());
	}
	let metadata = fs::symlink_metadata(&canonical_path)
		.map_err(|error| format!("Could not validate the temporary drop: {error}"))?;
	if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
		return Err("The temporary drop is not a safe directory.".to_string());
	}
	register_active_path(&canonical_path)
}

pub(crate) fn release_native_drop(path: &Path) {
	release_active_path(path);
}

fn reservation_totals(state: &RuntimeStorageState) -> (u64, HashMap<String, u64>) {
	let mut global = 0_u64;
	let mut projects = HashMap::new();
	for reservation in state.reservations.values() {
		global = global.saturating_add(reservation.bytes);
		let project_total = projects
			.entry(reservation.project_key.clone())
			.or_insert(0_u64);
		*project_total = project_total.saturating_add(reservation.bytes);
	}
	(global, projects)
}

fn exceeds_soft_threshold(
	limits: StorageLimits,
	usage: &StorageUsage,
	reserved_global: u64,
	reserved_project: u64,
	project_key: &str,
	required_bytes: u64,
) -> bool {
	usage
		.project_bytes(project_key)
		.saturating_add(reserved_project)
		.saturating_add(required_bytes) > limits.project_soft_bytes() ||
		usage
			.global_bytes
			.saturating_add(reserved_global)
			.saturating_add(required_bytes) > limits.global_soft_bytes()
}

fn check_capacity(
	limits: StorageLimits,
	usage: &StorageUsage,
	reserved_global: u64,
	reserved_project: u64,
	project_key: &str,
	required_bytes: u64,
	available_bytes: u64,
) -> Result<(), String> {
	let project_total = usage
		.project_bytes(project_key)
		.saturating_add(reserved_project)
		.checked_add(required_bytes)
		.ok_or_else(|| "Project storage quota calculation exceeded the numeric limit.".to_string())?;
	if project_total > limits.project_hard_bytes {
		return Err(format!(
			"The operation requires safe internal storage but would exceed this project's {} GiB quota.",
			limits.project_hard_bytes / (1024 * 1024 * 1024),
		));
	}

	let global_total = usage
		.global_bytes
		.saturating_add(reserved_global)
		.checked_add(required_bytes)
		.ok_or_else(|| "Global storage quota calculation exceeded the numeric limit.".to_string())?;
	if global_total > limits.global_hard_bytes {
		return Err(format!(
			"The operation requires safe internal storage but would exceed Orqeto's global {} GiB quota.",
			limits.global_hard_bytes / (1024 * 1024 * 1024),
		));
	}

	let required_physical = required_bytes
		.saturating_add(reserved_global)
		.saturating_add(limits.free_space_margin_bytes);
	if available_bytes < required_physical {
		return Err(format!(
			"There is not enough free space to reserve the operation safely. At least {} free bytes are required including the safety margin.",
			required_physical,
		));
	}
	Ok(())
}

pub(crate) fn reserve(
	project_root: &Path,
	required_bytes: u64,
) -> Result<StorageReservation, String> {
	reserve_with_limits(
		project_root,
		required_bytes,
		StorageLimits::default(),
		None,
	)
}

fn reserve_with_limits(
	project_root: &Path,
	required_bytes: u64,
	limits: StorageLimits,
	available_override: Option<u64>,
) -> Result<StorageReservation, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let base = ensure_storage_base()?;
	let project_key = canonical_project_key(project_root);
	let mut usage = collect_usage(&base)?;
	let (mut reserved_global, mut reserved_projects) = {
		let state = runtime_state()
			.lock()
			.map_err(|_| "The storage manager became unavailable.".to_string())?;
		reservation_totals(&state)
	};
	let project_reserved = reserved_projects.get(&project_key).copied().unwrap_or(0);
	let soft_pressure = exceeds_soft_threshold(
		limits,
		&usage,
		reserved_global,
		project_reserved,
		&project_key,
		required_bytes,
	);
	if soft_pressure {
		garbage_collect_internal(&base)?;
		usage = collect_usage(&base)?;
		let state = runtime_state()
			.lock()
			.map_err(|_| "The storage manager became unavailable.".to_string())?;
		(reserved_global, reserved_projects) = reservation_totals(&state);
	}

	let available = match available_override {
		Some(value) => value,
		None => available_space_bytes(&base)?,
	};
	check_capacity(
		limits,
		&usage,
		reserved_global,
		reserved_projects.get(&project_key).copied().unwrap_or(0),
		&project_key,
		required_bytes,
		available,
	)?;

	let mut state = runtime_state()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	state.next_reservation_id = state.next_reservation_id.wrapping_add(1).max(1);
	let id = state.next_reservation_id;
	state.reservations.insert(
		id,
		ReservationRecord {
			project_key,
			bytes: required_bytes,
		},
	);
	Ok(StorageReservation { id })
}

pub(crate) fn snapshot_reservation_bytes(
	backup_bytes: u64,
	file_count: usize,
) -> Result<u64, String> {
	let metadata = SNAPSHOT_METADATA_ALLOWANCE_BYTES
		.checked_add((file_count as u64).saturating_mul(SNAPSHOT_METADATA_ALLOWANCE_PER_FILE_BYTES))
		.ok_or_else(|| "Snapshot reservation calculation exceeded the numeric limit.".to_string())?;
	backup_bytes
		.checked_add(metadata)
		.ok_or_else(|| "Snapshot reservation calculation exceeded the numeric limit.".to_string())
}

pub(crate) fn staging_reservation_bytes(
	source_bytes: u64,
	file_count: usize,
) -> Result<u64, String> {
	let metadata = STAGING_METADATA_ALLOWANCE_BYTES
		.checked_add((file_count as u64).saturating_mul(STAGING_METADATA_ALLOWANCE_PER_FILE_BYTES))
		.ok_or_else(|| "Staging reservation calculation exceeded the numeric limit.".to_string())?;
	source_bytes
		.checked_add(metadata)
		.ok_or_else(|| "Staging reservation calculation exceeded the numeric limit.".to_string())
}

fn content_fingerprint(path: &Path) -> Result<ContentFingerprint, String> {
	let mut file = File::open(path)
		.map_err(|error| format!("Could not verify {}: {error}", path.display()))?;
	let mut buffer = vec![0_u8; 64 * 1024];
	let mut size = 0_u64;
	let mut hasher = Sha256::new();
	loop {
		let read = file
			.read(&mut buffer)
			.map_err(|error| format!("Could not verify {}: {error}", path.display()))?;
		if read == 0 {
			break;
		}
		size = size
			.checked_add(read as u64)
			.ok_or_else(|| "Backup size exceeded the numeric limit.".to_string())?;
		hasher.update(&buffer[..read]);
	}
	let digest = hasher.finalize();
	let mut hash = [0_u8; 32];
	hash.copy_from_slice(&digest);
	Ok(ContentFingerprint { size, hash })
}

#[cfg(target_os = "windows")]
fn permission_signature(metadata: &fs::Metadata) -> u64 {
	if metadata.permissions().readonly() { 1 } else { 0 }
}

#[cfg(unix)]
fn permission_signature(metadata: &fs::Metadata) -> u64 {
	use std::os::unix::fs::PermissionsExt;
	metadata.permissions().mode() as u64
}

#[cfg(not(any(target_os = "windows", unix)))]
fn permission_signature(metadata: &fs::Metadata) -> u64 {
	if metadata.permissions().readonly() { 1 } else { 0 }
}

fn blob_id_for(
	fingerprint: ContentFingerprint,
	permissions: u64,
) -> String {
	format!(
		"{}-{:x}",
		encode_hex(&fingerprint.hash),
		permissions,
	)
}

fn valid_blob_id(value: &str) -> bool {
	let Some((hash, permissions)) = value.split_once('-') else {
		return false;
	};
	hash.len() == 64 &&
		hash.bytes().all(|byte| byte.is_ascii_hexdigit()) &&
		!permissions.is_empty() &&
		permissions.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn blob_path(blob_id: &str) -> Result<PathBuf, String> {
	if !valid_blob_id(blob_id) {
		return Err("The recovery blob identifier is invalid.".to_string());
	}
	let path = storage_base_directory()
		.join("blobs")
		.join(format!("{blob_id}.blob"));
	validate_managed_regular_file(&path)?;
	let metadata = fs::metadata(&path)
		.map_err(|error| format!("Could not validate recovery blob {}: {error}", path.display()))?;
	let fingerprint = content_fingerprint(&path)?;
	if blob_id_for(fingerprint, permission_signature(&metadata)) != blob_id {
		return Err(format!(
			"Recovery blob {} does not match the expected content identifier.",
			path.display(),
		));
	}
	Ok(path)
}

fn ensure_blob(
	source: &Path,
	fingerprint: ContentFingerprint,
	expected_permissions: u64,
	blob_id: &str,
) -> Result<PathBuf, String> {
	let base = ensure_storage_base()?;
	let blob_root = safe_fs::create_descendant_directories_no_reparse(
		&base,
		Path::new("blobs"),
	)
	.map_err(|error| format!("Could not prepare blob storage: {error}"))?;
	let path = blob_root.join(format!("{blob_id}.blob"));
	match fs::symlink_metadata(&path) {
		Ok(metadata) => {
			if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
				return Err("An existing internal blob is not a safe file.".to_string());
			}
		}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			match safe_fs::atomic_copy_create_new(source, &path) {
				Ok(_) => {}
				Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
				Err(error) => {
					return Err(format!("Could not persist the recovery blob: {error}"));
				}
			}
		}
		Err(error) => return Err(format!("Could not validate the recovery blob: {error}")),
	}
	let stored_metadata = fs::metadata(&path)
		.map_err(|error| format!("Could not validate recovery blob permissions: {error}"))?;
	let stored = content_fingerprint(&path)?;
	if stored != fingerprint || permission_signature(&stored_metadata) != expected_permissions {
		return Err("An internal blob does not match the content/permissions it is supposed to preserve.".to_string());
	}
	Ok(path)
}

fn add_blob_reference(
	snapshot_directory: &Path,
	blob_id: &str,
) -> Result<(), String> {
	let mut marker = read_marker(snapshot_directory)?
		.ok_or_else(|| "The snapshot has no storage metadata.".to_string())?;
	if !marker.blob_ids.iter().any(|value| value == blob_id) {
		marker.blob_ids.push(blob_id.to_string());
		marker.blob_ids.sort();
		write_marker(snapshot_directory, &marker)?;
	}
	Ok(())
}

pub(crate) fn store_stable_backup(
	source: &Path,
	snapshot_directory: &Path,
) -> Result<StoredBackup, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let metadata = fs::symlink_metadata(source)
		.map_err(|error| format!("Could not verify {}: {error}", source.display()))?;
	if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
		return Err(format!(
			"{} is not a safe regular file that can be preserved.",
			source.display(),
		));
	}
	let expected_permissions = permission_signature(&metadata);
	let before = content_fingerprint(source)?;
	let blob_id = blob_id_for(before, expected_permissions);
	let path = ensure_blob(
		source,
		before,
		expected_permissions,
		&blob_id,
	)?;
	let after = content_fingerprint(source)?;
	let after_metadata = fs::symlink_metadata(source)
		.map_err(|error| format!("Could not revalidate {}: {error}", source.display()))?;
	if safe_fs::metadata_is_link_or_reparse(&after_metadata) ||
		!after_metadata.is_file() ||
		before != after ||
		permission_signature(&after_metadata) != expected_permissions
	{
		return Err(format!(
			"{} changed while the backup was being preserved. The operation was cancelled before changing the project.",
			source.display(),
		));
	}
	add_blob_reference(
		snapshot_directory,
		&blob_id,
	)?;
	Ok(StoredBackup { blob_id, path })
}

pub(crate) fn set_snapshot_active_undo(directory: &Path) -> Result<(), String> {
	mark_storage_class(
		directory,
		StorageClass::ActiveUndo,
	)
}

pub(crate) fn snapshot_blob_references(directory: &Path) -> Result<HashSet<String>, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	Ok(marker.blob_ids.into_iter().collect())
}

pub(crate) fn retain_snapshot_blob_references(
	directory: &Path,
	live_blob_ids: &HashSet<String>,
) -> Result<usize, String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let mut marker = read_marker(directory)?
		.ok_or_else(|| format!("Directory {} has no storage metadata.", directory.display()))?;
	let previous_len = marker.blob_ids.len();
	marker.blob_ids.retain(|blob_id| live_blob_ids.contains(blob_id));
	if marker.blob_ids.len() != previous_len {
		write_marker(directory, &marker)?;
	}
	Ok(marker.blob_ids.len())
}

fn usage_metadata_no_follow(path: &Path) -> Result<Option<fs::Metadata>, String> {
	match fs::symlink_metadata(path) {
		Ok(metadata) => Ok(Some(metadata)),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
		Err(error) => Err(format!("Could not measure {}: {error}", path.display())),
	}
}

fn directory_size_no_follow(path: &Path) -> Result<u64, String> {
	let Some(metadata) = usage_metadata_no_follow(path)? else {
		return Ok(0);
	};
	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", path.display()));
	}
	if metadata.is_file() {
		return Ok(metadata.len());
	}
	if !metadata.is_dir() {
		return Ok(0);
	}
	let mut total = 0_u64;
	let mut stack = vec![path.to_path_buf()];
	while let Some(directory) = stack.pop() {
		let entries = match fs::read_dir(&directory) {
			Ok(entries) => entries,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
			Err(error) => {
				return Err(format!("Could not measure {}: {error}", directory.display()));
			}
		};
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not measure an internal entry: {error}"))?;
			let child = entry.path();
			let Some(metadata) = usage_metadata_no_follow(&child)? else {
				continue;
			};
			if safe_fs::metadata_is_link_or_reparse(&metadata) {
				return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", child.display()));
			}
			if metadata.is_dir() {
				stack.push(child);
			} else if metadata.is_file() {
				total = total
					.checked_add(metadata.len())
					.ok_or_else(|| "Internal storage usage exceeded the numeric limit.".to_string())?;
			}
		}
	}
	Ok(total)
}

fn add_usage(
	usage: &mut StorageUsage,
	project_key: Option<&str>,
	bytes: u64,
) {
	usage.global_bytes = usage.global_bytes.saturating_add(bytes);
	if let Some(project_key) = project_key {
		let value = usage.projects.entry(project_key.to_string()).or_insert(0);
		*value = value.saturating_add(bytes);
	}
}

fn validate_managed_path_components(
	base: &Path,
	candidate: &Path,
) -> Result<fs::Metadata, String> {
	if candidate == base || !candidate.starts_with(base) {
		return Err("The internal path does not belong to Orqeto-managed storage.".to_string());
	}
	let base_metadata = fs::symlink_metadata(base)
		.map_err(|error| format!("Could not validate internal storage: {error}"))?;
	if safe_fs::metadata_is_link_or_reparse(&base_metadata) || !base_metadata.is_dir() {
		return Err("The internal storage root is not a stable directory.".to_string());
	}

	let relative = candidate
		.strip_prefix(base)
		.map_err(|_| "The internal path does not belong to Orqeto-managed storage.".to_string())?;
	let mut current = base.to_path_buf();
	let mut final_metadata = None;
	for component in relative.components() {
		let std::path::Component::Normal(name) = component else {
			return Err("The internal path contains an unsafe component.".to_string());
		};
		current.push(name);
		let metadata = fs::symlink_metadata(&current)
			.map_err(|error| format!("Could not validate {}: {error}", current.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", current.display()));
		}
		final_metadata = Some(metadata);
	}
	final_metadata.ok_or_else(|| "The internal path does not identify a managed entry.".to_string())
}

pub(crate) fn validate_managed_directory(path: &Path) -> Result<(), String> {
	let base = storage_base_directory();
	let metadata = validate_managed_path_components(&base, path)?;
	if !metadata.is_dir() {
		return Err(format!(
			"Internal entry {} is not a safe directory.",
			path.display(),
		));
	}
	Ok(())
}

pub(crate) fn validate_managed_regular_file(path: &Path) -> Result<(), String> {
	let base = storage_base_directory();
	let metadata = validate_managed_path_components(&base, path)?;
	if !metadata.is_file() {
		return Err(format!(
			"Internal file {} is not a safe regular file.",
			path.display(),
		));
	}
	Ok(())
}

fn collect_marked_directory_usage(
	usage: &mut StorageUsage,
	project_blob_refs: &mut HashMap<String, HashSet<String>>,
	directory: &Path,
) -> Result<(), String> {
	let base = storage_base_directory();
	let metadata = validate_managed_path_components(&base, directory)?;
	if !metadata.is_dir() {
		return Err(format!("Internal entry {} is not a safe directory.", directory.display()));
	}
	let Some(marker) = read_marker(directory)? else {
		add_usage(
			usage,
			None,
			directory_size_no_follow(directory)?,
		);
		return Ok(());
	};
	add_usage(
		usage,
		Some(&marker.project_key),
		directory_size_no_follow(directory)?,
	);
	let refs = project_blob_refs.entry(marker.project_key).or_default();
	refs.extend(marker.blob_ids);
	Ok(())
}

fn collect_usage(base: &Path) -> Result<StorageUsage, String> {
	let mut usage = StorageUsage::default();
	let mut project_blob_refs = HashMap::<String, HashSet<String>>::new();
	let mut blob_sizes = HashMap::<String, u64>::new();
	let entries = match fs::read_dir(base) {
		Ok(entries) => entries,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(usage),
		Err(error) => return Err(format!("Could not measure internal storage: {error}")),
	};
	for entry in entries {
		let entry = entry.map_err(|error| format!("Could not measure an internal entry: {error}"))?;
		let path = entry.path();
		let name = entry.file_name().to_string_lossy().to_string();
		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| format!("Could not validate {}: {error}", path.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!("Internal storage contains an unsafe link/reparse point at {}.", path.display()));
		}
		if name.starts_with("undo-") && metadata.is_dir() {
			collect_marked_directory_usage(
				&mut usage,
				&mut project_blob_refs,
				&path,
			)?;
			continue;
		}
		if name == "files-apply" && metadata.is_dir() {
			for child in fs::read_dir(&path)
				.map_err(|error| format!("Could not measure internal staging: {error}"))?
			{
				let child = child.map_err(|error| format!("Could not measure a staging entry: {error}"))?;
				collect_marked_directory_usage(
					&mut usage,
					&mut project_blob_refs,
					&child.path(),
				)?;
			}
			continue;
		}
		if name == "blobs" && metadata.is_dir() {
			for blob in fs::read_dir(&path)
				.map_err(|error| format!("Could not measure internal blobs: {error}"))?
			{
				let blob = blob.map_err(|error| format!("Could not measure an internal blob: {error}"))?;
				let blob_path = blob.path();
				let blob_metadata = fs::symlink_metadata(&blob_path)
					.map_err(|error| format!("Could not validate {}: {error}", blob_path.display()))?;
				if safe_fs::metadata_is_link_or_reparse(&blob_metadata) || !blob_metadata.is_file() {
					return Err(format!("Internal blob {} is not a safe file.", blob_path.display()));
				}
				let name = blob.file_name().to_string_lossy().to_string();
				if let Some(blob_id) = name.strip_suffix(".blob") {
					blob_sizes.insert(blob_id.to_string(), blob_metadata.len());
				}
				usage.global_bytes = usage.global_bytes.saturating_add(blob_metadata.len());
			}
			continue;
		}
		add_usage(
			&mut usage,
			None,
			directory_size_no_follow(&path)?,
		);
	}
	for (project_key, refs) in project_blob_refs {
		let project_usage = usage.projects.entry(project_key).or_insert(0);
		for blob_id in refs {
			*project_usage = project_usage.saturating_add(blob_sizes.get(&blob_id).copied().unwrap_or(0));
		}
	}
	Ok(usage)
}

fn active_paths_snapshot() -> Result<HashSet<PathBuf>, String> {
	runtime_state()
		.lock()
		.map(|state| state.active_paths.clone())
		.map_err(|_| "The storage manager became unavailable.".to_string())
}

fn safe_remove_managed_tree(
	base: &Path,
	candidate: &Path,
) -> Result<(), String> {
	match fs::symlink_metadata(candidate) {
		Ok(_) => {}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
		Err(error) => {
			return Err(format!("Could not validate {} before cleanup: {error}", candidate.display()));
		}
	}
	let metadata = validate_managed_path_components(base, candidate)
		.map_err(|error| format!("A limpeza recusou {}: {error}", candidate.display()))?;
	if metadata.is_file() {
		fs::remove_file(candidate)
			.map_err(|error| format!("Could not remove {}: {error}", candidate.display()))?;
		return Ok(());
	}
	let mut stack = vec![candidate.to_path_buf()];
	while let Some(directory) = stack.pop() {
		for entry in fs::read_dir(&directory)
			.map_err(|error| format!("Could not validate {} before cleanup: {error}", directory.display()))?
		{
			let entry = entry.map_err(|error| format!("Could not validate an entry before cleanup: {error}"))?;
			let path = entry.path();
			let metadata = fs::symlink_metadata(&path)
				.map_err(|error| format!("Could not validate {} before cleanup: {error}", path.display()))?;
			if safe_fs::metadata_is_link_or_reparse(&metadata) {
				return Err(format!("Cleanup rejected the internal link/reparse point {}.", path.display()));
			}
			if metadata.is_dir() {
				stack.push(path);
			}
		}
	}
	fs::remove_dir_all(candidate)
		.map_err(|error| format!("Could not remove {}: {error}", candidate.display()))
}

pub(crate) fn remove_managed_directory(path: &Path) -> Result<(), String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	release_active_path(path);
	let base = storage_base_directory();
	safe_remove_managed_tree(
		&base,
		path,
	)
}

fn is_runtime_active(
	active: &HashSet<PathBuf>,
	path: &Path,
) -> bool {
	let protects = |candidate: &Path| {
		active.iter().any(|active_path| {
			active_path == candidate ||
				active_path.starts_with(candidate) ||
				candidate.starts_with(active_path)
		})
	};
	if protects(path) {
		return true;
	}
	fs::canonicalize(path)
		.map(|canonical| protects(&canonical))
		.unwrap_or(false)
}

fn referenced_blobs(base: &Path) -> Result<HashSet<String>, String> {
	let mut refs = HashSet::new();
	for entry in fs::read_dir(base)
		.map_err(|error| format!("Could not scan storage references: {error}"))?
	{
		let entry = entry.map_err(|error| format!("Could not scan an internal entry: {error}"))?;
		let name = entry.file_name().to_string_lossy().to_string();
		if !name.starts_with("undo-") {
			continue;
		}
		let path = entry.path();
		let metadata = validate_managed_path_components(base, &path)?;
		if !metadata.is_dir() {
			return Err(format!("Snapshot entry {} is not a safe directory.", path.display()));
		}
		if let Some(marker) = read_marker(&path)? {
			refs.extend(marker.blob_ids);
		}
	}
	Ok(refs)
}

fn garbage_collect_internal(base: &Path) -> Result<(), String> {
	let active = active_paths_snapshot()?;
	let mut candidates = Vec::<(u8, PathBuf)>::new();
	if let Ok(entries) = fs::read_dir(base) {
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan internal snapshots: {error}"))?;
			let path = entry.path();
			let name = entry.file_name().to_string_lossy().to_string();
			if !name.starts_with("undo-") || is_runtime_active(&active, &path) {
				continue;
			}
			let Some(marker) = read_marker(&path)? else {
				continue;
			};
			if let Some(rank) = marker.class.gc_rank() {
				candidates.push((rank, path));
			}
		}
	}
	let files_apply = base.join("files-apply");
	if let Ok(entries) = fs::read_dir(&files_apply) {
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan staging: {error}"))?;
			let path = entry.path();
			if is_runtime_active(&active, &path) {
				continue;
			}
			let metadata = validate_managed_path_components(base, &path)?;
			if !metadata.is_dir() {
				return Err(format!("Staging entry {} is not a safe directory.", path.display()));
			}
			let class = read_marker(&path)?
				.map(|marker| marker.class)
				.unwrap_or(StorageClass::CompletedStaging);
			let rank = match class {
				StorageClass::ActiveStaging => Some(1),
				StorageClass::ActiveUndo | StorageClass::RecoveryCritical => None,
				other => other.gc_rank(),
			};
			if let Some(rank) = rank {
				candidates.push((rank, path));
			}
		}
	}
	let native_drop = base.join("native-drop");
	if let Ok(entries) = fs::read_dir(&native_drop) {
		let now = SystemTime::now();
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan temporary drops: {error}"))?;
			let path = entry.path();
			if is_runtime_active(&active, &path) {
				continue;
			}
			let modified = fs::symlink_metadata(&path)
				.and_then(|metadata| metadata.modified())
				.unwrap_or(now);
			if now.duration_since(modified).unwrap_or_default() >= STALE_NATIVE_DROP_AGE {
				candidates.push((0, path));
			}
		}
	}
	candidates.sort_by_key(|(rank, _)| *rank);
	for (_, candidate) in candidates {
		safe_remove_managed_tree(
			base,
			&candidate,
		)?;
	}

	let refs = referenced_blobs(base)?;
	let blob_root = base.join("blobs");
	if let Ok(entries) = fs::read_dir(&blob_root) {
		for entry in entries {
			let entry = entry.map_err(|error| format!("Could not scan internal blobs: {error}"))?;
			let path = entry.path();
			let name = entry.file_name().to_string_lossy().to_string();
			let Some(blob_id) = name.strip_suffix(".blob") else {
				continue;
			};
			if refs.contains(blob_id) {
				continue;
			}
			let metadata = fs::symlink_metadata(&path)
				.map_err(|error| format!("Could not validate blob {}: {error}", path.display()))?;
			if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
				return Err(format!("Garbage collection rejected an unsafe internal blob at {}.", path.display()));
			}
			fs::remove_file(&path)
				.map_err(|error| format!("Could not remove unreferenced blob {}: {error}", path.display()))?;
		}
	}
	Ok(())
}

pub(crate) fn garbage_collect() -> Result<(), String> {
	let _coordination = storage_coordination()
		.lock()
		.map_err(|_| "The storage manager became unavailable.".to_string())?;
	let base = ensure_storage_base()?;
	garbage_collect_internal(&base)
}

#[cfg(target_os = "windows")]
fn available_space_bytes(path: &Path) -> Result<u64, String> {
	use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
	#[link(name = "kernel32")]
	extern "system" {
		fn GetDiskFreeSpaceExW(
			lp_directory_name: *const u16,
			lp_free_bytes_available_to_caller: *mut u64,
			lp_total_number_of_bytes: *mut u64,
			lp_total_number_of_free_bytes: *mut u64,
		) -> i32;
	}
	fn wide(value: &OsStr) -> Vec<u16> {
		value.encode_wide().chain(std::iter::once(0)).collect()
	}
	let path = wide(path.as_os_str());
	let mut available = 0_u64;
	let mut total = 0_u64;
	let mut free = 0_u64;
	let result = unsafe {
		GetDiskFreeSpaceExW(
			path.as_ptr(),
			&mut available,
			&mut total,
			&mut free,
		)
	};
	if result == 0 {
		Err(format!("Could not query storage free space: {}", std::io::Error::last_os_error()))
	} else {
		Ok(available)
	}
}

#[cfg(unix)]
fn available_space_bytes(path: &Path) -> Result<u64, String> {
	let output = std::process::Command::new("df")
		.arg("-Pk")
		.arg(path)
		.output()
		.map_err(|error| format!("Could not query storage free space: {error}"))?;
	if !output.status.success() {
		return Err("Could not query storage free space.".to_string());
	}
	let text = String::from_utf8_lossy(&output.stdout);
	let line = text
		.lines()
		.filter(|line| !line.trim().is_empty())
		.next_back()
		.ok_or_else(|| "The free-space query returned no data.".to_string())?;
	let columns = line.split_whitespace().collect::<Vec<_>>();
	let available_kib = columns
		.get(columns.len().saturating_sub(3))
		.ok_or_else(|| "The free-space query returned an unexpected format.".to_string())?
		.parse::<u64>()
		.map_err(|_| "The free-space query returned an invalid value.".to_string())?;
	Ok(available_kib.saturating_mul(1024))
}

#[cfg(not(any(target_os = "windows", unix)))]
fn available_space_bytes(_path: &Path) -> Result<u64, String> {
	Err("The current platform does not provide a supported free-space query.".to_string())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::atomic::{AtomicU64, Ordering};

	static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

	struct TestDirectory {
		path: PathBuf,
	}

	impl TestDirectory {
		fn new(label: &str) -> Self {
			let nonce = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
			let path = std::env::temp_dir().join(format!(
				"orqeto-storage-test-{label}-{}-{nonce}",
				std::process::id(),
			));
			fs::create_dir_all(&path).expect("test directory should be created");
			Self { path }
		}
	}

	impl Drop for TestDirectory {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.path);
		}
	}

	#[cfg(windows)]
	#[test]
	fn marker_retry_only_accepts_transient_windows_sharing_violations() {
		assert!(is_transient_windows_marker_error(&std::io::Error::from_raw_os_error(32)));
		assert!(is_transient_windows_marker_error(&std::io::Error::from_raw_os_error(33)));
		assert!(!is_transient_windows_marker_error(&std::io::Error::from_raw_os_error(5)));
	}

	#[test]
	fn br_storage_001_quota_boundaries_and_physical_space_fail_before_reservation() {
		let limits = StorageLimits {
			project_hard_bytes: 100,
			global_hard_bytes: 200,
			soft_numerator: 8,
			soft_denominator: 10,
			free_space_margin_bytes: 10,
		};
		let mut usage = StorageUsage::default();
		usage.global_bytes = 50;
		usage.projects.insert("p".to_string(), 40);
		check_capacity(
			limits,
			&usage,
			0,
			0,
			"p",
			60,
			100,
		)
		.expect("exact project quota should be accepted");
		assert!(check_capacity(
			limits,
			&usage,
			0,
			0,
			"p",
			61,
			100,
		)
		.is_err());
		let mut global_boundary_usage = StorageUsage::default();
		global_boundary_usage.global_bytes = 140;
		check_capacity(
			limits,
			&global_boundary_usage,
			0,
			0,
			"global-boundary",
			60,
			1_000,
		)
		.expect("exact global quota should be accepted");
		assert!(check_capacity(
			limits,
			&global_boundary_usage,
			0,
			0,
			"global-boundary",
			61,
			1_000,
		)
		.is_err());
		assert!(check_capacity(
			limits,
			&usage,
			0,
			0,
			"p",
			60,
			69,
		)
		.is_err());
		assert!(check_capacity(
			limits,
			&StorageUsage::default(),
			40,
			0,
			"p",
			50,
			99,
		)
		.is_err());
		assert_eq!(
			staging_reservation_bytes(50, 2).expect("staging reservation should be bounded"),
			50 + STAGING_METADATA_ALLOWANCE_BYTES + 2 * STAGING_METADATA_ALLOWANCE_PER_FILE_BYTES,
		);
		assert!(!exceeds_soft_threshold(
			limits,
			&usage,
			0,
			0,
			"p",
			39,
		));
		assert!(exceeds_soft_threshold(
			limits,
			&usage,
			0,
			0,
			"p",
			41,
		));
		let mut global_soft_usage = StorageUsage::default();
		global_soft_usage.global_bytes = 150;
		assert!(!exceeds_soft_threshold(
			limits,
			&global_soft_usage,
			0,
			0,
			"global-soft",
			10,
		));
		assert!(exceeds_soft_threshold(
			limits,
			&global_soft_usage,
			0,
			0,
			"global-soft",
			11,
		));
	}

	#[test]
	fn usage_measurement_treats_a_concurrently_removed_entry_as_absent() {
		let test = TestDirectory::new("usage-race");
		let transient = test.path.join("recovery.json");
		fs::write(&transient, "temporary journal").expect("transient journal should be written");
		let stale_entry_path = fs::read_dir(&test.path)
			.expect("test directory should be readable")
			.next()
			.expect("transient journal should be listed")
			.expect("directory entry should be readable")
			.path();
		fs::remove_file(&transient).expect("transient journal should be removed");

		assert!(usage_metadata_no_follow(&stale_entry_path)
			.expect("a vanished usage entry should not fail measurement")
			.is_none());
		assert_eq!(
			directory_size_no_follow(&test.path).expect("the remaining directory should still be measurable"),
			0,
		);
	}

	#[test]
	fn br_gc_001_gc_priority_never_selects_active_or_recovery_critical_data() {
		assert_eq!(StorageClass::RebuildableCache.gc_rank(), Some(0));
		assert_eq!(StorageClass::CompletedStaging.gc_rank(), Some(1));
		assert_eq!(StorageClass::OrdinaryHistory.gc_rank(), Some(2));
		assert_eq!(StorageClass::ActiveUndo.gc_rank(), None);
		assert_eq!(StorageClass::ActiveStaging.gc_rank(), None);
		assert_eq!(StorageClass::RecoveryCritical.gc_rank(), None);
	}

	#[test]
	fn br_storage_002_shared_blob_reference_is_content_addressed_and_stable() {
		let test = TestDirectory::new("blob");
		let source = test.path.join("source.txt");
		fs::write(&source, "same bytes").expect("source should be written");
		let root = fs::canonicalize(&test.path).expect("root should canonicalize");
		let first_snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let second_snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let first = store_stable_backup(&source, &first_snapshot).expect("first backup should be stored");
		let second = store_stable_backup(&source, &second_snapshot).expect("second backup should be stored");
		assert_eq!(first.blob_id, second.blob_id);
		assert_eq!(first.path, second.path);
		assert!(first.path.is_file());
		remove_managed_directory(&first_snapshot).expect("first snapshot should be removed");
		garbage_collect().expect("gc should preserve referenced shared blob");
		assert!(second.path.is_file());
		remove_managed_directory(&second_snapshot).expect("second snapshot should be removed");
		garbage_collect().expect("gc should collect unreferenced blob");
		assert!(!second.path.exists());
	}

	#[test]
	fn br_gc_003_active_descendant_protects_its_managed_ancestor() {
		let process_directory = PathBuf::from("native-drop/process-1");
		let active_drop = process_directory.join("drop-1");
		let mut active = HashSet::new();
		active.insert(active_drop.clone());

		assert!(is_runtime_active(&active, &process_directory));
		assert!(is_runtime_active(&active, &active_drop));
		assert!(is_runtime_active(&active, &active_drop.join("nested")));
		assert!(!is_runtime_active(&active, Path::new("native-drop/process-2")));
	}

	#[test]
	fn br_recovery_005_blob_identity_validation_rejects_tampered_content() {
		let test = TestDirectory::new("blob-tamper");
		let source = test.path.join("source.txt");
		fs::write(
			&source,
			format!("unique recovery bytes for {}", test.path.display()),
		)
		.expect("source should be written");
		let root = fs::canonicalize(&test.path).expect("root should canonicalize");
		let snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let backup = store_stable_backup(&source, &snapshot).expect("backup should be stored");

		fs::write(&backup.path, "tampered bytes").expect("test should tamper with the stored blob");
		assert!(blob_path(&backup.blob_id).is_err());

		remove_managed_directory(&snapshot).expect("snapshot should be removed");
		garbage_collect().expect("gc should collect the unreferenced tampered blob");
	}

	#[test]
	fn br_recovery_001_gc_preserves_recovery_critical_snapshot_and_referenced_blob() {
		let test = TestDirectory::new("recovery-critical");
		let source = test.path.join("source.txt");
		fs::write(&source, "recovery bytes").expect("source should be written");
		let root = fs::canonicalize(&test.path).expect("root should canonicalize");
		let snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let backup = store_stable_backup(&source, &snapshot).expect("backup should be stored");

		garbage_collect().expect("gc should preserve recovery-critical data");
		assert!(snapshot.is_dir());
		assert!(backup.path.is_file());

		remove_managed_directory(&snapshot).expect("snapshot should be removed");
		garbage_collect().expect("gc should collect the unreferenced blob");
	}

	#[cfg(unix)]
	#[test]
	fn br_gc_002_cleanup_refuses_symlink_escape() {
		use std::os::unix::fs::symlink;
		let test = TestDirectory::new("escape");
		let base = test.path.join("base");
		let candidate = base.join("candidate");
		let outside = test.path.join("outside");
		fs::create_dir_all(&candidate).expect("candidate should exist");
		fs::create_dir_all(&outside).expect("outside should exist");
		fs::write(outside.join("keep.txt"), "keep").expect("outside file should exist");
		symlink(&outside, candidate.join("escape")).expect("symlink should be created");
		assert!(safe_remove_managed_tree(&base, &candidate).is_err());
		assert!(outside.join("keep.txt").is_file());
	}


	#[cfg(target_os = "windows")]
	#[test]
	fn br_gc_002_cleanup_refuses_symlink_escape_windows() {
		let test = TestDirectory::new("escape-windows");
		let base = test.path.join("base");
		let candidate = base.join("candidate");
		let outside = test.path.join("outside");
		fs::create_dir_all(&candidate).expect("candidate should exist");
		fs::create_dir_all(&outside).expect("outside should exist");
		fs::write(outside.join("keep.txt"), "keep").expect("outside file should exist");
		let link = candidate.join("escape");
		let status = std::process::Command::new("cmd")
			.args(["/C", "mklink", "/J"])
			.arg(&link)
			.arg(&outside)
			.status()
			.expect("junction command should run");
		if !status.success() {
			return;
		}
		assert!(safe_remove_managed_tree(&base, &candidate).is_err());
		assert!(outside.join("keep.txt").is_file());
	}
}
