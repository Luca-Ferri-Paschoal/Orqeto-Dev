use crate::{
	operation_id::next_operation_id,
	project_ignore::ProjectIgnore,
	resource_limits::{
		machine_resource_policy,
		TraversalBudget,
		TraversalLimitExceeded,
		TraversalLimitKind,
		PROJECT_DISCOVERY_LIMITS,
	},
	safe_fs,
	storage,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	fs::{self, File, OpenOptions},
	io::Read,
	path::{Component, Path, PathBuf},
	sync::{Arc, Mutex, OnceLock},
	time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use zip::ZipArchive;

const MAX_ZIP_ENTRIES: usize = 50_000;
const MAX_ZIP_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_AMBIGUOUS_DESTINATIONS: usize = 10;
const MAX_ROUTING_CANDIDATE_VALIDATIONS: usize = 12;
const MAX_SOURCE_CONTEXT_SEGMENTS: usize = 8;
const ZIP_SOURCE_PREFIX_PENALTY_PER_SEGMENT: usize = 12;
const DELETE_MANIFEST_FILE_NAME: &str = ".orqeto-dev-delete.json";
const DELETE_MANIFEST_FORMAT: &str = "orqeto-dev-delete";
const DELETE_MANIFEST_VERSION: u32 = 1;
const MAX_DELETE_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_DELETE_MANIFEST_PATHS: usize = 10_000;
const MIN_UNDO_HISTORY_ENTRIES: usize = 1;
const MAX_UNDO_HISTORY_ENTRIES: usize = 100;

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayDestinationCandidate {
	destination_relative_path: String,
	source_prefix: String,
	matched_files: usize,
	matched_directories: usize,
	source_context_matches: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareProjectOverlayResult {
	file_count: usize,
	delete_count: usize,
	candidates: Vec<OverlayDestinationCandidate>,
	root_candidate: Option<OverlayDestinationCandidate>,
	recommended_candidate_index: Option<usize>,
	candidate_count: usize,
	ambiguity_limit: usize,
	ambiguity_limit_exceeded: bool,
	source_fingerprint: String,
	routing_fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProjectOverlayResult {
	pub(crate) operation_id: String,
	pub(crate) applied_at_unix_ms: Option<u64>,
	pub(crate) added_files: usize,
	pub(crate) replaced_files: usize,
	pub(crate) deleted_files: usize,
	pub(crate) unchanged_files: usize,
	pub(crate) added_directories: usize,
	pub(crate) replaced_directories: usize,
	pub(crate) deleted_directories: usize,
	pub(crate) unchanged_directories: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoProjectOverlayResult {
	operation_id: String,
	restored_files: usize,
	removed_files: usize,
	undone_batches: usize,
	remaining_history_entries: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayUndoHistoryEntry {
	operation_id: String,
	steps: usize,
	added_files: usize,
	replaced_files: usize,
	deleted_files: usize,
	applied_at_unix_ms: u64,
	source_kind: String,
	source_label: Option<String>,
	added_lines: Option<usize>,
	deleted_lines: Option<usize>,
}

struct ManifestFile {
	relative_path: PathBuf,
	source: ManifestFileSource,
}

enum ManifestFileSource {
	Directory(PathBuf),
	Zip(usize),
}

enum ManifestKind {
	Directory {
		source_root: PathBuf,
		source_context: Vec<String>,
		source_components: Vec<String>,
		source_name: String,
	},
	File {
		source_file: PathBuf,
		source_context: Vec<String>,
		source_components: Vec<String>,
		source_name: String,
	},
	Zip {
		archive_path: PathBuf,
	},
}

struct OverlayManifest {
	kind: ManifestKind,
	files: Vec<ManifestFile>,
	delete_paths: Vec<PathBuf>,
	common_directory_prefixes: Vec<PathBuf>,
}

struct FrozenOverlayInput {
	root: PathBuf,
	manifest: OverlayManifest,
	staging_directory: PathBuf,
}

impl Drop for FrozenOverlayInput {
	fn drop(&mut self) {
		let _ = storage::remove_managed_directory(&self.staging_directory);
	}
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteManifestDocument {
	format: String,
	version: u32,
	delete: Vec<String>,
}

#[derive(Clone)]
struct CandidatePlan {
	candidate: OverlayDestinationCandidate,
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	score: usize,
	mapping_key: Vec<String>,
	is_named_destination: bool,
}

#[derive(Clone)]
struct PlannedFile {
	destination_relative_path: PathBuf,
	source_index: usize,
	was_replaced: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileFingerprint {
	pub(crate) size: u64,
	pub(crate) hash: [u8; 32],
}

#[derive(Clone)]
enum UndoFileKind {
	Created,
	Replaced {
		backup_path: PathBuf,
		backup_blob_id: Option<String>,
	},
}

#[derive(Clone)]
struct UndoFile {
	destination_relative_path: PathBuf,
	kind: UndoFileKind,
	applied_fingerprint: Option<FileFingerprint>,
	recovery_applied: bool,
	recovery_allowed_states: Vec<Option<FileFingerprint>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UndoSourceKind {
	Files,
	Git,
}

impl UndoSourceKind {
	fn as_str(self) -> &'static str {
		match self {
			Self::Files => "files",
			Self::Git => "git",
		}
	}
}

#[derive(Clone)]
pub(crate) struct UndoSnapshot {
	root: PathBuf,
	operation_id: String,
	backup_directories: Vec<PathBuf>,
	files: Vec<UndoFile>,
	created_directories: Vec<PathBuf>,
	applied_at_unix_ms: u64,
	source_kind: UndoSourceKind,
	source_label: Option<String>,
	added_lines: Option<usize>,
	deleted_lines: Option<usize>,
	recovery_after_state_known: bool,
}

static MUTATION_PROTECTION: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn mutation_protection() -> &'static Mutex<Option<String>> {
	MUTATION_PROTECTION.get_or_init(|| Mutex::new(None))
}

fn protect_mutations(reason: String) {
	if let Ok(mut protection) = mutation_protection().lock() {
		*protection = Some(reason);
	}
}

pub(crate) fn protect_after_interrupted_mutation(context: &str) -> String {
	let reason = format!(
		"{context} was interrupted abnormally. New modifications were blocked until the next startup, when Orqeto will attempt to recover any pending journal.",
	);
	protect_mutations(reason.clone());
	reason
}

fn mutation_protection_reason() -> Option<String> {
	mutation_protection()
		.lock()
		.ok()
		.and_then(|protection| protection.clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRecoveryStatus {
	blocked: bool,
}

#[derive(Default)]
struct ProjectAccessState {
	readers: HashMap<PathBuf, usize>,
	writers: HashSet<PathBuf>,
}

pub struct OverlayUndoState {
	histories: Mutex<HashMap<PathBuf, Vec<UndoSnapshot>>>,
	project_access: Arc<Mutex<ProjectAccessState>>,
}

pub(crate) struct ProjectReadGuard {
	root: PathBuf,
	project_access: Arc<Mutex<ProjectAccessState>>,
}

pub(crate) struct ProjectMutationGuard {
	root: PathBuf,
	project_access: Arc<Mutex<ProjectAccessState>>,
}

fn roots_overlap(left: &Path, right: &Path) -> bool {
	left.starts_with(right) || right.starts_with(left)
}

impl Drop for ProjectReadGuard {
	fn drop(&mut self) {
		if let Ok(mut access) = self.project_access.lock() {
			if let Some(count) = access.readers.get_mut(&self.root) {
				*count = count.saturating_sub(1);
				if *count == 0 {
					access.readers.remove(&self.root);
				}
			}
		}
	}
}

impl Drop for ProjectMutationGuard {
	fn drop(&mut self) {
		if let Ok(mut access) = self.project_access.lock() {
			access.writers.remove(&self.root);
		}
	}
}

impl OverlayUndoState {
	pub fn new() -> Self {
		Self {
			histories: Mutex::new(HashMap::new()),
			project_access: Arc::new(Mutex::new(ProjectAccessState::default())),
		}
	}

	pub(crate) fn has_active_mutations(&self) -> bool {
		self.project_access
			.lock()
			.map(|access| !access.writers.is_empty())
			.unwrap_or(true)
	}

	pub(crate) fn is_project_mutating(&self, root: &Path) -> Result<bool, String> {
		let access = self
			.project_access
			.lock()
			.map_err(|_| "The operation coordinator became unavailable.".to_string())?;
		Ok(access.writers.iter().any(|writer| roots_overlap(root, writer)))
	}

	pub(crate) fn begin_project_read(&self, root_folder: &str) -> Result<ProjectReadGuard, String> {
		let root = canonicalize_existing(Path::new(root_folder))?;
		let mut access = self
			.project_access
			.lock()
			.map_err(|_| "The operation coordinator became unavailable.".to_string())?;

		if access.writers.iter().any(|writer| roots_overlap(&root, writer)) {
			return Err(
				"A modification operation is already in progress in this project or an overlapping root.".to_string(),
			);
		}

		*access.readers.entry(root.clone()).or_insert(0) += 1;
		Ok(ProjectReadGuard {
			root,
			project_access: Arc::clone(&self.project_access),
		})
	}

	pub(crate) fn begin_project_mutation(&self, root_folder: &str) -> Result<ProjectMutationGuard, String> {
		if mutation_protection_reason().is_some() {
			return Err(
				"Project modifications are blocked because a previous recovery requires attention. Restart Orqeto after preserving or fixing the files identified in the backup.".to_string(),
			);
		}

		let root = canonicalize_existing(Path::new(root_folder))?;
		let mut access = self
			.project_access
			.lock()
			.map_err(|_| "The operation coordinator became unavailable.".to_string())?;

		let writer_conflict = access.writers.iter().any(|writer| roots_overlap(&root, writer));
		let reader_conflict = access
			.readers
			.iter()
			.any(|(reader, count)| *count > 0 && roots_overlap(&root, reader));
		if writer_conflict || reader_conflict {
			return Err(
				"A read or modification operation is already in progress in this project or an overlapping root.".to_string(),
			);
		}

		access.writers.insert(root.clone());
		Ok(ProjectMutationGuard {
			root,
			project_access: Arc::clone(&self.project_access),
		})
	}
}

impl Drop for OverlayUndoState {
	fn drop(&mut self) {
		let Ok(histories) = self.histories.get_mut() else {
			return;
		};

		for history in histories.values_mut() {
			for snapshot in history.drain(..) {
				discard_snapshot(snapshot);
			}
		}

		histories.clear();
	}
}

const RECOVERY_FILE_NAME: &str = "recovery.json";
const RECOVERY_FORMAT: &str = "orqeto-dev-recovery";
const RECOVERY_VERSION: u32 = 4;
const LEGACY_RECOVERY_VERSION: u32 = 3;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryJournal {
	format: String,
	version: u32,
	root: PathBuf,
	entries: Vec<RecoveryEntry>,
	#[serde(default)]
	created_directories: Vec<PathBuf>,
	#[serde(default)]
	committed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryEntry {
	relative_path: PathBuf,
	existed: bool,
	expected_after: Option<FileFingerprint>,
	after_state_known: bool,
	applied: bool,
	#[serde(default)]
	allowed_states: Vec<Option<FileFingerprint>>,
	#[serde(default)]
	backup_blob_id: Option<String>,
}

fn snapshot_primary_directory(snapshot: &UndoSnapshot) -> Result<&Path, String> {
	snapshot
		.backup_directories
		.first()
		.map(PathBuf::as_path)
		.ok_or_else(|| "The recovery snapshot has no backup folder.".to_string())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PersistenceFailurePoint {
	Snapshot,
	Journal,
}

#[cfg(test)]
std::thread_local! {
	static TEST_PERSISTENCE_FAILURE_POINT: std::cell::Cell<Option<PersistenceFailurePoint>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
struct TestPersistenceFailureGuard;

#[cfg(test)]
impl Drop for TestPersistenceFailureGuard {
	fn drop(&mut self) {
		TEST_PERSISTENCE_FAILURE_POINT.with(|point| point.set(None));
	}
}

#[cfg(test)]
fn fail_next_persistence(point: PersistenceFailurePoint) -> TestPersistenceFailureGuard {
	TEST_PERSISTENCE_FAILURE_POINT.with(|current| current.set(Some(point)));
	TestPersistenceFailureGuard
}

#[cfg(test)]
fn persistence_failure_checkpoint(point: PersistenceFailurePoint) -> Result<(), String> {
	TEST_PERSISTENCE_FAILURE_POINT.with(|current| {
		if current.get() == Some(point) {
			current.set(None);
			Err(match point {
				PersistenceFailurePoint::Snapshot => "Injected test failure while persisting the safety snapshot.",
				PersistenceFailurePoint::Journal => "Injected test failure while persisting the recovery journal.",
			}.to_string())
		} else {
			Ok(())
		}
	})
}

#[cfg(not(test))]
fn persistence_failure_checkpoint(_point: PersistenceFailurePoint) -> Result<(), String> {
	Ok(())
}

fn write_recovery_journal_state(
	snapshot: &UndoSnapshot,
	committed: bool,
) -> Result<(), String> {
	if snapshot.files.is_empty() {
		return Ok(());
	}

	persistence_failure_checkpoint(PersistenceFailurePoint::Journal)?;
	let directory = snapshot_primary_directory(snapshot)?;
	let journal = RecoveryJournal {
		format: RECOVERY_FORMAT.to_string(),
		version: RECOVERY_VERSION,
		root: snapshot.root.clone(),
		entries: snapshot
			.files
			.iter()
			.map(|file| RecoveryEntry {
				relative_path: file.destination_relative_path.clone(),
				existed: matches!(file.kind, UndoFileKind::Replaced { .. }),
				expected_after: file.applied_fingerprint,
				after_state_known: snapshot.recovery_after_state_known,
				applied: file.recovery_applied,
				allowed_states: file.recovery_allowed_states.clone(),
				backup_blob_id: match &file.kind {
					UndoFileKind::Created => None,
					UndoFileKind::Replaced { backup_blob_id, .. } => backup_blob_id.clone(),
				},
			})
			.collect(),
		created_directories: snapshot.created_directories.clone(),
		committed,
	};
	let content = serde_json::to_vec(&journal)
		.map_err(|error| format!("Could not record operation recovery: {error}"))?;
	let path = directory.join(RECOVERY_FILE_NAME);

	safe_fs::atomic_write_bytes(&path, &content)
		.map_err(|error| format!("Could not make the operation recoverable: {error}"))
}

fn write_recovery_journal(snapshot: &UndoSnapshot) -> Result<(), String> {
	write_recovery_journal_state(snapshot, false)
}

#[cfg(test)]
std::thread_local! {
	static TEST_MUTATION_FAILURE_COUNTDOWN: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
struct TestMutationFailureGuard;

#[cfg(test)]
impl Drop for TestMutationFailureGuard {
	fn drop(&mut self) {
		TEST_MUTATION_FAILURE_COUNTDOWN.with(|countdown| countdown.set(None));
	}
}

#[cfg(test)]
fn fail_after_successful_mutations(count: usize) -> TestMutationFailureGuard {
	TEST_MUTATION_FAILURE_COUNTDOWN.with(|countdown| countdown.set(Some(count)));
	TestMutationFailureGuard
}

#[cfg(test)]
fn mutation_failure_checkpoint() -> Result<(), String> {
	TEST_MUTATION_FAILURE_COUNTDOWN.with(|countdown| match countdown.get() {
		None => Ok(()),
		Some(0) => {
			countdown.set(None);
			Err("Injected test failure after a mutation was recorded in the journal.".to_string())
		}
		Some(remaining) => {
			countdown.set(Some(remaining - 1));
			Ok(())
		}
	})
}

#[cfg(not(test))]
fn mutation_failure_checkpoint() -> Result<(), String> {
	Ok(())
}

fn mark_recovery_file_applied(
	snapshot: &mut UndoSnapshot,
	relative_path: &Path,
	state: Option<FileFingerprint>,
	replace_expected_after: bool,
) -> Result<(), String> {
	let file = snapshot
		.files
		.iter_mut()
		.find(|file| file.destination_relative_path == relative_path)
		.ok_or_else(|| "The recovery journal lost an operation file.".to_string())?;

	file.recovery_applied = true;
	if !file.recovery_allowed_states.contains(&state) {
		file.recovery_allowed_states.push(state);
	}
	if replace_expected_after {
		file.applied_fingerprint = state;
	}

	write_recovery_journal(snapshot)
}

fn clear_recovery_journal(snapshot: &UndoSnapshot) -> Result<(), String> {
	if snapshot.backup_directories.is_empty() || snapshot.files.is_empty() {
		return Ok(());
	}

	// Persist the commit decision before removing the journal. If the process or
	// filesystem stops between these two steps, startup sees `committed` and
	// never rolls back an operation that had already crossed its commit point.
	write_recovery_journal_state(snapshot, true)?;
	let path = snapshot_primary_directory(snapshot)?.join(RECOVERY_FILE_NAME);
	match fs::remove_file(&path) {
		Ok(()) => {}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
		// The durable committed marker is already safe. Keeping it is preferable
		// to rolling back a committed operation merely because cleanup failed.
		Err(_) => {}
	}
	for directory in &snapshot.backup_directories {
		storage::set_snapshot_active_undo(directory)?;
	}
	Ok(())
}

fn recovery_current_state(
	root: &Path,
	relative: &Path,
) -> Result<Option<FileFingerprint>, String> {
	let exists = validate_destination_entry(root, relative, false)?;
	if !exists {
		return Ok(None);
	}

	file_fingerprint(&root.join(relative)).map(Some)
}

fn validated_backup_path(
	backup_path: &Path,
	backup_blob_id: Option<&str>,
) -> Result<PathBuf, String> {
	match backup_blob_id {
		Some(blob_id) => storage::blob_path(blob_id),
		None => {
			storage::validate_managed_regular_file(backup_path)?;
			Ok(backup_path.to_path_buf())
		}
	}
}

fn validated_undo_backup_path(kind: &UndoFileKind) -> Result<Option<PathBuf>, String> {
	let UndoFileKind::Replaced { backup_path, backup_blob_id } = kind else {
		return Ok(None);
	};
	validated_backup_path(
		backup_path,
		backup_blob_id.as_deref(),
	)
	.map(Some)
}

fn revalidate_backup_before_commit(
	backup_path: &Path,
	backup_blob_id: Option<&str>,
	expected_fingerprint: FileFingerprint,
) -> std::io::Result<()> {
	let current_path = validated_backup_path(
		backup_path,
		backup_blob_id,
	)
	.map_err(std::io::Error::other)?;
	if current_path != backup_path {
		return Err(std::io::Error::other(
			"the backup path changed before commit",
		));
	}
	let current_fingerprint = file_fingerprint(&current_path)
		.map_err(std::io::Error::other)?;
	if current_fingerprint != expected_fingerprint {
		return Err(std::io::Error::other(
			"the backup content changed before commit",
		));
	}
	Ok(())
}

fn revalidate_undo_backup_before_commit(
	kind: &UndoFileKind,
	backup_path: &Path,
	expected_fingerprint: FileFingerprint,
) -> std::io::Result<()> {
	let UndoFileKind::Replaced { backup_blob_id, .. } = kind else {
		return Err(std::io::Error::other(
			"the snapshot has no replacement backup",
		));
	};
	revalidate_backup_before_commit(
		backup_path,
		backup_blob_id.as_deref(),
		expected_fingerprint,
	)
}

fn revalidate_destination_before_commit(
	root: &Path,
	relative_path: &Path,
	expected_state: Option<FileFingerprint>,
) -> std::io::Result<()> {
	let current = recovery_current_state(
		root,
		relative_path,
	)
	.map_err(std::io::Error::other)?;
	if current != expected_state {
		return Err(std::io::Error::other(
			"the destination changed before the restore commit",
		));
	}
	Ok(())
}

fn restore_recovery_directory(directory: &Path) -> Result<(), String> {
	storage::validate_managed_directory(directory)?;
	let journal_path = directory.join(RECOVERY_FILE_NAME);
	storage::validate_managed_regular_file(&journal_path)?;
	let content = fs::read(&journal_path)
		.map_err(|error| format!("Could not read {}: {error}", journal_path.display()))?;
	let journal: RecoveryJournal = serde_json::from_slice(&content)
		.map_err(|error| format!("The recovery journal is invalid: {error}"))?;

	if journal.format != RECOVERY_FORMAT ||
		!matches!(journal.version, LEGACY_RECOVERY_VERSION | RECOVERY_VERSION)
	{
		return Err("The recovery journal uses an unsupported format or version.".to_string());
	}
	if journal.committed {
		return Ok(());
	}

	let root = canonicalize_existing(&journal.root)?;
	if !root.is_dir() {
		return Err("The project folder required for recovery no longer exists.".to_string());
	}

	for entry in journal.entries.iter().rev() {
		let relative = parse_relative_path(&entry.relative_path.to_string_lossy())?;
		let destination = root.join(&relative);
		let current = recovery_current_state(&root, &relative)?;

		if entry.existed {
			let backup = match entry.backup_blob_id.as_deref() {
				Some(blob_id) => storage::blob_path(blob_id)?,
				None => directory.join("replaced").join(&relative),
			};
			storage::validate_managed_regular_file(&backup).map_err(|error| {
				format!(
					"The backup required to recover {} is not safely available: {error}",
					normalize_relative_display(&relative),
				)
			})?;
			let before = file_fingerprint(&backup)?;

			if current == Some(before) {
				continue;
			}
			if !entry.after_state_known {
				return Err(format!(
					"{} changed during an interrupted operation and the expected final state could not be confirmed. The backup was preserved for manual recovery.",
					normalize_relative_display(&relative),
				));
			}
			let state_is_known = current == entry.expected_after || entry.allowed_states.contains(&current);
			if !state_is_known {
				return Err(format!(
					"{} matches neither the previous state nor the state produced by Orqeto. Automatic recovery was stopped to preserve the external change.",
					normalize_relative_display(&relative),
				));
			}

			let backup_blob_id = entry.backup_blob_id.clone();
			let backup_for_check = backup.clone();
			let expected_destination_state = current;
			safe_fs::atomic_copy_checked(
				&backup,
				&destination,
				|| {
					revalidate_destination_before_commit(
						&root,
						&relative,
						expected_destination_state,
					)?;
					revalidate_backup_before_commit(
						&backup_for_check,
						backup_blob_id.as_deref(),
						before,
					)
				},
			)
			.map_err(|error| format!("Could not recover {}: {error}", destination.display()))?;
			let restored = file_fingerprint(&destination)?;
			if restored != before {
				return Err(format!(
					"Recovery of {} produced bytes different from the validated backup.",
					normalize_relative_display(&relative),
				));
			}
		} else {
			let Some(current) = current else {
				continue;
			};
			if !entry.after_state_known {
				return Err(format!(
					"{} exists after an interrupted operation whose final state could not be confirmed. The file was preserved to prevent data loss.",
					normalize_relative_display(&relative),
				));
			}
			let current_state = Some(current);
			let state_is_known = entry.expected_after == current_state || entry.allowed_states.contains(&current_state);
			if !state_is_known {
				return Err(format!(
					"{} was created or changed outside the expected state. Automatic recovery preserved the file.",
					normalize_relative_display(&relative),
				));
			}

			fs::remove_file(&destination)
				.map_err(|error| format!("Could not recover {}: {error}", destination.display()))?;
		}
	}

	let mut created_directories = journal.created_directories;
	created_directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
	for relative in created_directories {
		let relative = parse_relative_path(&relative.to_string_lossy())?;
		let _ = fs::remove_dir(root.join(relative));
	}

	Ok(())
}

pub fn recover_stale_snapshots() -> Result<(), String> {
	let base = std::env::temp_dir().join("orqeto-dev");
	let Ok(entries) = fs::read_dir(&base) else {
		return Ok(());
	};
	let mut failures = Vec::new();

	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().to_string();
		if !name.starts_with("undo-") {
			continue;
		}

		let directory = entry.path();
		if let Err(error) = storage::validate_managed_directory(&directory) {
			failures.push(format!("{}: {error}", directory.display()));
			continue;
		}
		let journal_path = directory.join(RECOVERY_FILE_NAME);
		match fs::symlink_metadata(&journal_path) {
			Ok(_) => {
				if let Err(error) = restore_recovery_directory(&directory) {
					failures.push(format!("{}: {error}", directory.display()));
					continue;
				}
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
			Err(error) => {
				failures.push(format!(
					"{}: could not validate the recovery journal: {error}",
					directory.display(),
				));
				continue;
			}
		}

		if let Err(error) = storage::remove_managed_directory(&directory) {
			failures.push(format!("{}: {error}", directory.display()));
		}
	}

	if failures.is_empty() {
		storage::garbage_collect()?;
		Ok(())
	} else {
		let reason = format!(
			"Some previous operations require manual recovery and their backups were preserved: {}",
			failures.join(" | "),
		);
		protect_mutations(reason.clone());
		Err(reason)
	}
}

#[tauri::command]
pub fn overlay_recovery_status() -> OverlayRecoveryStatus {
	OverlayRecoveryStatus {
		blocked: mutation_protection_reason().is_some(),
	}
}

fn current_unix_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
		.unwrap_or(0)
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
	fs::canonicalize(path)
		.map_err(|error| format!("Could not access {}: {error}", path.display()))
}

fn ensure_overlay_source_separate(
	root: &Path,
	source: &Path,
) -> Result<(), String> {
	if source.starts_with(root) || root.starts_with(source) {
		return Err(
			"The source used for application must be outside the configured folder.".to_string(),
		);
	}

	Ok(())
}

fn normalize_relative_display(path: &Path) -> String {
	if path.as_os_str().is_empty() {
		return "./".to_string();
	}

	format!("./{}", path.to_string_lossy().replace('\\', "/"))
}

fn insert_parent_directories(
	directories: &mut HashSet<PathBuf>,
	path: &Path,
) {
	let mut parent = path.parent();

	while let Some(directory) = parent {
		if directory.as_os_str().is_empty() || directory == Path::new(".") {
			break;
		}

		directories.insert(directory.to_path_buf());
		parent = directory.parent();
	}
}

fn count_parent_directories<'a>(paths: impl IntoIterator<Item = &'a Path>) -> usize {
	let mut directories = HashSet::new();

	for path in paths {
		insert_parent_directories(
			&mut directories,
			path,
		);
	}

	directories.len()
}

fn normalize_source_prefix(path: &Path) -> String {
	path.to_string_lossy().replace('\\', "/")
}

fn root_lookup_key(path: &Path) -> String {
	let normalized = path
		.to_string_lossy()
		.replace('\\', "/")
		.trim_end_matches('/')
		.to_string();

	#[cfg(target_os = "windows")]
	{
		let normalized = if let Some(value) = normalized.strip_prefix("//?/UNC/") {
			format!("//{value}")
		} else if let Some(value) = normalized.strip_prefix("//?/") {
			value.to_string()
		} else {
			normalized
		};

		return normalized.to_lowercase();
	}

	#[cfg(not(target_os = "windows"))]
	{
		normalized
	}
}

fn parse_relative_path(value: &str) -> Result<PathBuf, String> {
	let normalized = value
		.strip_prefix("./")
		.unwrap_or(value);
	let path = PathBuf::from(normalized);

	for component in path.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("Relative path {value} is invalid."));
		}
	}

	Ok(path)
}

fn parse_delete_manifest_content(
	root: &Path,
	content: &str,
) -> Result<Vec<PathBuf>, String> {
	let document = serde_json::from_str::<DeleteManifestDocument>(content)
		.map_err(|error| format!("File {DELETE_MANIFEST_FILE_NAME} does not contain valid JSON: {error}"))?;

	if document.format != DELETE_MANIFEST_FORMAT || document.version != DELETE_MANIFEST_VERSION {
		return Err(format!(
			"File {DELETE_MANIFEST_FILE_NAME} does not contain the expected format identifier.",
		));
	}

	if document.delete.len() > MAX_DELETE_MANIFEST_PATHS {
		return Err(format!(
			"File {DELETE_MANIFEST_FILE_NAME} contains more than {MAX_DELETE_MANIFEST_PATHS} paths and was rejected.",
		));
	}

	let project_ignore = ProjectIgnore::load(root)?;
	let mut seen = HashSet::new();
	let mut paths = Vec::with_capacity(document.delete.len());

	for value in document.delete {
		let has_invalid_segment = value
			.split('/')
			.any(|segment| segment.is_empty() || segment == "." || segment == "..");

		if value.is_empty() || value.trim() != value || value.contains('\\') || has_invalid_segment {
			return Err(format!(
				"File {DELETE_MANIFEST_FILE_NAME} contains a path outside the expected format: {value}.",
			));
		}

		let relative_path = parse_relative_path(&value)?;

		if relative_path.as_os_str().is_empty() {
			return Err(format!(
				"File {DELETE_MANIFEST_FILE_NAME} contains an empty path.",
			));
		}

		let normalized = value.to_lowercase();

		if !seen.insert(normalized) {
			return Err(format!(
				"File {DELETE_MANIFEST_FILE_NAME} repeats path {value}.",
			));
		}

		let exists = validate_destination_entry(
			root,
			&relative_path,
			false,
		)?;

		if !exists {
			return Err(format!(
				"The file marked for deletion does not exist in the project: {value}.",
			));
		}

		let absolute = canonicalize_existing(&root.join(&relative_path))?;

		if project_ignore.is_ignored(
			&absolute,
			false,
		) {
			return Err(format!(
				"The file marked for deletion is protected by .orqeto-devignore: {value}.",
			));
		}

		if !absolute.starts_with(root) || !absolute.is_file() {
			return Err(format!(
				"The path marked for deletion is not a safe file inside the project: {value}.",
			));
		}

		paths.push(relative_path);
	}

	Ok(paths)
}

fn read_delete_manifest_file(
	root: &Path,
	path: &Path,
) -> Result<Vec<PathBuf>, String> {
	let metadata = fs::metadata(path)
		.map_err(|error| format!("Could not read {DELETE_MANIFEST_FILE_NAME}: {error}"))?;

	if metadata.len() > MAX_DELETE_MANIFEST_BYTES {
		return Err(format!(
			"File {DELETE_MANIFEST_FILE_NAME} exceeds {} KB and was rejected.",
			MAX_DELETE_MANIFEST_BYTES / 1024,
		));
	}

	let content = fs::read_to_string(path)
		.map_err(|error| format!("Could not read {DELETE_MANIFEST_FILE_NAME} as UTF-8: {error}"))?;

	parse_delete_manifest_content(
		root,
		&content,
	)
}

fn normalize_zip_entry_path(path: &Path) -> Result<PathBuf, String> {
	let mut normalized = PathBuf::new();

	for component in path.components() {
		match component {
			Component::Normal(value) => normalized.push(value),
			Component::CurDir => {}
			Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
				return Err(format!(
					"Path {} is not valid inside the ZIP.",
					path.display(),
				));
			}
		}
	}

	Ok(normalized)
}

fn validate_destination_entry(
	root: &Path,
	relative_path: &Path,
	is_directory: bool,
) -> Result<bool, String> {
	if !relative_path.as_os_str().is_empty() {
		safe_fs::validate_project_relative_path(root, relative_path)?;
	}
	let mut current = root.to_path_buf();
	let mut components = relative_path.components().peekable();

	while let Some(component) = components.next() {
		let Component::Normal(name) = component else {
			return Err(format!(
				"Path {} is not valid for application.",
				relative_path.display(),
			));
		};

		current.push(name);
		let is_last = components.peek().is_none();

		match fs::symlink_metadata(&current) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) {
					return Err(format!(
						"Destination {} uses a symbolic link or junction and cannot be overwritten.",
						current.display(),
					));
				}

				if is_last {
					if is_directory {
						if !metadata.is_dir() {
							return Err(format!(
								"Destination {} already exists as a file.",
								current.display(),
							));
						}

						return Ok(false);
					}

					if metadata.is_dir() {
						return Err(format!(
							"Destination {} already exists as a folder.",
							current.display(),
						));
					}

					return Ok(true);
				}

				if !metadata.is_dir() {
					return Err(format!(
						"Path {} blocks creation of the patch structure.",
						current.display(),
					));
				}
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
			Err(error) => {
				return Err(format!(
					"Could not validate destination {}: {error}",
					current.display(),
				));
			}
		}
	}

	Ok(false)
}

fn overlay_traversal_limit_error(
	context: &str,
	error: TraversalLimitExceeded,
) -> String {
	match error.kind {
		TraversalLimitKind::Files => format!(
			"{context} exceeds the limit of {} files per operation.",
			error.limit,
		),
		TraversalLimitKind::Directories => format!(
			"{context} exceeds the limit of {} folders per operation.",
			error.limit,
		),
		TraversalLimitKind::Entries => format!(
			"{context} exceeds the limit of {} traversed entries per operation.",
			error.limit,
		),
		TraversalLimitKind::PathBytes => format!(
			"{context} contains a path longer than the {}-byte safe-discovery limit.",
			error.limit,
		),
		TraversalLimitKind::TotalPathBytes => format!(
			"{context} exceeds the aggregate limit of {} path bytes per operation.",
			error.limit,
		),
	}
}

fn collect_directory_manifest_files(
	source_root: &Path,
	files: &mut Vec<ManifestFile>,
) -> Result<(), String> {
	let resource_policy = machine_resource_policy();
	let root_metadata = fs::symlink_metadata(source_root)
		.map_err(|error| format!("Could not read {}: {error}", source_root.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&root_metadata) || !root_metadata.is_dir() {
		return Err("The selected source must be a safe regular folder.".to_string());
	}

	let mut budget = TraversalBudget::default();
	budget
		.record_path(source_root, PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
	budget
		.record_directory(PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;

	let root_entries = fs::read_dir(source_root)
		.map_err(|error| format!("Could not list {}: {error}", source_root.display()))?;
	let mut stack = Vec::with_capacity(resource_policy.worker_count.saturating_mul(4).max(4));
	stack.push((source_root.to_path_buf(), root_entries));

	while !stack.is_empty() {
		let next = stack
			.last_mut()
			.and_then(|(_, entries)| entries.next());

		let Some(next) = next else {
			stack.pop();
			continue;
		};
		let entry = next.map_err(|error| {
			let directory = stack
				.last()
				.map(|(path, _)| path.as_path())
				.unwrap_or(source_root);
			format!(
				"Could not read an entry from {}: {error}",
				directory.display(),
			)
		})?;
		let path = entry.path();
		budget
			.record_entry(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
		budget
			.record_path(&path, PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;

		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| format!("Could not read {}: {error}", path.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			return Err(format!(
				"Item {} is a symbolic link or junction and cannot be applied.",
				path.display(),
			));
		}

		if metadata.is_file() {
			budget
				.record_file(PROJECT_DISCOVERY_LIMITS)
				.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
			let canonical_path = canonicalize_existing(&path)?;
			if !canonical_path.starts_with(source_root) {
				return Err(format!(
					"Item {} points outside the folder used as the source.",
					path.display(),
				));
			}
			let relative_path = canonical_path
				.strip_prefix(source_root)
				.map_err(|_| "Could not calculate the patch-relative path.".to_string())?
				.to_path_buf();
			files.push(ManifestFile {
				relative_path,
				source: ManifestFileSource::Directory(canonical_path),
			});
			continue;
		}

		if !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				path.display(),
			));
		}

		budget
			.record_directory(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The applied folder", error))?;
		let canonical_path = canonicalize_existing(&path)?;
		if !canonical_path.starts_with(source_root) {
			return Err(format!(
				"Item {} points outside the folder used as the source.",
				path.display(),
			));
		}
		let child_entries = fs::read_dir(&canonical_path)
			.map_err(|error| format!("Could not list {}: {error}", canonical_path.display()))?;
		stack.push((canonical_path, child_entries));
	}

	Ok(())
}

fn path_segments(path: &Path) -> Vec<String> {
	path.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_lowercase()),
			_ => None,
		})
		.collect()
}

fn normal_components(path: &Path) -> Vec<std::ffi::OsString> {
	path.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_os_string()),
			_ => None,
		})
		.collect()
}

fn common_directory_prefixes(files: &[ManifestFile]) -> Vec<PathBuf> {
	let Some(first_file) = files.first() else {
		return Vec::new();
	};
	let first_parent = first_file
		.relative_path
		.parent()
		.unwrap_or_else(|| Path::new(""));
	let common = normal_components(first_parent);
	let mut common_length = common.len();

	for file in &files[1..] {
		let parent = file
			.relative_path
			.parent()
			.unwrap_or_else(|| Path::new(""));
		let segments = normal_components(parent);
		let shared_length = common
			.iter()
			.take(common_length)
			.zip(segments.iter())
			.take_while(|(left, right)| {
				left
					.to_string_lossy()
					.eq_ignore_ascii_case(&right.to_string_lossy())
			})
			.count();

		common_length = shared_length;

		if common_length == 0 {
			break;
		}
	}

	let mut prefixes = Vec::new();
	let mut current = PathBuf::new();

	for segment in common.into_iter().take(common_length) {
		current.push(segment);
		prefixes.push(current.clone());
	}

	prefixes
}

fn build_directory_manifest(
	root: &Path,
	source_path: &Path,
) -> Result<OverlayManifest, String> {
	let source = canonicalize_existing(source_path)?;
	ensure_overlay_source_separate(
		root,
		&source,
	)?;

	let metadata = fs::symlink_metadata(source_path)
		.map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err("Symbolic links and junctions cannot be used as a source.".to_string());
	}

	if !metadata.is_dir() {
		return Err("The selected source is not a folder.".to_string());
	}

	let mut files = Vec::new();
	collect_directory_manifest_files(
		&source,
		&mut files,
	)?;
	let mut delete_paths = Vec::new();
	let mut patch_files = Vec::with_capacity(files.len());
	let mut has_delete_manifest = false;

	for file in files {
		let is_delete_manifest = file
			.relative_path
			.file_name()
			.is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME));

		if !is_delete_manifest {
			patch_files.push(file);
			continue;
		}

		if normal_components(&file.relative_path).len() != 1 {
			return Err(format!(
				"Reserved file {DELETE_MANIFEST_FILE_NAME} must be at the root of the applied folder.",
			));
		}

		if has_delete_manifest {
			return Err(format!(
				"The applied folder contains more than one reserved {DELETE_MANIFEST_FILE_NAME} file.",
			));
		}

		has_delete_manifest = true;
		let ManifestFileSource::Directory(manifest_path) = &file.source else {
			return Err("The deletion manifest was interpreted with an invalid type.".to_string());
		};

		delete_paths = read_delete_manifest_file(
			root,
			manifest_path,
		)?;
	}

	let mut files = patch_files;
	files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

	let source_name = source
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.ok_or_else(|| "Could not determine the applied folder name.".to_string())?;
	let source_components = source
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_string()),
			_ => None,
		})
		.collect::<Vec<_>>();
	let source_context = source_components
		.iter()
		.map(|component| component.to_lowercase())
		.collect::<Vec<_>>();

	Ok(OverlayManifest {
		kind: ManifestKind::Directory {
			source_root: source,
			source_context,
			source_components,
			source_name,
		},
		delete_paths,
		common_directory_prefixes: Vec::new(),
		files,
	})
}

fn build_file_manifest(
	root: &Path,
	source_path: &Path,
) -> Result<OverlayManifest, String> {
	let source = canonicalize_existing(source_path)?;
	ensure_overlay_source_separate(
		root,
		&source,
	)?;

	let metadata = fs::symlink_metadata(source_path)
		.map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err("Symbolic links and junctions cannot be used as a source.".to_string());
	}

	if !metadata.is_file() {
		return Err("The selected source is not a file.".to_string());
	}

	let source_name = source
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.ok_or_else(|| "Could not determine the applied file name.".to_string())?;

	if source_name.eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME) {
		let delete_paths = read_delete_manifest_file(
			root,
			&source,
		)?;

		return Ok(OverlayManifest {
			kind: ManifestKind::File {
				source_file: source,
				source_context: Vec::new(),
				source_components: Vec::new(),
				source_name,
			},
			delete_paths,
			common_directory_prefixes: Vec::new(),
			files: Vec::new(),
		});
	}
	let source_components = source
		.parent()
		.unwrap_or_else(|| Path::new(""))
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_string()),
			_ => None,
		})
		.collect::<Vec<_>>();
	let source_context = source_components
		.iter()
		.map(|component| component.to_lowercase())
		.collect::<Vec<_>>();
	let relative_path = PathBuf::from(&source_name);

	Ok(OverlayManifest {
		kind: ManifestKind::File {
			source_file: source.clone(),
			source_context,
			source_components,
			source_name,
		},
		delete_paths: Vec::new(),
		common_directory_prefixes: Vec::new(),
		files: vec![ManifestFile {
			relative_path,
			source: ManifestFileSource::Directory(source),
		}],
	})
}

fn find_virtual_zip_source(path: &Path) -> Option<(PathBuf, PathBuf)> {
	let mut current = path.parent();

	while let Some(candidate) = current {
		let is_zip = candidate
			.extension()
			.and_then(|extension| extension.to_str())
			.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

		if is_zip && candidate.is_file() {
			let internal_path = path
				.strip_prefix(candidate)
				.ok()?
				.to_path_buf();

			if !internal_path.as_os_str().is_empty() {
				return Some((
					candidate.to_path_buf(),
					internal_path,
				));
			}
		}

		current = candidate.parent();
	}

	None
}

fn path_starts_with_case_insensitive(
	path: &Path,
	prefix: &Path,
) -> bool {
	let path_values = path_segments(path);
	let prefix_values = path_segments(prefix);

	!prefix_values.is_empty() &&
		prefix_values.len() <= path_values.len() &&
		path_values[..prefix_values.len()] == prefix_values
}

fn path_ends_with_case_insensitive(
	path: &Path,
	suffix: &Path,
) -> bool {
	let path_values = path_segments(path);
	let suffix_values = path_segments(suffix);

	if suffix_values.is_empty() || suffix_values.len() > path_values.len() {
		return false;
	}

	path_values[path_values.len() - suffix_values.len()..] == suffix_values
}

fn zip_selection_candidates(files: &[ManifestFile]) -> Vec<PathBuf> {
	let mut values = HashSet::<PathBuf>::new();

	for file in files {
		values.insert(file.relative_path.clone());

		let mut current = file.relative_path.parent();

		while let Some(parent) = current {
			if parent.as_os_str().is_empty() {
				break;
			}

			values.insert(parent.to_path_buf());
			current = parent.parent();
		}
	}

	let mut sorted = values.into_iter().collect::<Vec<_>>();
	sorted.sort();
	sorted
}

fn resolve_zip_selection_prefix(
	files: &[ManifestFile],
	requested_prefix: &Path,
) -> Result<PathBuf, String> {
	let normalized = normalize_zip_entry_path(requested_prefix)?;

	if normalized.as_os_str().is_empty() {
		return Err("The selected subfolder inside the ZIP does not have a valid path.".to_string());
	}

	let has_exact_match = files.iter().any(|file| path_starts_with_case_insensitive(
		&file.relative_path,
		&normalized,
	));

	if has_exact_match {
		return Ok(normalized);
	}

	let suffix_matches = zip_selection_candidates(files)
		.into_iter()
		.filter(|candidate| path_ends_with_case_insensitive(
			candidate,
			&normalized,
		))
		.collect::<Vec<_>>();

	match suffix_matches.as_slice() {
		[only] => Ok(only.clone()),
		[] => Err(format!(
			"Subfolder {} was not found inside the ZIP.",
			requested_prefix.display(),
		)),
		_ => Err(format!(
			"Subfolder {} matches more than one path inside the ZIP. Select a more specific level.",
			requested_prefix.display(),
		)),
	}
}

fn build_zip_manifest(
	root: &Path,
	archive_path: &Path,
	selected_internal_path: Option<&Path>,
) -> Result<OverlayManifest, String> {
	let archive_canonical = canonicalize_existing(archive_path)?;

	if archive_canonical.starts_with(root) {
		return Err("The ZIP file used as the source must be outside the configured folder.".to_string());
	}

	let archive_file = File::open(&archive_canonical)
		.map_err(|error| format!("Could not open {}: {error}", archive_canonical.display()))?;
	let mut archive = ZipArchive::new(archive_file)
		.map_err(|error| format!("File {} is not a valid ZIP: {error}", archive_canonical.display()))?;

	if archive.len() > MAX_ZIP_ENTRIES {
		return Err(format!(
			"The ZIP contains more than {MAX_ZIP_ENTRIES} entries and was rejected.",
		));
	}

	let mut total_uncompressed_bytes = 0_u64;
	let mut seen_paths = HashSet::new();
	let mut file_paths = HashSet::new();
	let mut files = Vec::new();
	let mut delete_paths = Vec::new();

	for index in 0..archive.len() {
		let mut entry = archive
			.by_index(index)
			.map_err(|error| format!("Could not read a ZIP entry: {error}"))?;
		let enclosed_path = entry
			.enclosed_name()
			.ok_or_else(|| format!("The ZIP contains an unsafe path: {}", entry.name()))?;
		let relative_path = normalize_zip_entry_path(&enclosed_path)?;

		if relative_path.as_os_str().is_empty() {
			if entry.is_dir() {
				continue;
			}

			return Err(format!(
				"The ZIP contains an entry without a valid path: {}",
				entry.name(),
			));
		}

		let normalized_path = relative_path
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if seen_paths.contains(&normalized_path) {
			return Err(format!(
				"The ZIP contains the same path more than once: {}",
				entry.name(),
			));
		}

		if entry.encrypted() {
			return Err(format!(
				"The ZIP contains an encrypted entry and cannot be applied: {}",
				entry.name(),
			));
		}

		if entry.is_symlink() {
			return Err(format!(
				"The ZIP contains a symbolic link and cannot be applied: {}",
				entry.name(),
			));
		}

		let mut ancestor = normalized_path.as_str();

		while let Some(separator_index) = ancestor.rfind('/') {
			ancestor = &ancestor[..separator_index];

			if file_paths.contains(ancestor) {
				return Err(format!(
					"The ZIP contains a conflicting structure at {}.",
					entry.name(),
				));
			}
		}

		if entry.is_file() {
			let descendant_prefix = format!("{normalized_path}/");

			if seen_paths
				.iter()
				.any(|path: &String| path.starts_with(&descendant_prefix))
			{
				return Err(format!(
					"The ZIP contains a conflicting structure at {}.",
					entry.name(),
				));
			}
		}

		seen_paths.insert(normalized_path.clone());

		if entry.is_file() {
			file_paths.insert(normalized_path);
		}

		if entry.is_dir() {
			continue;
		}

		if !entry.is_file() {
			return Err(format!(
				"The ZIP contains an unsupported entry: {}",
				entry.name(),
			));
		}

		let is_delete_manifest = relative_path
			.file_name()
			.is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME));

		if is_delete_manifest {
			if normal_components(&relative_path).len() != 1 {
				return Err(format!(
					"Reserved file {DELETE_MANIFEST_FILE_NAME} must be at the root of the ZIP.",
				));
			}

			if selected_internal_path.is_none() {
				if entry.size() > MAX_DELETE_MANIFEST_BYTES {
					return Err(format!(
						"File {DELETE_MANIFEST_FILE_NAME} exceeds {} KB and was rejected.",
						MAX_DELETE_MANIFEST_BYTES / 1024,
					));
				}

				let mut content = String::new();
				entry
					.read_to_string(&mut content)
					.map_err(|error| format!("Could not read {DELETE_MANIFEST_FILE_NAME} as UTF-8: {error}"))?;
				delete_paths = parse_delete_manifest_content(
					root,
					&content,
				)?;
			}

			continue;
		}

		total_uncompressed_bytes = total_uncompressed_bytes
			.checked_add(entry.size())
			.ok_or_else(|| "The uncompressed ZIP size is invalid.".to_string())?;

		if total_uncompressed_bytes > MAX_ZIP_UNCOMPRESSED_BYTES {
			return Err("The ZIP exceeds 1 GB uncompressed and was rejected.".to_string());
		}

		files.push(ManifestFile {
			relative_path,
			source: ManifestFileSource::Zip(index),
		});
	}

	files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

	if let Some(selected_internal_path) = selected_internal_path {
		let selected_prefix = resolve_zip_selection_prefix(
			&files,
			selected_internal_path,
		)?;

		files.retain(|file| path_starts_with_case_insensitive(
			&file.relative_path,
			&selected_prefix,
		));

		if files.is_empty() {
			return Err(format!(
				"Selection {} inside the ZIP contains no files to apply.",
				selected_internal_path.display(),
			));
		}
	}

	let prefixes = common_directory_prefixes(&files);

	Ok(OverlayManifest {
		kind: ManifestKind::Zip {
			archive_path: archive_canonical,
		},
		delete_paths,
		common_directory_prefixes: prefixes,
		files,
	})
}

fn build_manifest(
	root_folder: &str,
	paths: &[String],
) -> Result<(PathBuf, OverlayManifest), String> {
	if paths.len() != 1 {
		return Err("Each application item must be analyzed separately.".to_string());
	}

	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let source_path = PathBuf::from(&paths[0]);

	if let Some((archive_path, internal_path)) = find_virtual_zip_source(&source_path) {
		return Ok((
			root.clone(),
			build_zip_manifest(
				&root,
				&archive_path,
				Some(&internal_path),
			)?,
		));
	}

	let metadata = fs::symlink_metadata(&source_path)
		.map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;

	if safe_fs::metadata_is_link_or_reparse(&metadata) {
		return Err("Symbolic links and junctions cannot be used as a source.".to_string());
	}

	if metadata.is_dir() {
		return Ok((
			root.clone(),
			build_directory_manifest(
				&root,
				&source_path,
			)?,
		));
	}

	if !metadata.is_file() {
		return Err("The Apply area accepts only files, folders, or ZIPs.".to_string());
	}

	let is_zip = source_path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

	if is_zip {
		return Ok((
			root.clone(),
			build_zip_manifest(
				&root,
				&source_path,
				None,
			)?,
		));
	}

	Ok((
		root.clone(),
		build_file_manifest(
			&root,
			&source_path,
		)?,
	))
}

fn create_files_apply_staging_directory(root: &Path) -> Result<PathBuf, String> {
	storage::create_files_apply_staging_directory(root)
}

fn manifest_source_bytes(manifest: &OverlayManifest) -> Result<u64, String> {
	match &manifest.kind {
		ManifestKind::Directory { .. } => {
			let mut total = 0_u64;
			for file in &manifest.files {
				let ManifestFileSource::Directory(source) = &file.source else {
					return Err("The folder source was interpreted with an invalid type.".to_string());
				};
				let metadata = fs::metadata(source)
					.map_err(|error| format!("Could not estimate staging for {}: {error}", source.display()))?;
				total = total
					.checked_add(metadata.len())
					.ok_or_else(|| "Staging size exceeded the numeric limit.".to_string())?;
			}
			Ok(total)
		}
		ManifestKind::File { source_file, .. } => fs::metadata(source_file)
			.map(|metadata| metadata.len())
			.map_err(|error| format!("Could not estimate staging for {}: {error}", source_file.display())),
		ManifestKind::Zip { archive_path } => fs::metadata(archive_path)
			.map(|metadata| metadata.len())
			.map_err(|error| format!("Could not estimate staging for {}: {error}", archive_path.display())),
	}
}

fn freeze_stable_file(
	source: &Path,
	destination: &Path,
) -> Result<FileFingerprint, String> {
	let before = file_fingerprint(source)?;
	safe_fs::atomic_copy_create_new(source, destination)
		.map_err(|error| format!("Could not freeze {}: {error}", source.display()))?;
	let frozen = file_fingerprint(destination)?;
	let after = file_fingerprint(source)?;
	if before != after || before != frozen {
		return Err(format!(
			"{} changed while the source was being frozen. The application was cancelled before changing the project.",
			source.display(),
		));
	}
	Ok(frozen)
}

fn add_frozen_bytes(
	total: &mut u64,
	fingerprint: FileFingerprint,
	reserved_bytes: u64,
) -> Result<(), String> {
	*total = total
		.checked_add(fingerprint.size)
		.ok_or_else(|| "The application staging size is invalid.".to_string())?;
	if *total > reserved_bytes {
		return Err(
			"The source grew beyond reserved storage while being frozen. The application was cancelled before changing the project.".to_string(),
		);
	}
	Ok(())
}

fn freeze_overlay_input(
	root_folder: &str,
	paths: &[String],
) -> Result<FrozenOverlayInput, String> {
	let (root, mut manifest) = build_manifest(
		root_folder,
		paths,
	)?;
	let expected_staging_bytes = manifest_source_bytes(&manifest)?;
	let staging_reservation_bytes = storage::staging_reservation_bytes(
		expected_staging_bytes,
		manifest.files.len(),
	)?;
	let _storage_reservation = storage::reserve(
		&root,
		staging_reservation_bytes,
	)?;
	let staging_directory = create_files_apply_staging_directory(&root)?;
	let result = (|| {
		let mut frozen_bytes = 0_u64;
		match &mut manifest.kind {
			ManifestKind::Directory {
				source_root,
				..
			} => {
				let files_root = safe_fs::create_descendant_directories_no_reparse(
					&staging_directory,
					Path::new("files"),
				)
				.map_err(|error| format!("Could not prepare staging for the applied folder: {error}"))?;
				*source_root = files_root.clone();

				for (index, file) in manifest.files.iter_mut().enumerate() {
					let ManifestFileSource::Directory(source) = &file.source else {
						return Err("The folder source was interpreted with an invalid type.".to_string());
					};
					let source = source.clone();
					let destination = files_root.join(format!("{index:016x}.bin"));
					let fingerprint = freeze_stable_file(
						&source,
						&destination,
					)?;
					add_frozen_bytes(
						&mut frozen_bytes,
						fingerprint,
						expected_staging_bytes,
					)?;
					file.source = ManifestFileSource::Directory(destination);
				}
			}
			ManifestKind::File {
				source_file,
				..
			} => {
				let original = source_file.clone();
				let frozen_file = staging_directory.join("source-file.bin");
				let fingerprint = freeze_stable_file(
					&original,
					&frozen_file,
				)?;
				add_frozen_bytes(
					&mut frozen_bytes,
					fingerprint,
					expected_staging_bytes,
				)?;
				*source_file = frozen_file.clone();
				for file in &mut manifest.files {
					let ManifestFileSource::Directory(_) = &file.source else {
						return Err("The file source was interpreted with an invalid type.".to_string());
					};
					file.source = ManifestFileSource::Directory(frozen_file.clone());
				}
			}
			ManifestKind::Zip { archive_path } => {
				let original = archive_path.clone();
				let frozen_archive = staging_directory.join("source.zip");
				let fingerprint = freeze_stable_file(
					&original,
					&frozen_archive,
				)?;
				add_frozen_bytes(
					&mut frozen_bytes,
					fingerprint,
					expected_staging_bytes,
				)?;
				*archive_path = frozen_archive;
			}
		}

		Ok(FrozenOverlayInput {
			root,
			manifest,
			staging_directory: staging_directory.clone(),
		})
	})();

	if result.is_err() {
		let _ = storage::remove_managed_directory(&staging_directory);
	}

	result
}

struct ProjectRoutingDiscovery {
	directory_matches: HashMap<String, Vec<PathBuf>>,
	file_matches: Vec<PathBuf>,
}

fn routing_scan_io_error(
	path: &Path,
	action: &str,
	error: &std::io::Error,
) -> String {
	format!(
		"Routing was rejected because the project scan could not be completed while {action} {}: {error}",
		path.display(),
	)
}

fn read_routing_directory(path: &Path) -> Result<fs::ReadDir, String> {
	fs::read_dir(path)
		.map_err(|error| routing_scan_io_error(path, "listar", &error))
}

fn collect_project_routing_discovery(
	root: &Path,
	target_names: &HashSet<String>,
	target_file_name: Option<&str>,
	project_ignore: &ProjectIgnore,
) -> Result<ProjectRoutingDiscovery, String> {
	let resource_policy = machine_resource_policy();
	let mut directory_matches = HashMap::<String, Vec<PathBuf>>::new();
	let mut file_matches = Vec::new();
	let mut budget = TraversalBudget::default();
	budget
		.record_path(root, PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The project", error))?;
	budget
		.record_directory(PROJECT_DISCOVERY_LIMITS)
		.map_err(|error| overlay_traversal_limit_error("The project", error))?;

	let root_entries = read_routing_directory(root)?;
	let mut stack = Vec::with_capacity(resource_policy.worker_count.saturating_mul(4).max(4));
	stack.push((root.to_path_buf(), root_entries));

	while !stack.is_empty() {
		let next = stack
			.last_mut()
			.and_then(|(_, entries)| entries.next());

		let Some(next) = next else {
			stack.pop();
			continue;
		};
		let entry = next.map_err(|error| {
			let directory = stack
				.last()
				.map(|(path, _)| path.as_path())
				.unwrap_or(root);
			routing_scan_io_error(directory, "reading an entry from", &error)
		})?;
		let path = entry.path();
		budget
			.record_entry(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The project", error))?;
		budget
			.record_path(&path, PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The project", error))?;

		let metadata = fs::symlink_metadata(&path)
			.map_err(|error| routing_scan_io_error(&path, "validar", &error))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) {
			continue;
		}

		if metadata.is_dir() {
			budget
				.record_directory(PROJECT_DISCOVERY_LIMITS)
				.map_err(|error| overlay_traversal_limit_error("The project", error))?;
			if project_ignore.is_ignored(&path, true) {
				continue;
			}

			let normalized_name = entry
				.file_name()
				.to_string_lossy()
				.to_lowercase();
			if target_names.contains(&normalized_name) {
				let relative = path
					.strip_prefix(root)
					.map_err(|_| "Could not calculate a project-relative destination.".to_string())?
					.to_path_buf();
				directory_matches
					.entry(normalized_name)
					.or_default()
					.push(relative);
			}

			let child_entries = read_routing_directory(&path)?;
			stack.push((path, child_entries));
			continue;
		}

		if !metadata.is_file() {
			continue;
		}
		budget
			.record_file(PROJECT_DISCOVERY_LIMITS)
			.map_err(|error| overlay_traversal_limit_error("The project", error))?;
		if project_ignore.is_ignored(&path, false) {
			continue;
		}

		let matches_target_file = target_file_name.is_some_and(|target_name| {
			entry
				.file_name()
				.to_string_lossy()
				.eq_ignore_ascii_case(target_name)
		});
		if matches_target_file {
			let relative = path
				.strip_prefix(root)
				.map_err(|_| "Could not calculate a project-relative file.".to_string())?
				.to_path_buf();
			file_matches.push(relative);
		}
	}

	for paths in directory_matches.values_mut() {
		paths.sort();
	}
	file_matches.sort();

	Ok(ProjectRoutingDiscovery {
		directory_matches,
		file_matches,
	})
}

fn tail_match_count(
	left: &[String],
	right: &[String],
) -> usize {
	left.iter()
		.rev()
		.zip(right.iter().rev())
		.take_while(|(left_value, right_value)| left_value == right_value)
		.count()
}

fn strip_source_prefix<'a>(
	path: &'a Path,
	prefix: &Path,
) -> Option<&'a Path> {
	if prefix.as_os_str().is_empty() {
		return Some(path);
	}

	path.strip_prefix(prefix).ok()
}

fn count_existing_directory_depth(
	root: &Path,
	destination_relative_path: &Path,
	file_relative_path: &Path,
	project_ignore: &ProjectIgnore,
) -> usize {
	let mut current = root.join(destination_relative_path);
	let Some(parent) = file_relative_path.parent() else {
		return 0;
	};
	let mut count = 0_usize;

	for component in parent.components() {
		let Component::Normal(name) = component else {
			break;
		};

		current.push(name);

		if project_ignore.is_ignored(
			&current,
			true,
		) {
			break;
		}

		match fs::symlink_metadata(&current) {
			Ok(metadata) if metadata.is_dir() && !safe_fs::metadata_is_link_or_reparse(&metadata) => count += 1,
			_ => break,
		}
	}

	count
}

fn build_candidate_plan(
	root: &Path,
	manifest: &OverlayManifest,
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	project_ignore: &ProjectIgnore,
	source_context_matches_override: Option<usize>,
	is_named_destination: bool,
) -> Option<CandidatePlan> {
	let mut mapping_key = Vec::with_capacity(manifest.files.len());
	let mut matched_files = 0_usize;
	let mut matched_directories = 0_usize;

	for file in &manifest.files {
		let stripped = strip_source_prefix(
			&file.relative_path,
			&source_prefix,
		)?;
		if stripped.as_os_str().is_empty() {
			return None;
		}
		let destination_relative = destination_relative_path.join(stripped);
		mapping_key.push(
			destination_relative
				.to_string_lossy()
				.replace('\\', "/")
				.to_lowercase(),
		);

		if validate_destination_entry(
			root,
			&destination_relative,
			false,
		)
		.is_err()
		{
			return None;
		}

		let destination = root.join(&destination_relative);

		if project_ignore.is_ignored(
			&destination,
			false,
		) {
			return None;
		}

		if destination.is_file() {
			matched_files += 1;
		}

		matched_directories += count_existing_directory_depth(
			root,
			&destination_relative_path,
			stripped,
			project_ignore,
		);
	}

	let destination_segments = path_segments(&root.join(&destination_relative_path));
	let source_context_matches = source_context_matches_override.unwrap_or_else(|| {
		match &manifest.kind {
			ManifestKind::Directory { source_context, .. } |
			ManifestKind::File { source_context, .. } => tail_match_count(
				source_context,
				&destination_segments,
			),
			ManifestKind::Zip { .. } => {
				let source_segments = path_segments(&source_prefix);
				tail_match_count(
					&source_segments,
					&destination_segments,
				)
			}
		}
	});
	let directory_score = matched_directories.min(24);
	let named_destination_score = if is_named_destination {
		20
	} else {
		0
	};
	let source_prefix_penalty = normal_components(&source_prefix).len() * ZIP_SOURCE_PREFIX_PENALTY_PER_SEGMENT;
	let score = (
		matched_files * 100 +
			directory_score * 8 +
			source_context_matches * 30 +
			named_destination_score
	)
	.saturating_sub(source_prefix_penalty);

	Some(CandidatePlan {
		candidate: OverlayDestinationCandidate {
			destination_relative_path: normalize_relative_display(&destination_relative_path),
			source_prefix: normalize_source_prefix(&source_prefix),
			matched_files,
			matched_directories,
			source_context_matches,
		},
		destination_relative_path,
		source_prefix,
		score,
		mapping_key,
		is_named_destination,
	})
}

fn candidate_target_names(manifest: &OverlayManifest) -> HashSet<String> {
	let mut names = HashSet::new();

	match &manifest.kind {
		ManifestKind::Directory {
			source_context,
			source_name,
			..
		} => {
			names.insert(source_name.to_lowercase());

			let start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for name in &source_context[start..] {
				names.insert(name.clone());
			}
		}
		ManifestKind::File { source_context, .. } => {
			let start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for name in &source_context[start..] {
				names.insert(name.clone());
			}
		}
		ManifestKind::Zip { .. } => {
			for prefix in &manifest.common_directory_prefixes {
				if let Some(name) = prefix.file_name() {
					names.insert(name.to_string_lossy().to_lowercase());
				}
			}
		}
	}

	names
}

fn deduplicate_candidates(candidates: Vec<CandidatePlan>) -> Vec<CandidatePlan> {
	let mut by_mapping = HashMap::<Vec<String>, CandidatePlan>::new();

	for candidate in candidates {
		match by_mapping.get(&candidate.mapping_key) {
			Some(existing) => {
				let existing_is_exact_root = existing.destination_relative_path.as_os_str().is_empty() &&
					existing.source_prefix.as_os_str().is_empty();
				let candidate_is_exact_root = candidate.destination_relative_path.as_os_str().is_empty() &&
					candidate.source_prefix.as_os_str().is_empty();
				let should_replace = if candidate_is_exact_root {
					!existing_is_exact_root
				} else if existing_is_exact_root {
					false
				} else {
					candidate.score > existing.score
				};

				if should_replace {
					by_mapping.insert(
						candidate.mapping_key.clone(),
						candidate,
					);
				}
			}
			None => {
				by_mapping.insert(
					candidate.mapping_key.clone(),
					candidate,
				);
			}
		}
	}

	let mut values = by_mapping.into_values().collect::<Vec<_>>();
	values.sort_by(|left, right| {
		right
			.score
			.cmp(&left.score)
			.then_with(|| right.candidate.matched_files.cmp(&left.candidate.matched_files))
			.then_with(|| {
				left
					.candidate
					.destination_relative_path
					.cmp(&right.candidate.destination_relative_path)
			})
	});
	values
}

fn is_exact_root_candidate(candidate: &CandidatePlan) -> bool {
	candidate.destination_relative_path.as_os_str().is_empty() &&
		candidate.source_prefix.as_os_str().is_empty()
}

fn minimum_zip_root_file_matches(file_count: usize) -> usize {
	// A multi-file root-relative ZIP can share generic trees such as `src/`
	// with unrelated projects. Require a majority of exact file-path matches,
	// and never let one coincidental file identify a multi-file project.
	match file_count {
		0 => 0,
		1 => 1,
		_ => ((file_count + 1) / 2).max(2),
	}
}

fn has_strong_zip_root_evidence(
	candidate: &CandidatePlan,
	manifest: &OverlayManifest,
) -> bool {
	if !matches!(&manifest.kind, ManifestKind::Zip { .. }) ||
		!is_exact_root_candidate(candidate) ||
		manifest.files.is_empty()
	{
		return false;
	}

	candidate.candidate.matched_files >= minimum_zip_root_file_matches(manifest.files.len())
}

fn complete_exact_zip_root_match_index(
	candidates: &[CandidatePlan],
	manifest: &OverlayManifest,
) -> Option<usize> {
	if !matches!(&manifest.kind, ManifestKind::Zip { .. }) || manifest.files.is_empty() {
		return None;
	}

	candidates.iter().position(|candidate| {
		is_exact_root_candidate(candidate) &&
			candidate.candidate.matched_files == manifest.files.len()
	})
}

fn prune_weak_candidates(
	candidates: Vec<CandidatePlan>,
	manifest: &OverlayManifest,
) -> Vec<CandidatePlan> {
	let strongest_context = candidates
		.iter()
		.filter(|candidate| !is_exact_root_candidate(candidate))
		.map(|candidate| candidate.candidate.source_context_matches)
		.max()
		.unwrap_or(0);
	let minimum_context = if strongest_context >= 3 {
		strongest_context.saturating_sub(1)
	} else {
		strongest_context
	};
	let has_non_root_evidence = candidates.iter().any(|candidate| {
		!is_exact_root_candidate(candidate) &&
			(
				candidate.is_named_destination ||
				candidate.candidate.matched_files > 0 ||
				candidate.candidate.matched_directories > 0 ||
				candidate.candidate.source_context_matches > 0
			)
	});

	candidates
		.into_iter()
		.filter(|candidate| {
			if is_exact_root_candidate(candidate) {
				if matches!(&manifest.kind, ManifestKind::Zip { .. }) {
					return has_strong_zip_root_evidence(
						candidate,
						manifest,
					);
				}

				return candidate.candidate.matched_files > 0 ||
					candidate.candidate.matched_directories > 0 ||
					!has_non_root_evidence;
			}

			if candidate.candidate.matched_files > 0 {
				return true;
			}

			if strongest_context >= 2 {
				return candidate.candidate.source_context_matches >= minimum_context.max(2);
			}

			candidate.is_named_destination ||
				candidate.candidate.source_context_matches > 0 ||
				candidate.candidate.matched_directories > 0
		})
		.collect()
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct CandidateSeed {
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	source_context_matches_override: Option<usize>,
	is_named_destination: bool,
	zip_named_prefix_depth: Option<usize>,
}

struct CandidateBuildResult {
	candidates: Vec<CandidatePlan>,
	discovered_seed_count: usize,
	validation_limit_exceeded: bool,
}

fn deduplicate_candidate_seeds(seeds: Vec<CandidateSeed>) -> Vec<CandidateSeed> {
	let mut unique = HashSet::<CandidateSeed>::new();
	unique.extend(seeds);
	let mut values = unique.into_iter().collect::<Vec<_>>();
	values.sort_by(|left, right| {
		left.destination_relative_path
			.cmp(&right.destination_relative_path)
			.then_with(|| left.source_prefix.cmp(&right.source_prefix))
			.then_with(|| {
				left.source_context_matches_override
					.cmp(&right.source_context_matches_override)
			})
			.then_with(|| left.is_named_destination.cmp(&right.is_named_destination))
			.then_with(|| left.zip_named_prefix_depth.cmp(&right.zip_named_prefix_depth))
	});
	values
}

fn seed_is_exact_root(seed: &CandidateSeed) -> bool {
	seed.destination_relative_path.as_os_str().is_empty() &&
		seed.source_prefix.as_os_str().is_empty()
}

fn candidate_from_seed(
	root: &Path,
	manifest: &OverlayManifest,
	project_ignore: &ProjectIgnore,
	seed: CandidateSeed,
) -> Option<CandidatePlan> {
	let zip_named_prefix_depth = seed.zip_named_prefix_depth;
	let candidate = build_candidate_plan(
		root,
		manifest,
		seed.destination_relative_path,
		seed.source_prefix,
		project_ignore,
		seed.source_context_matches_override,
		seed.is_named_destination,
	)?;

	if let Some(prefix_depth) = zip_named_prefix_depth {
		let has_enough_context = prefix_depth <= 1 ||
			candidate.candidate.source_context_matches >= 2 ||
			candidate.candidate.matched_files > 0 ||
			candidate.candidate.matched_directories >= 2;

		if !has_enough_context {
			return None;
		}
	}

	Some(candidate)
}

fn build_candidates(
	root: &Path,
	manifest: &OverlayManifest,
) -> Result<CandidateBuildResult, String> {
	let target_names = candidate_target_names(manifest);
	let target_file_name = match &manifest.kind {
		ManifestKind::File { source_name, .. } => Some(source_name.as_str()),
		_ => None,
	};
	let project_ignore = ProjectIgnore::load(root)?;
	let discovery = collect_project_routing_discovery(
		root,
		&target_names,
		target_file_name,
		&project_ignore,
	)?;
	let project_matches = &discovery.directory_matches;
	let mut seeds = Vec::new();
	seeds.push(CandidateSeed {
		destination_relative_path: PathBuf::new(),
		source_prefix: PathBuf::new(),
		source_context_matches_override: None,
		is_named_destination: false,
		zip_named_prefix_depth: None,
	});

	match &manifest.kind {
		ManifestKind::Directory {
			source_context,
			source_components,
			source_name,
			..
		} => {
			if let Some(destinations) = project_matches.get(&source_name.to_lowercase()) {
				for destination in destinations {
					seeds.push(CandidateSeed {
						destination_relative_path: destination.clone(),
						source_prefix: PathBuf::new(),
						source_context_matches_override: None,
						is_named_destination: true,
						zip_named_prefix_depth: None,
					});
				}
			}

			let source_end = source_context.len().saturating_sub(1);
			let source_start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for source_index in source_start..source_end {
				let ancestor_name = &source_context[source_index];
				let Some(destinations) = project_matches.get(ancestor_name) else {
					continue;
				};

				for destination in destinations {
					let project_context = path_segments(&root.join(destination));
					let context_matches = tail_match_count(
						&source_context[..=source_index],
						&project_context,
					);

					if context_matches < 2 {
						continue;
					}

					let mut derived_destination = destination.clone();
					for component in &source_components[source_index + 1..] {
						derived_destination.push(component);
					}
					seeds.push(CandidateSeed {
						destination_relative_path: derived_destination,
						source_prefix: PathBuf::new(),
						source_context_matches_override: Some(context_matches),
						is_named_destination: false,
						zip_named_prefix_depth: None,
					});
				}
			}
		}
		ManifestKind::File {
			source_context,
			source_components,
			..
		} => {
			for file_match in &discovery.file_matches {
				let destination = file_match
					.parent()
					.unwrap_or_else(|| Path::new(""))
					.to_path_buf();
				let project_context = path_segments(&root.join(&destination));
				let context_matches = tail_match_count(
					source_context,
					&project_context,
				);
				seeds.push(CandidateSeed {
					destination_relative_path: destination,
					source_prefix: PathBuf::new(),
					source_context_matches_override: Some(context_matches),
					is_named_destination: true,
					zip_named_prefix_depth: None,
				});
			}

			let source_start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);
			for source_index in source_start..source_context.len() {
				let ancestor_name = &source_context[source_index];
				let Some(destinations) = project_matches.get(ancestor_name) else {
					continue;
				};

				for destination in destinations {
					let project_context = path_segments(&root.join(destination));
					let context_matches = tail_match_count(
						&source_context[..=source_index],
						&project_context,
					);
					if context_matches < 2 {
						continue;
					}

					let mut derived_destination = destination.clone();
					for component in &source_components[source_index + 1..] {
						derived_destination.push(component);
					}
					seeds.push(CandidateSeed {
						destination_relative_path: derived_destination,
						source_prefix: PathBuf::new(),
						source_context_matches_override: Some(context_matches),
						is_named_destination: false,
						zip_named_prefix_depth: None,
					});
				}
			}
		}
		ManifestKind::Zip { .. } => {
			for prefix in &manifest.common_directory_prefixes {
				seeds.push(CandidateSeed {
					destination_relative_path: PathBuf::new(),
					source_prefix: prefix.clone(),
					source_context_matches_override: None,
					is_named_destination: false,
					zip_named_prefix_depth: None,
				});

				let prefix_components = normal_components(prefix);
				let prefix_context = prefix_components
					.iter()
					.map(|component| component.to_string_lossy().to_lowercase())
					.collect::<Vec<_>>();
				let prefix_depth = prefix_context.len();
				let Some(name) = prefix.file_name() else {
					continue;
				};
				let normalized_name = name.to_string_lossy().to_lowercase();

				if let Some(destinations) = project_matches.get(&normalized_name) {
					for destination in destinations {
						seeds.push(CandidateSeed {
							destination_relative_path: destination.clone(),
							source_prefix: prefix.clone(),
							source_context_matches_override: None,
							is_named_destination: true,
							zip_named_prefix_depth: Some(prefix_depth),
						});
					}
				}

				for source_index in 0..prefix_context.len() {
					let ancestor_name = &prefix_context[source_index];
					let Some(destinations) = project_matches.get(ancestor_name) else {
						continue;
					};

					for destination in destinations {
						let project_context = path_segments(&root.join(destination));
						let context_matches = tail_match_count(
							&prefix_context[..=source_index],
							&project_context,
						);
						if context_matches < 2 {
							continue;
						}

						let mut derived_destination = destination.clone();
						for component in &prefix_components[source_index + 1..] {
							derived_destination.push(component);
						}
						seeds.push(CandidateSeed {
							destination_relative_path: derived_destination,
							source_prefix: prefix.clone(),
							source_context_matches_override: Some(context_matches),
							is_named_destination: source_index + 1 == prefix_context.len(),
							zip_named_prefix_depth: None,
						});
					}
				}
			}
		}
	}

	let mut seeds = deduplicate_candidate_seeds(seeds);
	let discovered_seed_count = seeds.len();
	let validation_limit_exceeded = discovered_seed_count > MAX_ROUTING_CANDIDATE_VALIDATIONS;

	if validation_limit_exceeded {
		seeds.retain(seed_is_exact_root);
	}

	let candidates = seeds
		.into_iter()
		.filter_map(|seed| candidate_from_seed(
			root,
			manifest,
			&project_ignore,
			seed,
		))
		.collect::<Vec<_>>();

	Ok(CandidateBuildResult {
		candidates: deduplicate_candidates(candidates),
		discovered_seed_count,
		validation_limit_exceeded,
	})
}

fn recommended_candidate_index(
	candidates: &[CandidatePlan],
	manifest: &OverlayManifest,
) -> Option<usize> {
	if matches!(&manifest.kind, ManifestKind::Zip { .. }) && !manifest.files.is_empty() {
		let exact_root_index = candidates.iter().position(|candidate| {
			has_strong_zip_root_evidence(
				candidate,
				manifest,
			)
		});

		if let Some(index) = exact_root_index {
			let root_match_count = candidates[index].candidate.matched_files;
			let has_equal_or_stronger_competitor = candidates
				.iter()
				.enumerate()
				.any(|(candidate_index, candidate)| {
					candidate_index != index &&
						candidate.candidate.matched_files >= root_match_count
				});

			if !has_equal_or_stronger_competitor {
				return Some(index);
			}
		}
	}

	let top = candidates.first()?;
	let second = candidates.get(1);
	let has_evidence = top.candidate.matched_files > 0 ||
		top.candidate.matched_directories > 0 ||
		top.candidate.source_context_matches > 0 ||
		top.is_named_destination;

	if !has_evidence {
		return None;
	}

	let Some(second_candidate) = second else {
		return Some(0);
	};

	if top.candidate.source_context_matches >= 3 &&
		top.candidate.source_context_matches > second_candidate.candidate.source_context_matches
	{
		return Some(0);
	}

	if top.candidate.matched_files >= 2 &&
		top.candidate.matched_files > second_candidate.candidate.matched_files
	{
		return Some(0);
	}

	if top.is_named_destination &&
		!second_candidate.is_named_destination &&
		top.candidate.matched_files >= second_candidate.candidate.matched_files &&
		top.candidate.matched_directories >= second_candidate.candidate.matched_directories
	{
		return Some(0);
	}

	if top.score >= second_candidate.score.saturating_add(40) &&
		(
			top.candidate.matched_files > 0 ||
			top.candidate.source_context_matches >= 2
		)
	{
		return Some(0);
	}

	None
}

fn prepare_overlay_manifest(
	root: &Path,
	manifest: &OverlayManifest,
) -> Result<PrepareProjectOverlayResult, String> {
	let source_fingerprint = manifest_source_fingerprint(manifest)?;

	if manifest.files.is_empty() {
		if manifest.delete_paths.is_empty() {
			return Err("No files were found to apply or delete.".to_string());
		}

		let root_candidate = OverlayDestinationCandidate {
			destination_relative_path: "./".to_string(),
			source_prefix: String::new(),
			matched_files: 0,
			matched_directories: 0,
			source_context_matches: 0,
		};
		let candidates = vec![root_candidate.clone()];
		let routing_fingerprint = overlay_routing_fingerprint(
			root,
			&source_fingerprint,
			&candidates,
			Some(&root_candidate),
			Some(0),
			1,
			false,
		)?;

		return Ok(PrepareProjectOverlayResult {
			file_count: 0,
			delete_count: manifest.delete_paths.len(),
			candidates,
			root_candidate: Some(root_candidate),
			recommended_candidate_index: Some(0),
			candidate_count: 1,
			ambiguity_limit: MAX_AMBIGUOUS_DESTINATIONS,
			ambiguity_limit_exceeded: false,
			source_fingerprint,
			routing_fingerprint,
		});
	}

	let candidate_build = build_candidates(
		root,
		manifest,
	)?;
	let root_candidate = candidate_build
		.candidates
		.iter()
		.find(|candidate| candidate.destination_relative_path.as_os_str().is_empty())
		.map(|candidate| candidate.candidate.clone());
	let mut candidates = prune_weak_candidates(
		candidate_build.candidates,
		manifest,
	);

	let mut recommended = if candidate_build.validation_limit_exceeded {
		// Candidate discovery may overflow because a project contains many
		// repeated generic directory names. That overflow must not hide an
		// independently proven ROOT mapping: every incoming ZIP file already
		// exists at its exact declared ROOT-relative path. Weak alternatives do
		// not need validation to establish that concrete destination.
		complete_exact_zip_root_match_index(
			&candidates,
			manifest,
		)
	} else {
		recommended_candidate_index(
			&candidates,
			manifest,
		)
	};

	if let Some(index) = recommended {
		if index != 0 {
			candidates.swap(
				0,
				index,
			);
			recommended = Some(0);
		}
	}

	let candidate_count = if candidate_build.validation_limit_exceeded {
		candidate_build.discovered_seed_count.max(candidates.len())
	} else {
		candidates.len()
	};
	let unresolved_validation_overflow = candidate_build.validation_limit_exceeded &&
		recommended.is_none();
	let ambiguity_limit_exceeded = unresolved_validation_overflow ||
		(
			recommended.is_none() &&
				candidate_count > MAX_AMBIGUOUS_DESTINATIONS
		);
	let routing_candidates = candidates
		.iter()
		.map(|candidate| candidate.candidate.clone())
		.collect::<Vec<_>>();
	let serialized = if ambiguity_limit_exceeded {
		Vec::new()
	} else {
		routing_candidates
			.iter()
			.take(MAX_AMBIGUOUS_DESTINATIONS)
			.cloned()
			.collect::<Vec<_>>()
	};
	let recommended = recommended.filter(|index| *index < MAX_AMBIGUOUS_DESTINATIONS);
	let routing_fingerprint = overlay_routing_fingerprint(
		root,
		&source_fingerprint,
		&routing_candidates,
		root_candidate.as_ref(),
		recommended,
		candidate_count,
		ambiguity_limit_exceeded,
	)?;

	Ok(PrepareProjectOverlayResult {
		file_count: manifest.files.len(),
		delete_count: manifest.delete_paths.len(),
		candidates: serialized,
		root_candidate,
		recommended_candidate_index: recommended,
		candidate_count,
		ambiguity_limit: MAX_AMBIGUOUS_DESTINATIONS,
		ambiguity_limit_exceeded,
		source_fingerprint,
		routing_fingerprint,
	})
}

fn prepare_project_overlay_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<PrepareProjectOverlayResult, String> {
	let (root, manifest) = build_manifest(
		&root_folder,
		&paths,
	)?;
	prepare_overlay_manifest(
		&root,
		&manifest,
	)
}

fn planned_files(
	root: &Path,
	manifest: &OverlayManifest,
	destination_relative_path: &Path,
	source_prefix: &Path,
) -> Result<Vec<PlannedFile>, String> {
	let destination_base = root.join(destination_relative_path);

	if destination_relative_path.as_os_str().is_empty() {
		if destination_base != root {
			return Err("The calculated root destination is invalid.".to_string());
		}
	} else {
		validate_destination_entry(
			root,
			destination_relative_path,
			true,
		)?;
	}

	if !matches!(&manifest.kind, ManifestKind::Zip { .. }) && !source_prefix.as_os_str().is_empty() {
		return Err("Only ZIP sources accept an internal prefix.".to_string());
	}

	let project_ignore = ProjectIgnore::load(root)?;
	let mut seen_destinations = HashSet::new();
	let mut files = Vec::new();

	for (source_index, file) in manifest.files.iter().enumerate() {
		let stripped = strip_source_prefix(
			&file.relative_path,
			source_prefix,
		)
		.ok_or_else(|| "The selected destination does not match the source structure.".to_string())?;

		if stripped.as_os_str().is_empty() {
			return Err("The selected destination produces an empty file path.".to_string());
		}

		let destination_relative = destination_relative_path.join(stripped);
		let normalized = destination_relative
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if !seen_destinations.insert(normalized) {
			return Err("The application would generate two files at the same path.".to_string());
		}

		let was_replaced = validate_destination_entry(
			root,
			&destination_relative,
			false,
		)?;
		let destination = root.join(&destination_relative);

		if project_ignore.is_ignored(
			&destination,
			false,
		) {
			return Err(format!(
				"Destination {} is protected by .orqeto-devignore and cannot be changed.",
				normalize_relative_display(&destination_relative),
			));
		}

		files.push(PlannedFile {
			destination_relative_path: destination_relative,
			source_index,
			was_replaced,
		});
	}

	Ok(files)
}

fn planned_deletions(
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<Vec<PathBuf>, String> {
	let destinations = planned_files
		.iter()
		.map(|file| {
			file.destination_relative_path
				.to_string_lossy()
				.replace('\\', "/")
				.to_lowercase()
		})
		.collect::<HashSet<_>>();

	for delete_path in &manifest.delete_paths {
		let normalized = delete_path
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if destinations.contains(&normalized) {
			return Err(format!(
				"The patch attempts to apply and delete the same file: {}.",
				normalize_relative_display(delete_path),
			));
		}
	}

	Ok(manifest.delete_paths.clone())
}

fn collect_missing_parent_directories(
	root: &Path,
	files: &[PlannedFile],
) -> Result<Vec<PathBuf>, String> {
	let mut directories = HashSet::new();

	for file in files {
		let Some(parent) = file.destination_relative_path.parent() else {
			continue;
		};
		let mut current = PathBuf::new();

		for component in parent.components() {
			let Component::Normal(name) = component else {
				return Err("The destination structure contains an invalid path.".to_string());
			};

			current.push(name);
			let absolute = root.join(&current);

			match fs::symlink_metadata(&absolute) {
				Ok(metadata) => {
					if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
						return Err(format!(
							"Path {} cannot receive the patch.",
							absolute.display(),
						));
					}
				}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					directories.insert(current.clone());
				}
				Err(error) => {
					return Err(format!(
						"Could not validate {}: {error}",
						absolute.display(),
					));
				}
			}
		}
	}

	let mut values = directories.into_iter().collect::<Vec<_>>();
	values.sort_by_key(|path| path.components().count());
	Ok(values)
}

fn create_backup_directory(root: &Path) -> Result<PathBuf, String> {
	persistence_failure_checkpoint(PersistenceFailurePoint::Snapshot)?;
	storage::create_snapshot_directory(root)
}

fn reader_fingerprint<R: Read>(
	reader: &mut R,
	label: &str,
) -> Result<FileFingerprint, String> {
	let mut buffer = vec![0_u8; machine_resource_policy().stream_buffer_bytes];
	let mut size = 0_u64;
	let mut hasher = Sha256::new();

	loop {
		let read = reader
			.read(&mut buffer)
			.map_err(|error| format!("Could not verify {label}: {error}"))?;

		if read == 0 {
			break;
		}

		size = size
			.checked_add(read as u64)
			.ok_or_else(|| "The verified file size is invalid.".to_string())?;
		hasher.update(&buffer[..read]);
	}

	let digest = hasher.finalize();
	let mut hash = [0_u8; 32];
	hash.copy_from_slice(&digest);

	Ok(FileFingerprint { size, hash })
}

pub(crate) fn file_fingerprint(path: &Path) -> Result<FileFingerprint, String> {
	let mut file = File::open(path)
		.map_err(|error| format!("Could not verify {}: {error}", path.display()))?;

	reader_fingerprint(
		&mut file,
		&path.display().to_string(),
	)
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

fn hash_field(hasher: &mut Sha256, value: &[u8]) {
	hasher.update((value.len() as u64).to_le_bytes());
	hasher.update(value);
}

fn hash_path_field(hasher: &mut Sha256, path: &Path) {
	hash_field(
		hasher,
		path.to_string_lossy().replace('\\', "/").as_bytes(),
	);
}

fn hash_file_fingerprint(hasher: &mut Sha256, fingerprint: FileFingerprint) {
	hasher.update(fingerprint.size.to_le_bytes());
	hasher.update(fingerprint.hash);
}

fn manifest_source_fingerprint(manifest: &OverlayManifest) -> Result<String, String> {
	let mut hasher = Sha256::new();
	hash_field(&mut hasher, b"orqeto-overlay-source-v1");

	match &manifest.kind {
		ManifestKind::Directory { .. } => hash_field(&mut hasher, b"directory"),
		ManifestKind::File { .. } => hash_field(&mut hasher, b"file"),
		ManifestKind::Zip { .. } => hash_field(&mut hasher, b"zip"),
	}

	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => {
			for file in &manifest.files {
				hash_path_field(&mut hasher, &file.relative_path);
				let ManifestFileSource::Directory(source) = &file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				hash_file_fingerprint(&mut hasher, file_fingerprint(source)?);
			}
		}
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;

			for file in &manifest.files {
				hash_path_field(&mut hasher, &file.relative_path);
				let ManifestFileSource::Zip(index) = &file.source else {
					return Err("The ZIP source was interpreted with an invalid type.".to_string());
				};
				let mut source = archive
					.by_index(*index)
					.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;
				let label = format!("ZIP entry {}", file.relative_path.display());
				hash_file_fingerprint(
					&mut hasher,
					reader_fingerprint(&mut source, &label)?,
				);
			}
		}
	}

	let mut delete_paths = manifest.delete_paths.clone();
	delete_paths.sort();
	for path in delete_paths {
		hash_field(&mut hasher, b"delete");
		hash_path_field(&mut hasher, &path);
	}

	Ok(encode_hex(&hasher.finalize()))
}

fn hash_candidate(hasher: &mut Sha256, candidate: &OverlayDestinationCandidate) {
	hash_field(hasher, candidate.destination_relative_path.as_bytes());
	hash_field(hasher, candidate.source_prefix.as_bytes());
	hasher.update((candidate.matched_files as u64).to_le_bytes());
	hasher.update((candidate.matched_directories as u64).to_le_bytes());
	hasher.update((candidate.source_context_matches as u64).to_le_bytes());
}

fn overlay_routing_fingerprint(
	root: &Path,
	source_fingerprint: &str,
	candidates: &[OverlayDestinationCandidate],
	root_candidate: Option<&OverlayDestinationCandidate>,
	recommended_candidate_index: Option<usize>,
	candidate_count: usize,
	ambiguity_limit_exceeded: bool,
) -> Result<String, String> {
	let mut hasher = Sha256::new();
	hash_field(&mut hasher, b"orqeto-overlay-routing-v1");
	hash_path_field(&mut hasher, root);
	hash_field(&mut hasher, source_fingerprint.as_bytes());

	let ignore_path = root.join(".orqeto-devignore");
	match fs::read(&ignore_path) {
		Ok(content) => {
			hash_field(&mut hasher, b"ignore-present");
			hash_field(&mut hasher, &content);
		}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			hash_field(&mut hasher, b"ignore-absent");
		}
		Err(error) => {
			return Err(format!(
				"Could not verify .orqeto-devignore during routing: {error}",
			));
		}
	}

	hasher.update((candidate_count as u64).to_le_bytes());
	hasher.update([u8::from(ambiguity_limit_exceeded)]);
	match recommended_candidate_index {
		Some(index) => {
			hasher.update([1]);
			hasher.update((index as u64).to_le_bytes());
		}
		None => hasher.update([0]),
	}

	match root_candidate {
		Some(candidate) => {
			hasher.update([1]);
			hash_candidate(&mut hasher, candidate);
		}
		None => hasher.update([0]),
	}

	for candidate in candidates {
		hash_candidate(&mut hasher, candidate);
	}

	Ok(encode_hex(&hasher.finalize()))
}

fn planned_source_fingerprints(
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<Vec<FileFingerprint>, String> {
	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => planned_files
			.iter()
			.map(|planned| {
				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
				let ManifestFileSource::Directory(source) = &manifest_file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				file_fingerprint(source)
			})
			.collect(),
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;
			let mut fingerprints = Vec::with_capacity(planned_files.len());

			for planned in planned_files {
				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The ZIP source file is no longer available.".to_string())?;
				let ManifestFileSource::Zip(index) = &manifest_file.source else {
					return Err("The ZIP source was interpreted with an invalid type.".to_string());
				};
				let mut source = archive
					.by_index(*index)
					.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;
				fingerprints.push(reader_fingerprint(
					&mut source,
					&format!("ZIP entry {}", manifest_file.relative_path.display()),
				)?);
			}

			Ok(fingerprints)
		}
	}
}

fn readers_are_equal<L: Read, R: Read>(
	left: &mut L,
	right: &mut R,
	left_label: &str,
	right_label: &str,
) -> Result<bool, String> {
	let buffer_bytes = machine_resource_policy().stream_buffer_bytes;
	let mut left_buffer = vec![0_u8; buffer_bytes];
	let mut right_buffer = vec![0_u8; buffer_bytes];

	loop {
		let left_read = left
			.read(&mut left_buffer)
			.map_err(|error| format!("Could not verify {left_label}: {error}"))?;
		let right_read = right
			.read(&mut right_buffer)
			.map_err(|error| format!("Could not verify {right_label}: {error}"))?;

		if left_read != right_read {
			return Ok(false);
		}

		if left_read == 0 {
			return Ok(true);
		}

		if left_buffer[..left_read] != right_buffer[..right_read] {
			return Ok(false);
		}
	}
}

fn files_are_equal(
	left_path: &Path,
	right_path: &Path,
) -> Result<bool, String> {
	let left_metadata = fs::metadata(left_path)
		.map_err(|error| format!("Could not verify {}: {error}", left_path.display()))?;
	let right_metadata = fs::metadata(right_path)
		.map_err(|error| format!("Could not verify {}: {error}", right_path.display()))?;

	if left_metadata.len() != right_metadata.len() {
		return Ok(false);
	}

	let mut left = File::open(left_path)
		.map_err(|error| format!("Could not verify {}: {error}", left_path.display()))?;
	let mut right = File::open(right_path)
		.map_err(|error| format!("Could not verify {}: {error}", right_path.display()))?;

	readers_are_equal(
		&mut left,
		&mut right,
		&left_path.display().to_string(),
		&right_path.display().to_string(),
	)
}

fn filter_unchanged_planned_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: Vec<PlannedFile>,
) -> Result<(Vec<PlannedFile>, Vec<PathBuf>), String> {
	let mut changed = Vec::with_capacity(planned_files.len());
	let mut unchanged_paths = Vec::new();

	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => {
			for planned in planned_files {
				if !planned.was_replaced {
					changed.push(planned);
					continue;
				}

				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
				let ManifestFileSource::Directory(source) = &manifest_file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				let destination = root.join(&planned.destination_relative_path);

				if files_are_equal(
					source,
					&destination,
				)? {
					unchanged_paths.push(planned.destination_relative_path);
				} else {
					changed.push(planned);
				}
			}
		}
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;

			for planned in planned_files {
				if !planned.was_replaced {
					changed.push(planned);
					continue;
				}

				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The ZIP source file is no longer available.".to_string())?;
				let ManifestFileSource::Zip(index) = &manifest_file.source else {
					return Err("The ZIP source was interpreted with an invalid type.".to_string());
				};
				let mut source = archive
					.by_index(*index)
					.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;
				let destination = root.join(&planned.destination_relative_path);
				let destination_metadata = fs::metadata(&destination)
					.map_err(|error| format!("Could not verify {}: {error}", destination.display()))?;

				if source.size() != destination_metadata.len() {
					changed.push(planned);
					continue;
				}

				let mut destination_file = File::open(&destination)
					.map_err(|error| format!("Could not verify {}: {error}", destination.display()))?;
				let source_label = format!("ZIP entry {}", manifest_file.relative_path.display());

				if readers_are_equal(
					&mut source,
					&mut destination_file,
					&source_label,
					&destination.display().to_string(),
				)? {
					unchanged_paths.push(planned.destination_relative_path);
				} else {
					changed.push(planned);
				}
			}
		}
	}

	Ok((
		changed,
		unchanged_paths,
	))
}

fn estimate_snapshot_backup_bytes(
	root: &Path,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
) -> Result<u64, String> {
	let replaced_paths = planned_files
		.iter()
		.filter(|file| file.was_replaced)
		.map(|file| file.destination_relative_path.as_path())
		.chain(delete_paths.iter().map(PathBuf::as_path));
	let mut total = 0_u64;
	for relative_path in replaced_paths {
		let source = root.join(relative_path);
		let metadata = fs::symlink_metadata(&source)
			.map_err(|error| format!("Could not estimate the snapshot for {}: {error}", source.display()))?;
		if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
			return Err(format!("{} cannot be preserved in a safe snapshot.", source.display()));
		}
		total = total
			.checked_add(metadata.len())
			.ok_or_else(|| "The size required for the snapshot exceeded the numeric limit.".to_string())?;
	}
	Ok(total)
}

fn backup_replaced_files(
	root: &Path,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
	backup_directory: &Path,
) -> Result<HashMap<PathBuf, storage::StoredBackup>, String> {
	let replaced_paths = planned_files
		.iter()
		.filter(|file| file.was_replaced)
		.map(|file| file.destination_relative_path.clone())
		.chain(delete_paths.iter().cloned());
	let mut backups = HashMap::new();

	for relative_path in replaced_paths {
		let source = root.join(&relative_path);
		let backup = storage::store_stable_backup(
			&source,
			backup_directory,
		)
		.map_err(|error| format!("Could not save {} in the snapshot: {error}", source.display()))?;
		backups.insert(relative_path, backup);
	}

	Ok(backups)
}

fn validate_original_state(
	root: &Path,
	relative_path: &Path,
	kind: &UndoFileKind,
) -> Result<(), String> {
	let destination = root.join(relative_path);
	let exists = validate_destination_entry(root, relative_path, false)?;

	match kind {
		UndoFileKind::Created => {
			if exists {
				return Err(format!(
					"{} appeared after analysis. The operation was cancelled to preserve the external change.",
					normalize_relative_display(relative_path),
				));
			}
		}
		UndoFileKind::Replaced { .. } => {
			if !exists {
				return Err(format!(
					"{} was removed after analysis. The operation was cancelled.",
					normalize_relative_display(relative_path),
				));
			}
			let backup_path = validated_undo_backup_path(kind)?
				.ok_or_else(|| "The replacement snapshot lost the required backup.".to_string())?;
			let expected = file_fingerprint(&backup_path)?;
			let current = file_fingerprint(&destination)?;
			if expected != current {
				return Err(format!(
					"{} changed after analysis. The operation was cancelled to preserve the external change.",
					normalize_relative_display(relative_path),
				));
			}
		}
	}

	Ok(())
}

fn delete_manifest_files(
	root: &Path,
	delete_paths: &[PathBuf],
	snapshot: &mut UndoSnapshot,
) -> Result<(), String> {
	for relative_path in delete_paths {
		{
			let file = snapshot
				.files
				.iter()
				.find(|file| file.destination_relative_path == *relative_path)
				.ok_or_else(|| "The deletion plan lost its safety snapshot.".to_string())?;
			validate_original_state(root, relative_path, &file.kind)?;
		}
		let destination = root.join(relative_path);

		fs::remove_file(&destination)
			.map_err(|error| format!("Could not delete {}: {error}", destination.display()))?;
		mark_recovery_file_applied(
			snapshot,
			relative_path,
			None,
			true,
		)?;
		mutation_failure_checkpoint()?;
	}

	Ok(())
}

fn write_directory_manifest_file(
	root: &Path,
	manifest: &OverlayManifest,
	planned: &PlannedFile,
	destination: &Path,
	original_kind: &UndoFileKind,
) -> Result<(), String> {
	let file = manifest
		.files
		.get(planned.source_index)
		.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
	let ManifestFileSource::Directory(source) = &file.source else {
		return Err("The patch source was interpreted with an invalid type.".to_string());
	};

	safe_fs::create_project_parent_directories(
		root,
		&planned.destination_relative_path,
	)
	.map_err(|error| {
		format!(
			"Could not safely prepare the directory for {}: {error}",
			destination.display(),
		)
	})?;

	let validate_commit = || {
		validate_original_state(
			root,
			&planned.destination_relative_path,
			original_kind,
		)
		.map_err(std::io::Error::other)
	};
	let result = if planned.was_replaced {
		safe_fs::atomic_copy_preserve_destination_checked(
			source,
			destination,
			validate_commit,
		)
	} else {
		safe_fs::atomic_copy_create_new_checked(
			source,
			destination,
			validate_commit,
		)
	};
	result.map_err(|error| {
		format!(
			"Could not apply {} to {}: {error}",
			source.display(),
			destination.display(),
		)
	})?;
	Ok(())
}

fn write_zip_manifest_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
	snapshot: &mut UndoSnapshot,
) -> Result<(), String> {
	let ManifestKind::Zip { archive_path } = &manifest.kind else {
		return Err("The ZIP source was interpreted with an invalid type.".to_string());
	};
	let archive_file = File::open(archive_path)
		.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
	let mut archive = ZipArchive::new(archive_file)
		.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;

	for planned in planned_files {
		let manifest_file = manifest
			.files
			.get(planned.source_index)
			.ok_or_else(|| "The ZIP source file is no longer available.".to_string())?;
		let ManifestFileSource::Zip(index) = &manifest_file.source else {
			return Err("The ZIP source was interpreted with an invalid type.".to_string());
		};
		let (expected_fingerprint, original_kind) = {
			let snapshot_file = snapshot
				.files
				.iter()
				.find(|file| file.destination_relative_path == planned.destination_relative_path)
				.ok_or_else(|| "The application plan lost its safety snapshot.".to_string())?;
			validate_original_state(root, &planned.destination_relative_path, &snapshot_file.kind)?;
			(
				snapshot_file.applied_fingerprint,
				snapshot_file.kind.clone(),
			)
		};
		let destination = root.join(&planned.destination_relative_path);
		safe_fs::create_project_parent_directories(
			root,
			&planned.destination_relative_path,
		)
		.map_err(|error| {
			format!(
				"Could not safely prepare the directory for {}: {error}",
				destination.display(),
			)
		})?;
		let mut source = archive
			.by_index(*index)
			.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;

		let validate_commit = || {
			validate_original_state(
				root,
				&planned.destination_relative_path,
				&original_kind,
			)
			.map_err(std::io::Error::other)
		};
		let result = if planned.was_replaced {
			safe_fs::atomic_write_from_reader_checked(
				&destination,
				&mut source,
				validate_commit,
			)
		} else {
			safe_fs::atomic_write_from_reader_create_new_checked(
				&destination,
				&mut source,
				validate_commit,
			)
		};
		result.map_err(|error| format!("Could not write {}: {error}", destination.display()))?;

		let actual_fingerprint = file_fingerprint(&destination)?;
		mark_recovery_file_applied(
			snapshot,
			&planned.destination_relative_path,
			Some(actual_fingerprint),
			true,
		)?;
		mutation_failure_checkpoint()?;
		if expected_fingerprint != Some(actual_fingerprint) {
			return Err(format!(
				"The source entry for {} changed during application. The operation was stopped to avoid writing content different from what was validated.",
				normalize_relative_display(&planned.destination_relative_path),
			));
		}
	}

	Ok(())
}

fn write_manifest_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
	snapshot: &mut UndoSnapshot,
) -> Result<(), String> {
	match &manifest.kind {
		ManifestKind::Directory { source_root, .. } => {
			if !source_root.is_dir() {
				return Err("The folder used as the source is no longer available.".to_string());
			}

			for planned in planned_files {
				let (expected_fingerprint, original_kind) = {
					let snapshot_file = snapshot
						.files
						.iter()
						.find(|file| file.destination_relative_path == planned.destination_relative_path)
						.ok_or_else(|| "The application plan lost its safety snapshot.".to_string())?;
					validate_original_state(root, &planned.destination_relative_path, &snapshot_file.kind)?;
					(
						snapshot_file.applied_fingerprint,
						snapshot_file.kind.clone(),
					)
				};
				let destination = root.join(&planned.destination_relative_path);
				write_directory_manifest_file(
					root,
					manifest,
					planned,
					&destination,
					&original_kind,
				)?;
				let actual_fingerprint = file_fingerprint(&destination)?;
				mark_recovery_file_applied(
					snapshot,
					&planned.destination_relative_path,
					Some(actual_fingerprint),
					true,
				)?;
				mutation_failure_checkpoint()?;
				if expected_fingerprint != Some(actual_fingerprint) {
					return Err(format!(
						"The source for {} changed during application. The operation was stopped to preserve the validated version.",
						normalize_relative_display(&planned.destination_relative_path),
					));
				}
			}
		}
		ManifestKind::File { source_file, .. } => {
			if !source_file.is_file() {
				return Err("The file used as the source is no longer available.".to_string());
			}

			for planned in planned_files {
				let (expected_fingerprint, original_kind) = {
					let snapshot_file = snapshot
						.files
						.iter()
						.find(|file| file.destination_relative_path == planned.destination_relative_path)
						.ok_or_else(|| "The application plan lost its safety snapshot.".to_string())?;
					validate_original_state(root, &planned.destination_relative_path, &snapshot_file.kind)?;
					(
						snapshot_file.applied_fingerprint,
						snapshot_file.kind.clone(),
					)
				};
				let destination = root.join(&planned.destination_relative_path);
				write_directory_manifest_file(
					root,
					manifest,
					planned,
					&destination,
					&original_kind,
				)?;
				let actual_fingerprint = file_fingerprint(&destination)?;
				mark_recovery_file_applied(
					snapshot,
					&planned.destination_relative_path,
					Some(actual_fingerprint),
					true,
				)?;
				mutation_failure_checkpoint()?;
				if expected_fingerprint != Some(actual_fingerprint) {
					return Err(format!(
						"The source for {} changed during application. The operation was stopped to preserve the validated version.",
						normalize_relative_display(&planned.destination_relative_path),
					));
				}
			}
		}
		ManifestKind::Zip { .. } => write_zip_manifest_files(
			root,
			manifest,
			planned_files,
			snapshot,
		)?,
	}

	Ok(())
}

fn build_undo_snapshot(
	root: &Path,
	operation_id: String,
	applied_at_unix_ms: u64,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
	created_directories: Vec<PathBuf>,
	backup_directory: PathBuf,
	backups: &HashMap<PathBuf, storage::StoredBackup>,
) -> Result<UndoSnapshot, String> {
	let mut files = Vec::new();

	for planned in planned_files {
		let destination = root.join(&planned.destination_relative_path);
		let applied_fingerprint = Some(file_fingerprint(&destination)?);
		let kind = if planned.was_replaced {
			let backup = backups
				.get(&planned.destination_relative_path)
				.ok_or_else(|| "The snapshot lost a replaced-file backup.".to_string())?;
			UndoFileKind::Replaced {
				backup_path: backup.path.clone(),
				backup_blob_id: Some(backup.blob_id.clone()),
			}
		} else {
			UndoFileKind::Created
		};

		files.push(UndoFile {
			destination_relative_path: planned.destination_relative_path.clone(),
			kind,
			applied_fingerprint,
			recovery_applied: true,
			recovery_allowed_states: vec![applied_fingerprint],
		});
	}

	for delete_path in delete_paths {
		let backup = backups
			.get(delete_path)
			.ok_or_else(|| "The snapshot lost a deleted-file backup.".to_string())?;
		files.push(UndoFile {
			destination_relative_path: delete_path.clone(),
			kind: UndoFileKind::Replaced {
				backup_path: backup.path.clone(),
				backup_blob_id: Some(backup.blob_id.clone()),
			},
			applied_fingerprint: None,
			recovery_applied: true,
			recovery_allowed_states: vec![None],
		});
	}

	Ok(UndoSnapshot {
		root: root.to_path_buf(),
		operation_id,
		backup_directories: vec![backup_directory],
		files,
		created_directories,
		applied_at_unix_ms,
		source_kind: UndoSourceKind::Files,
		source_label: None,
		added_lines: None,
		deleted_lines: None,
		recovery_after_state_known: true,
	})
}

fn remove_empty_created_directories(
	root: &Path,
	created_directories: &[PathBuf],
) {
	let mut directories = created_directories.to_vec();
	directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

	for relative in directories {
		let absolute = root.join(relative);
		let _ = fs::remove_dir(absolute);
	}
}

fn rollback_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	let mut failures = Vec::new();

	for file in snapshot.files.iter().rev() {
		let destination = snapshot.root.join(&file.destination_relative_path);
		let current = match recovery_current_state(&snapshot.root, &file.destination_relative_path) {
			Ok(state) => state,
			Err(error) => {
				failures.push(format!("{}: {error}", destination.display()));
				continue;
			}
		};

		let result = match &file.kind {
			UndoFileKind::Created => match current {
				None => Ok(()),
				Some(current_fingerprint)
					if file.recovery_applied &&
						snapshot.recovery_after_state_known &&
						(file.applied_fingerprint == Some(current_fingerprint) ||
							file.recovery_allowed_states.contains(&Some(current_fingerprint))) =>
				{
					fs::remove_file(&destination)
				}
				Some(_) => Err(std::io::Error::other(
					"the current file does not match the content produced by this operation",
				)),
			},
			UndoFileKind::Replaced { .. } => {
				let backup_path = match validated_undo_backup_path(&file.kind) {
					Ok(Some(path)) => path,
					Ok(None) => unreachable!(),
					Err(error) => {
						failures.push(format!("{}: {error}", destination.display()));
						continue;
					}
				};
				let before = match file_fingerprint(&backup_path) {
					Ok(fingerprint) => fingerprint,
					Err(error) => {
						failures.push(format!("{}: {error}", destination.display()));
						continue;
					}
				};
				if current == Some(before) {
					Ok(())
				} else if file.recovery_applied &&
					snapshot.recovery_after_state_known &&
					(current == file.applied_fingerprint || file.recovery_allowed_states.contains(&current))
				{
					safe_fs::atomic_copy_checked(
						&backup_path,
						&destination,
						|| {
							revalidate_destination_before_commit(
								&snapshot.root,
								&file.destination_relative_path,
								current,
							)?;
							revalidate_undo_backup_before_commit(
								&file.kind,
								&backup_path,
								before,
							)
						},
					)
					.map(|_| ())
				} else {
					Err(std::io::Error::other(
						"the current file does not match the state produced by this operation",
					))
				}
			}
		};

		if let Err(error) = result {
			failures.push(format!("{}: {error}", destination.display()));
		}
	}

	if !failures.is_empty() {
		return Err(format!(
			"Safety restoration could not be completed. Backups were preserved. {}",
			failures.join(" | "),
		));
	}

	clear_recovery_journal(snapshot)?;
	remove_empty_created_directories(&snapshot.root, &snapshot.created_directories);
	Ok(())
}

fn compact_committed_snapshot_storage(snapshot: &mut UndoSnapshot) {
	if snapshot.backup_directories.is_empty() {
		return;
	}

	let live_blob_ids = snapshot
		.files
		.iter()
		.filter_map(|file| match &file.kind {
			UndoFileKind::Created => None,
			UndoFileKind::Replaced { backup_blob_id, .. } => backup_blob_id.clone(),
		})
		.collect::<HashSet<_>>();
	let legacy_backup_paths = snapshot
		.files
		.iter()
		.filter_map(|file| match &file.kind {
			UndoFileKind::Replaced { backup_path, backup_blob_id: None } => Some(backup_path.clone()),
			_ => None,
		})
		.collect::<Vec<_>>();

	let mut known_blob_ids = HashSet::new();
	for directory in &snapshot.backup_directories {
		if legacy_backup_paths.iter().any(|path| path.starts_with(directory)) {
			continue;
		}
		let references = match storage::snapshot_blob_references(directory) {
			Ok(references) => references,
			Err(_) => return,
		};
		known_blob_ids.extend(references);
	}
	if !live_blob_ids.is_subset(&known_blob_ids) {
		return;
	}

	let mut retained_directories = Vec::with_capacity(snapshot.backup_directories.len());
	for directory in snapshot.backup_directories.drain(..) {
		if legacy_backup_paths.iter().any(|path| path.starts_with(&directory)) {
			retained_directories.push(directory);
			continue;
		}

		match storage::retain_snapshot_blob_references(&directory, &live_blob_ids) {
			Ok(0) => {
				if storage::remove_managed_directory(&directory).is_err() {
					retained_directories.push(directory);
				}
			}
			Ok(_) | Err(_) => retained_directories.push(directory),
		}
	}
	snapshot.backup_directories = retained_directories;
	let _ = storage::garbage_collect();
}

fn discard_snapshot(snapshot: UndoSnapshot) {
	for directory in snapshot.backup_directories {
		let _ = storage::remove_managed_directory(&directory);
	}
	let _ = storage::garbage_collect();
}


fn rollback_operation(snapshot: &UndoSnapshot, operation_error: String) -> String {
	match rollback_snapshot(snapshot) {
		Ok(()) => {
			for directory in &snapshot.backup_directories {
				let _ = storage::remove_managed_directory(directory);
			}
			let _ = storage::garbage_collect();
			operation_error
		}
		Err(rollback_error) => {
			let reason = format!("{operation_error} {rollback_error}");
			protect_mutations(reason.clone());
			reason
		},
	}
}

pub(crate) fn prepare_external_undo_snapshot(
	root_folder: &str,
	relative_paths: &[String],
	expected_after_states: &HashMap<String, Option<FileFingerprint>>,
	source_label: String,
	added_lines: usize,
	deleted_lines: usize,
) -> Result<UndoSnapshot, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	if relative_paths.is_empty() {
		return Err("The patch has no files to apply.".to_string());
	}

	let mut seen = HashSet::new();
	let mut planned_files = Vec::new();

	for value in relative_paths {
		let relative_path = parse_relative_path(value)?;

		if relative_path.as_os_str().is_empty() {
			return Err("The patch contains an empty file path.".to_string());
		}

		let normalized = relative_path
			.to_string_lossy()
			.replace('\\', "/");
		#[cfg(target_os = "windows")]
		let normalized = normalized.to_lowercase();

		if !seen.insert(normalized) {
			continue;
		}

		let was_replaced = validate_destination_entry(
			&root,
			&relative_path,
			false,
		)?;

		planned_files.push(PlannedFile {
			destination_relative_path: relative_path,
			source_index: 0,
			was_replaced,
		});
	}

	let created_directories = collect_missing_parent_directories(
		&root,
		&planned_files,
	)?;
	let backup_bytes = estimate_snapshot_backup_bytes(
		&root,
		&planned_files,
		&[],
	)?;
	let reservation_bytes = storage::snapshot_reservation_bytes(
		backup_bytes,
		planned_files.len(),
	)?;
	let _storage_reservation = storage::reserve(
		&root,
		reservation_bytes,
	)?;
	let backup_directory = create_backup_directory(&root)?;
	let backups = match backup_replaced_files(
		&root,
		&planned_files,
		&[],
		&backup_directory,
	) {
		Ok(backups) => backups,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let files = match planned_files
		.into_iter()
		.map(|planned| {
			let mut key = planned
				.destination_relative_path
				.to_string_lossy()
				.replace('\\', "/");
			#[cfg(target_os = "windows")]
			{
				key = key.to_lowercase();
			}
			let expected_after = expected_after_states
				.get(&key)
				.copied()
				.ok_or_else(|| {
					format!(
						"The Git patch simulation did not record the expected state of {}.",
						normalize_relative_display(&planned.destination_relative_path),
					)
				})?;
			Ok(UndoFile {
				destination_relative_path: planned.destination_relative_path.clone(),
				kind: if planned.was_replaced {
					let backup = backups
						.get(&planned.destination_relative_path)
						.ok_or_else(|| "The Git snapshot lost a required backup.".to_string())?;
					UndoFileKind::Replaced {
						backup_path: backup.path.clone(),
						backup_blob_id: Some(backup.blob_id.clone()),
					}
				} else {
					UndoFileKind::Created
				},
				applied_fingerprint: expected_after,
				recovery_applied: true,
				recovery_allowed_states: vec![expected_after],
			})
		})
		.collect::<Result<Vec<_>, String>>() {
		Ok(files) => files,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let snapshot = UndoSnapshot {
		root,
		operation_id: next_operation_id("git-apply"),
		backup_directories: vec![backup_directory],
		files,
		created_directories,
		applied_at_unix_ms: current_unix_ms(),
		source_kind: UndoSourceKind::Git,
		source_label: Some(source_label),
		added_lines: Some(added_lines),
		deleted_lines: Some(deleted_lines),
		recovery_after_state_known: true,
	};

	if let Err(error) = write_recovery_journal(&snapshot) {
		discard_snapshot(snapshot.clone());
		return Err(error);
	}

	Ok(snapshot)
}

pub(crate) fn finalize_external_undo_snapshot(
	mut snapshot: UndoSnapshot,
) -> Result<(UndoSnapshot, ApplyProjectOverlayResult), String> {
	let mut added_files = 0_usize;
	let mut replaced_files = 0_usize;
	let mut deleted_files = 0_usize;
	let mut added_directories = HashSet::new();
	let mut replaced_directories = HashSet::new();
	let mut deleted_directories = HashSet::new();

	for file in &mut snapshot.files {
		let destination = snapshot.root.join(&file.destination_relative_path);
		let final_fingerprint = match fs::symlink_metadata(&destination) {
			Ok(metadata) => {
				if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
					return Err(format!(
						"The Git patch produced an unsupported destination at {}.",
						normalize_relative_display(&file.destination_relative_path),
					));
				}

				Some(file_fingerprint(&destination)?)
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
			Err(error) => {
				return Err(format!(
					"Could not verify {} after the Git patch: {error}",
					normalize_relative_display(&file.destination_relative_path),
				));
			}
		};

		if final_fingerprint != file.applied_fingerprint {
			return Err(format!(
				"The final state of {} differs from the immutable Git patch simulation.",
				normalize_relative_display(&file.destination_relative_path),
			));
		}

		match (&file.kind, final_fingerprint) {
			(UndoFileKind::Created, Some(_)) => {
				added_files += 1;
				insert_parent_directories(
					&mut added_directories,
					&file.destination_relative_path,
				);
			}
			(UndoFileKind::Created, None) => {}
			(UndoFileKind::Replaced { .. }, Some(_)) => {
				replaced_files += 1;
				insert_parent_directories(
					&mut replaced_directories,
					&file.destination_relative_path,
				);
			}
			(UndoFileKind::Replaced { .. }, None) => {
				deleted_files += 1;
				insert_parent_directories(
					&mut deleted_directories,
					&file.destination_relative_path,
				);
			}
		}

		file.recovery_applied = true;
		if !file.recovery_allowed_states.contains(&final_fingerprint) {
			file.recovery_allowed_states.push(final_fingerprint);
		}
	}

	write_recovery_journal(&snapshot)?;
	let operation_id = snapshot.operation_id.clone();
	let applied_at_unix_ms = snapshot.applied_at_unix_ms;

	Ok((
		snapshot,
		ApplyProjectOverlayResult {
			operation_id,
			applied_at_unix_ms: Some(applied_at_unix_ms),
			added_files,
			replaced_files,
			deleted_files,
			unchanged_files: 0,
			added_directories: added_directories.len(),
			replaced_directories: replaced_directories.len(),
			deleted_directories: deleted_directories.len(),
			unchanged_directories: 0,
		},
	))
}

pub(crate) fn rollback_external_undo_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	match rollback_snapshot(snapshot) {
		Ok(()) => Ok(()),
		Err(error) => {
			protect_mutations(error.clone());
			Err(error)
		}
	}
}

pub(crate) fn discard_external_undo_snapshot(snapshot: UndoSnapshot) {
	discard_snapshot(snapshot);
}

pub(crate) fn record_external_undo_snapshot(
	undo_state: &OverlayUndoState,
	mut snapshot: UndoSnapshot,
	undo_history_limit: usize,
) -> Result<(), String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let root = snapshot.root.clone();
	let mut histories = match undo_state.histories.lock() {
		Ok(histories) => histories,
		Err(_) => {
			return Err(rollback_operation(
				&snapshot,
				"Undo state became unavailable before recording the application.".to_string(),
			));
		}
	};
	clear_recovery_journal(&snapshot)?;
	compact_committed_snapshot_storage(&mut snapshot);
	let history = histories.entry(root).or_default();

	record_undo_snapshot(
		history,
		snapshot,
		false,
		undo_history_limit,
	);

	Ok(())
}

fn apply_overlay_manifest_blocking(
	root: PathBuf,
	manifest: &OverlayManifest,
	destination_relative_path: String,
	source_prefix: String,
) -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {
	let destination_relative = parse_relative_path(&destination_relative_path)?;
	let prefix = parse_relative_path(&source_prefix)?;
	let planned = planned_files(
		&root,
		manifest,
		&destination_relative,
		&prefix,
	)?;
	let delete_paths = planned_deletions(
		manifest,
		&planned,
	)?;

	if planned.is_empty() && delete_paths.is_empty() {
		return Err("No files were found to apply or delete.".to_string());
	}

	let (planned, unchanged_paths) = filter_unchanged_planned_files(
		&root,
		manifest,
		planned,
	)?;
	let unchanged_files = unchanged_paths.len();
	let unchanged_directories = count_parent_directories(
		unchanged_paths.iter().map(PathBuf::as_path),
	);
	let operation_id = next_operation_id("files-apply");
	let applied_at_unix_ms = current_unix_ms();

	if planned.is_empty() && delete_paths.is_empty() {
		return Ok((
			ApplyProjectOverlayResult {
				operation_id: operation_id.clone(),
				applied_at_unix_ms: None,
				added_files: 0,
				replaced_files: 0,
				deleted_files: 0,
				unchanged_files,
				added_directories: 0,
				replaced_directories: 0,
				deleted_directories: 0,
				unchanged_directories,
			},
			UndoSnapshot {
				root,
				operation_id,
				backup_directories: Vec::new(),
				files: Vec::new(),
				created_directories: Vec::new(),
				applied_at_unix_ms,
				source_kind: UndoSourceKind::Files,
				source_label: None,
				added_lines: None,
				deleted_lines: None,
				recovery_after_state_known: true,
			},
		));
	}

	let added_files = planned
		.iter()
		.filter(|file| !file.was_replaced)
		.count();
	let replaced_files = planned.len() - added_files;
	let deleted_files = delete_paths.len();
	let added_directories = count_parent_directories(
		planned
			.iter()
			.filter(|file| !file.was_replaced)
			.map(|file| file.destination_relative_path.as_path()),
	);
	let replaced_directories = count_parent_directories(
		planned
			.iter()
			.filter(|file| file.was_replaced)
			.map(|file| file.destination_relative_path.as_path()),
	);
	let deleted_directories = count_parent_directories(
		delete_paths.iter().map(PathBuf::as_path),
	);
	let created_directories = collect_missing_parent_directories(
		&root,
		&planned,
	)?;
	let backup_bytes = estimate_snapshot_backup_bytes(
		&root,
		&planned,
		&delete_paths,
	)?;
	let reservation_bytes = storage::snapshot_reservation_bytes(
		backup_bytes,
		planned.len().saturating_add(delete_paths.len()),
	)?;
	let _storage_reservation = storage::reserve(
		&root,
		reservation_bytes,
	)?;
	let backup_directory = create_backup_directory(&root)?;
	let backups = match backup_replaced_files(
		&root,
		&planned,
		&delete_paths,
		&backup_directory,
	) {
		Ok(backups) => backups,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let source_fingerprints = match planned_source_fingerprints(manifest, &planned) {
		Ok(fingerprints) => fingerprints,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};
	let mut placeholder_files = planned
		.iter()
		.zip(source_fingerprints)
		.map(|(file, applied_fingerprint)| UndoFile {
			destination_relative_path: file.destination_relative_path.clone(),
			kind: if file.was_replaced {
				let backup = backups
					.get(&file.destination_relative_path)
					.expect("planned replacement must have a reserved backup");
				UndoFileKind::Replaced {
					backup_path: backup.path.clone(),
					backup_blob_id: Some(backup.blob_id.clone()),
				}
			} else {
				UndoFileKind::Created
			},
			applied_fingerprint: Some(applied_fingerprint),
			recovery_applied: false,
			recovery_allowed_states: Vec::new(),
		})
		.collect::<Vec<_>>();

	placeholder_files.extend(delete_paths.iter().map(|delete_path| UndoFile {
		destination_relative_path: delete_path.clone(),
		kind: {
			let backup = backups
				.get(delete_path)
				.expect("planned deletion must have a reserved backup");
			UndoFileKind::Replaced {
				backup_path: backup.path.clone(),
				backup_blob_id: Some(backup.blob_id.clone()),
			}
		},
		applied_fingerprint: None,
		recovery_applied: false,
		recovery_allowed_states: Vec::new(),
	}));

	let mut placeholder_snapshot = UndoSnapshot {
		root: root.clone(),
		operation_id: operation_id.clone(),
		backup_directories: vec![backup_directory.clone()],
		files: placeholder_files,
		created_directories: created_directories.clone(),
		applied_at_unix_ms,
		source_kind: UndoSourceKind::Files,
		source_label: None,
		added_lines: None,
		deleted_lines: None,
		recovery_after_state_known: true,
	};

	if let Err(error) = write_recovery_journal(&placeholder_snapshot) {
		discard_snapshot(placeholder_snapshot);
		return Err(error);
	}

	if let Err(error) = write_manifest_files(
		&root,
		manifest,
		&planned,
		&mut placeholder_snapshot,
	) {
		return Err(rollback_operation(&placeholder_snapshot, error));
	}

	if let Err(error) = delete_manifest_files(
		&root,
		&delete_paths,
		&mut placeholder_snapshot,
	) {
		return Err(rollback_operation(&placeholder_snapshot, error));
	}

	let snapshot = match build_undo_snapshot(
		&root,
		operation_id.clone(),
		applied_at_unix_ms,
		&planned,
		&delete_paths,
		created_directories,
		backup_directory.clone(),
		&backups,
	) {
		Ok(snapshot) => snapshot,
		Err(error) => {
			return Err(rollback_operation(&placeholder_snapshot, error));
		}
	};

	Ok((
		ApplyProjectOverlayResult {
			operation_id,
			applied_at_unix_ms: Some(applied_at_unix_ms),
			added_files,
			replaced_files,
			deleted_files,
			unchanged_files,
			added_directories,
			replaced_directories,
			deleted_directories,
			unchanged_directories,
		},
		snapshot,
	))
}


#[cfg(test)]
fn apply_project_overlay_blocking(
	root_folder: String,
	paths: Vec<String>,
	destination_relative_path: String,
	source_prefix: String,
) -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {
	let frozen = freeze_overlay_input(
		&root_folder,
		&paths,
	)?;
	apply_overlay_manifest_blocking(
		frozen.root.clone(),
		&frozen.manifest,
		destination_relative_path,
		source_prefix,
	)
}

fn merge_undo_snapshots(
	mut previous: UndoSnapshot,
	current: UndoSnapshot,
) -> UndoSnapshot {
	if previous.root != current.root {
		discard_snapshot(previous);
		return current;
	}

	let mut file_indexes = previous
		.files
		.iter()
		.enumerate()
		.map(|(index, file)| (file.destination_relative_path.clone(), index))
		.collect::<HashMap<_, _>>();

	for current_file in current.files {
		if let Some(index) = file_indexes.get(&current_file.destination_relative_path).copied() {
			previous.files[index].applied_fingerprint = current_file.applied_fingerprint;
			continue;
		}

		file_indexes.insert(
			current_file.destination_relative_path.clone(),
			previous.files.len(),
		);
		previous.files.push(current_file);
	}

	previous
		.created_directories
		.extend(current.created_directories);
	previous.created_directories.sort();
	previous.created_directories.dedup();
	previous
		.backup_directories
		.extend(current.backup_directories);
	previous.operation_id = current.operation_id;
	previous.applied_at_unix_ms = current.applied_at_unix_ms;
	previous.recovery_after_state_known =
		previous.recovery_after_state_known && current.recovery_after_state_known;
	compact_committed_snapshot_storage(&mut previous);

	previous
}

fn validate_undo_history_limit(limit: usize) -> Result<usize, String> {
	if !(MIN_UNDO_HISTORY_ENTRIES..=MAX_UNDO_HISTORY_ENTRIES).contains(&limit) {
		return Err(format!(
			"The application-history limit must be between {MIN_UNDO_HISTORY_ENTRIES} and {MAX_UNDO_HISTORY_ENTRIES}.",
		));
	}

	Ok(limit)
}

fn trim_undo_history(
	history: &mut Vec<UndoSnapshot>,
	history_limit: usize,
) {
	while history.len() > history_limit {
		let expired = history.remove(0);
		discard_snapshot(expired);
	}
}

fn record_undo_snapshot(
	history: &mut Vec<UndoSnapshot>,
	snapshot: UndoSnapshot,
	append_undo: bool,
	history_limit: usize,
) {
	if append_undo {
		if let Some(previous) = history.pop() {
			if previous.source_kind == UndoSourceKind::Files &&
				snapshot.source_kind == UndoSourceKind::Files
			{
				history.push(merge_undo_snapshots(
					previous,
					snapshot,
				));
			} else {
				history.push(previous);
				history.push(snapshot);
			}
		} else {
			history.push(snapshot);
		}
	} else {
		history.push(snapshot);
	}

	trim_undo_history(
		history,
		history_limit,
	);
}

fn undo_snapshot_files(
	snapshot: &UndoSnapshot,
	recovery: &mut UndoSnapshot,
) -> Result<(usize, usize), String> {
	let mut restored_files = 0_usize;
	let mut removed_files = 0_usize;

	for file in snapshot.files.iter().rev() {
		let destination = snapshot.root.join(&file.destination_relative_path);
		let current = recovery_current_state(
			&snapshot.root,
			&file.destination_relative_path,
		)?;
		if current != file.applied_fingerprint {
			return Err(format!(
				"It is not safe to continue Undo: {} changed during the operation.",
				normalize_relative_display(&file.destination_relative_path),
			));
		}

		match &file.kind {
			UndoFileKind::Created => {
				if file.applied_fingerprint.is_some() {
					fs::remove_file(&destination)
						.map_err(|error| format!("Could not remove {}: {error}", destination.display()))?;
					mark_recovery_file_applied(
						recovery,
						&file.destination_relative_path,
						None,
						false,
					)?;
					mutation_failure_checkpoint()?;
					removed_files += 1;
				}
			}
			UndoFileKind::Replaced { .. } => {
				let backup_path = validated_undo_backup_path(&file.kind)?
					.ok_or_else(|| "The replacement snapshot lost the required backup.".to_string())?;
				let expected_backup_fingerprint = file_fingerprint(&backup_path)?;
				let validate_backup = || {
					revalidate_destination_before_commit(
						&snapshot.root,
						&file.destination_relative_path,
						current,
					)?;
					revalidate_undo_backup_before_commit(
						&file.kind,
						&backup_path,
						expected_backup_fingerprint,
					)
				};
				let restore = if file.applied_fingerprint.is_none() {
					safe_fs::atomic_copy_create_new_checked(
						&backup_path,
						&destination,
						validate_backup,
					)
				} else {
					safe_fs::atomic_copy_checked(
						&backup_path,
						&destination,
						validate_backup,
					)
				};
				restore
					.map_err(|error| format!("Could not restore {}: {error}", destination.display()))?;
				let restored_fingerprint = file_fingerprint(&destination)?;
				if restored_fingerprint != expected_backup_fingerprint {
					return Err(format!(
						"Restoring {} produced bytes different from the validated backup.",
						normalize_relative_display(&file.destination_relative_path),
					));
				}
				mark_recovery_file_applied(
					recovery,
					&file.destination_relative_path,
					Some(restored_fingerprint),
					false,
				)?;
				mutation_failure_checkpoint()?;
				restored_files += 1;
			}
		}
	}

	Ok((restored_files, removed_files))
}

fn prepare_undo_recovery_snapshot(
	root: &Path,
	snapshots: &[UndoSnapshot],
	validation: &UndoValidationPlan,
) -> Result<UndoSnapshot, String> {
	let mut seen = HashSet::new();
	let mut planned = Vec::new();

	for snapshot in snapshots {
		for file in &snapshot.files {
			if !seen.insert(file.destination_relative_path.clone()) {
				continue;
			}
			let exists = validate_destination_entry(root, &file.destination_relative_path, false)?;
			planned.push(PlannedFile {
				destination_relative_path: file.destination_relative_path.clone(),
				source_index: 0,
				was_replaced: exists,
			});
		}
	}

	let backup_bytes = estimate_snapshot_backup_bytes(
		root,
		&planned,
		&[],
	)?;
	let reservation_bytes = storage::snapshot_reservation_bytes(
		backup_bytes,
		planned.len(),
	)?;
	let _storage_reservation = storage::reserve(
		root,
		reservation_bytes,
	)?;
	let backup_directory = create_backup_directory(root)?;
	let backups = match backup_replaced_files(
		root,
		&planned,
		&[],
		&backup_directory,
	) {
		Ok(backups) => backups,
		Err(error) => {
			let _ = storage::remove_managed_directory(&backup_directory);
			return Err(error);
		}
	};

	let files = planned
		.into_iter()
		.map(|file| UndoFile {
			destination_relative_path: file.destination_relative_path.clone(),
			kind: if file.was_replaced {
				let backup = backups
					.get(&file.destination_relative_path)
					.expect("undo recovery replacement must have a reserved backup");
				UndoFileKind::Replaced {
					backup_path: backup.path.clone(),
					backup_blob_id: Some(backup.blob_id.clone()),
				}
			} else {
				UndoFileKind::Created
			},
			applied_fingerprint: validation
				.final_states
				.get(&file.destination_relative_path)
				.copied()
				.flatten(),
			recovery_applied: false,
			recovery_allowed_states: validation
				.allowed_states
				.get(&file.destination_relative_path)
				.cloned()
				.unwrap_or_default(),
		})
		.collect();
	let recovery = UndoSnapshot {
		root: root.to_path_buf(),
		operation_id: next_operation_id("undo-recovery"),
		backup_directories: vec![backup_directory],
		files,
		created_directories: Vec::new(),
		applied_at_unix_ms: current_unix_ms(),
		source_kind: UndoSourceKind::Files,
		source_label: Some("undo-recovery".to_string()),
		added_lines: None,
		deleted_lines: None,
		recovery_after_state_known: true,
	};

	if let Err(error) = write_recovery_journal(&recovery) {
		discard_snapshot(recovery.clone());
		return Err(error);
	}

	Ok(recovery)
}

#[cfg(test)]
fn undo_project_overlay_blocking(
	root_folder: String,
	snapshot: &UndoSnapshot,
) -> Result<UndoSequenceExecution, String> {
	undo_project_overlays_blocking(
		root_folder,
		std::slice::from_ref(snapshot),
	)
}

#[tauri::command]
pub async fn prepare_project_overlay(
	root_folder: String,
	paths: Vec<String>,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<PrepareProjectOverlayResult, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		prepare_project_overlay_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("Patch analysis was interrupted: {error}"))?
}

fn prepared_plan_contains_candidate(
	plan: &PrepareProjectOverlayResult,
	destination_relative_path: &str,
	source_prefix: &str,
) -> bool {
	plan.candidates
		.iter()
		.chain(plan.root_candidate.iter())
		.any(|candidate| {
			candidate.destination_relative_path == destination_relative_path &&
				candidate.source_prefix == source_prefix
		})
}

fn validate_frozen_overlay_for_apply(
	frozen: &FrozenOverlayInput,
	destination_relative_path: &str,
	source_prefix: &str,
	expected_source_fingerprint: &str,
	expected_routing_fingerprint: &str,
) -> Result<PrepareProjectOverlayResult, String> {
	let current_plan = prepare_overlay_manifest(
		&frozen.root,
		&frozen.manifest,
	)?;
	if current_plan.source_fingerprint != expected_source_fingerprint {
		return Err(
			"The application source changed after analysis. Drop the files again to validate the current version.".to_string(),
		);
	}
	if current_plan.routing_fingerprint != expected_routing_fingerprint {
		return Err(
			"The project or routing rules changed after analysis. Analyze again before applying.".to_string(),
		);
	}
	if !prepared_plan_contains_candidate(
		&current_plan,
		destination_relative_path,
		source_prefix,
	) {
		return Err(
			"The selected destination is no longer a safe candidate for the current project version.".to_string(),
		);
	}

	Ok(current_plan)
}

#[tauri::command]
pub async fn apply_project_overlay(
	root_folder: String,
	paths: Vec<String>,
	destination_relative_path: String,
	source_prefix: String,
	expected_source_fingerprint: String,
	expected_routing_fingerprint: String,
	append_undo: bool,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ApplyProjectOverlayResult, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let task = tauri::async_runtime::spawn_blocking(move || {
		let frozen = freeze_overlay_input(
			&root_folder,
			&paths,
		)?;
		validate_frozen_overlay_for_apply(
			&frozen,
			&destination_relative_path,
			&source_prefix,
			&expected_source_fingerprint,
			&expected_routing_fingerprint,
		)?;

		apply_overlay_manifest_blocking(
			frozen.root.clone(),
			&frozen.manifest,
			destination_relative_path,
			source_prefix,
		)
	})
	.await;
	let (result, mut snapshot) = match task {
		Ok(result) => result?,
		Err(error) => {
			let reason = protect_after_interrupted_mutation("File application");
			return Err(format!("{reason} Detalhes: {error}"));
		}
	};
	if result.added_files == 0 && result.replaced_files == 0 && result.deleted_files == 0 {
		return Ok(result);
	}

	let root = snapshot.root.clone();
	let mut histories = undo_state
		.histories
		.lock()
		.map_err(|_| "Undo state became unavailable.".to_string())?;

	if let Err(error) = clear_recovery_journal(&snapshot) {
		drop(histories);
		return Err(rollback_operation(&snapshot, error));
	}
	compact_committed_snapshot_storage(&mut snapshot);

	let history = histories.entry(root).or_default();
	record_undo_snapshot(
		history,
		snapshot,
		append_undo,
		undo_history_limit,
	);

	Ok(result)
}

#[tauri::command]
pub fn project_overlay_undo_history(
	root_folder: String,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<Vec<OverlayUndoHistoryEntry>, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let project_is_mutating = undo_state.is_project_mutating(&root)?;
	let mut histories = undo_state
		.histories
		.lock()
		.map_err(|_| "Undo state became unavailable.".to_string())?;
	let Some(history) = histories.get_mut(&root) else {
		return Ok(Vec::new());
	};

	if !project_is_mutating {
		trim_undo_history(
			history,
			undo_history_limit,
		);
	}

	Ok(history
		.iter()
		.rev()
		.enumerate()
		.map(|(index, snapshot)| {
			let added_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Created) &&
						file.applied_fingerprint.is_some()
				})
				.count();
			let replaced_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Replaced { .. }) &&
						file.applied_fingerprint.is_some()
				})
				.count();
			let deleted_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Replaced { .. }) &&
						file.applied_fingerprint.is_none()
				})
				.count();

			OverlayUndoHistoryEntry {
				operation_id: snapshot.operation_id.clone(),
				steps: index + 1,
				added_files,
				replaced_files,
				deleted_files,
				applied_at_unix_ms: snapshot.applied_at_unix_ms,
				source_kind: snapshot.source_kind.as_str().to_string(),
				source_label: snapshot.source_label.clone(),
				added_lines: snapshot.added_lines,
				deleted_lines: snapshot.deleted_lines,
			}
		})
		.collect())
}

struct UndoSequenceExecution {
	restored_files: usize,
	removed_files: usize,
	recovery: UndoSnapshot,
}

struct UndoValidationPlan {
	final_states: HashMap<PathBuf, Option<FileFingerprint>>,
	allowed_states: HashMap<PathBuf, Vec<Option<FileFingerprint>>>,
}

fn validate_undo_sequence(
	root_folder: &str,
	snapshots: &[UndoSnapshot],
) -> Result<UndoValidationPlan, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;
	let mut virtual_states = HashMap::<PathBuf, Option<FileFingerprint>>::new();
	let mut allowed_states = HashMap::<PathBuf, Vec<Option<FileFingerprint>>>::new();

	for snapshot in snapshots.iter().rev() {
		if snapshot.root != root {
			return Err(
				"One application in history belongs to another project folder.".to_string(),
			);
		}

		for file in &snapshot.files {
			let is_virtual = virtual_states.contains_key(&file.destination_relative_path);
			let current_state = match virtual_states.get(&file.destination_relative_path) {
				Some(state) => *state,
				None => {
					let exists = validate_destination_entry(
						&root,
						&file.destination_relative_path,
						false,
					)?;

					if exists {
						Some(file_fingerprint(&root.join(&file.destination_relative_path))?)
					} else {
						None
					}
				}
			};

			if current_state != file.applied_fingerprint {
				return Err(match (file.applied_fingerprint, current_state) {
					(None, Some(_)) => format!(
						"It is not safe to undo: {} was recreated after application.",
						normalize_relative_display(&file.destination_relative_path),
					),
					(Some(_), _) => format!(
						"It is not safe to undo: {} was changed after application.",
						normalize_relative_display(&file.destination_relative_path),
					),
					(None, None) => unreachable!(),
				});
			}

			if !is_virtual && current_state.is_some() {
				OpenOptions::new()
					.write(true)
					.open(root.join(&file.destination_relative_path))
					.map_err(|error| {
						format!(
							"It is not safe to undo while {} cannot be changed: {error}",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?;
			}

			let state_after_undo = match &file.kind {
				UndoFileKind::Created => None,
				UndoFileKind::Replaced { .. } => {
					let backup_path = validated_undo_backup_path(&file.kind).map_err(|error| {
						format!(
							"The snapshot required to restore {} is not safely available: {error}",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?
					.ok_or_else(|| "The replacement snapshot lost the required backup.".to_string())?;

					Some(file_fingerprint(&backup_path)?)
				}
			};

			virtual_states.insert(
				file.destination_relative_path.clone(),
				state_after_undo,
			);
			let states = allowed_states
				.entry(file.destination_relative_path.clone())
				.or_default();
			if !states.contains(&state_after_undo) {
				states.push(state_after_undo);
			}
		}
	}

	Ok(UndoValidationPlan {
		final_states: virtual_states,
		allowed_states,
	})
}

fn undo_project_overlays_blocking(
	root_folder: String,
	snapshots: &[UndoSnapshot],
) -> Result<UndoSequenceExecution, String> {
	let validation = validate_undo_sequence(&root_folder, snapshots)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let mut recovery = prepare_undo_recovery_snapshot(
		&root,
		snapshots,
		&validation,
	)?;
	let mut restored_files = 0_usize;
	let mut removed_files = 0_usize;

	for snapshot in snapshots.iter().rev() {
		match undo_snapshot_files(snapshot, &mut recovery) {
			Ok((restored, removed)) => {
				restored_files += restored;
				removed_files += removed;
			}
			Err(error) => {
				return Err(rollback_operation(&recovery, error));
			}
		}
	}

	Ok(UndoSequenceExecution {
		restored_files,
		removed_files,
		recovery,
	})
}

#[tauri::command]
pub async fn undo_project_overlay(
	root_folder: String,
	steps: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<UndoProjectOverlayResult, String> {
	if steps == 0 || steps > MAX_UNDO_HISTORY_ENTRIES {
		return Err(format!(
			"The number of applications to undo must be between 1 and {MAX_UNDO_HISTORY_ENTRIES}.",
		));
	}

	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let snapshots = {
		let histories = undo_state
			.histories
			.lock()
			.map_err(|_| "Undo state became unavailable.".to_string())?;
		let history = histories
			.get(&root)
			.ok_or_else(|| "There are no applications in this project history to undo.".to_string())?;
		if history.len() < steps {
			return Err("There are not enough applications in history to undo.".to_string());
		}
		history[history.len() - steps..].to_vec()
	};
	let snapshots_for_task = snapshots.clone();
	let task = tauri::async_runtime::spawn_blocking(move || {
		undo_project_overlays_blocking(root_folder, &snapshots_for_task)
	})
	.await;
	let execution = match task {
		Ok(result) => result?,
		Err(error) => {
			let reason = protect_after_interrupted_mutation("The Undo operation");
			return Err(format!("{reason} Detalhes: {error}"));
		}
	};

	let mut histories = match undo_state.histories.lock() {
		Ok(histories) => histories,
		Err(_) => {
			return Err(rollback_operation(
				&execution.recovery,
				"Undo state became unavailable before Undo completed.".to_string(),
			));
		}
	};
	let history = histories
		.get_mut(&root)
		.ok_or_else(|| "Undo history changed during the operation.".to_string());
	let history = match history {
		Ok(history) => history,
		Err(error) => {
			drop(histories);
			return Err(rollback_operation(&execution.recovery, error));
		}
	};
	if history.len() < steps || history[history.len() - steps..]
		.iter()
		.zip(&snapshots)
		.any(|(current, expected)| current.applied_at_unix_ms != expected.applied_at_unix_ms)
	{
		drop(histories);
		return Err(rollback_operation(
			&execution.recovery,
			"Undo history changed during the operation.".to_string(),
		));
	}
	let mut removed = history.split_off(history.len() - steps);
	if let Err(error) = clear_recovery_journal(&execution.recovery) {
		history.append(&mut removed);
		drop(histories);
		return Err(rollback_operation(&execution.recovery, error));
	}
	let remaining_history_entries = history.len();
	drop(histories);
	discard_snapshot(execution.recovery);

	for snapshot in &removed {
		remove_empty_created_directories(&snapshot.root, &snapshot.created_directories);
	}
	for snapshot in removed {
		discard_snapshot(snapshot);
	}

	Ok(UndoProjectOverlayResult {
		operation_id: next_operation_id("undo"),
		restored_files: execution.restored_files,
		removed_files: execution.removed_files,
		undone_batches: steps,
		remaining_history_entries,
	})
}

#[tauri::command]
pub fn discard_project_overlay_undo(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<(), String> {
	let requested_root = PathBuf::from(&root_folder);
	let canonical_root = canonicalize_existing(&requested_root).ok();
	let _mutation_guard = if canonical_root.is_some() {
		Some(undo_state.begin_project_mutation(&root_folder)?)
	} else {
		None
	};
	let snapshots = {
		let mut histories = undo_state
			.histories
			.lock()
			.map_err(|_| "Undo state became unavailable.".to_string())?;
		let requested_key = root_lookup_key(&requested_root);
		let matching_root = canonical_root
			.as_ref()
			.and_then(|root| histories.contains_key(root).then(|| root.clone()))
			.or_else(|| {
				histories
					.keys()
					.find(|root| root_lookup_key(root) == requested_key)
					.cloned()
			});

		matching_root
			.and_then(|root| histories.remove(&root))
			.unwrap_or_default()
	};

	for snapshot in snapshots {
		discard_snapshot(snapshot);
	}

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write as _;
	use zip::{write::SimpleFileOptions, ZipWriter};

	struct TestDirectory {
		path: PathBuf,
	}

	impl TestDirectory {
		fn new() -> Self {
			let identifier = SystemTime::now()
				.duration_since(UNIX_EPOCH)
				.expect("test clock should be valid")
				.as_nanos();
			let path = std::env::temp_dir().join(format!(
				"orqeto-dev-overlay-test-{}-{identifier}",
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

	fn write_test_file(
		path: &Path,
		content: &str,
	) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).expect("test parent directory should be created");
		}

		fs::write(
			path,
			content,
		)
		.expect("test file should be written");
	}

	fn write_test_zip(
		path: &Path,
		entries: &[(&str, &str)],
	) {
		let file = File::create(path).expect("test zip should be created");
		let mut archive = ZipWriter::new(file);

		for (name, content) in entries {
			archive
				.start_file(
					*name,
					SimpleFileOptions::default(),
				)
				.expect("test zip entry should be started");
			archive
				.write_all(content.as_bytes())
				.expect("test zip entry should be written");
		}

		archive.finish().expect("test zip should be finalized");
	}

	#[test]
	fn project_access_coordinator_blocks_overlapping_reads_and_writes() {
		let test_directory = TestDirectory::new();
		let root = test_directory.path.join("project");
		let child = root.join("packages/app");
		fs::create_dir_all(&child).expect("overlapping test roots should be created");
		let state = OverlayUndoState::new();

		let read = state
			.begin_project_read(&root.to_string_lossy())
			.expect("read should start");
		assert!(state.begin_project_mutation(&child.to_string_lossy()).is_err());
		drop(read);

		let write = state
			.begin_project_mutation(&child.to_string_lossy())
			.expect("write should start after the reader is released");
		assert!(state.begin_project_read(&root.to_string_lossy()).is_err());
		drop(write);
		assert!(state.begin_project_read(&root.to_string_lossy()).is_ok());
	}

	#[test]
	fn overlay_fingerprints_change_when_source_or_routing_evidence_changes() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "one");

		let first = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("first overlay plan should be prepared");

		write_test_file(&source, "two");
		let changed_source = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("changed source should still be analyzable");
		assert_ne!(first.source_fingerprint, changed_source.source_fingerprint);

		write_test_file(&project_root.join(".orqeto-devignore"), "# routing state changed\n");
		let changed_routing = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("changed routing evidence should still be analyzable");
		assert_eq!(changed_source.source_fingerprint, changed_routing.source_fingerprint);
		assert_ne!(changed_source.routing_fingerprint, changed_routing.routing_fingerprint);
	}


	fn root_choice(plan: &PrepareProjectOverlayResult) -> (String, String) {
		let candidate = plan
			.root_candidate
			.as_ref()
			.expect("root candidate should be available");
		(
			candidate.destination_relative_path.clone(),
			candidate.source_prefix.clone(),
		)
	}

	#[test]
	fn br_file_001_frozen_apply_uses_exact_frozen_bytes_after_original_source_changes() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "version-one");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		)
		.expect("frozen input should match preview");

		write_test_file(&source, "version-two-after-freeze");

		let (result, snapshot) = apply_overlay_manifest_blocking(
			frozen.root.clone(),
			&frozen.manifest,
			destination,
			prefix,
		)
		.expect("frozen overlay should apply");

		assert_eq!(result.added_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("applied destination should be readable"),
			"version-one",
		);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_file_002_source_change_before_freeze_is_rejected_before_project_mutation() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "previewed");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		write_test_file(&source, "changed-before-apply");

		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("changed source should still freeze");
		let error = match validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		) {
			Ok(_) => panic!("changed source must invalidate preview"),
			Err(error) => error,
		};

		assert!(error.contains("application source changed"));
		assert!(!project_root.join("state.ts").exists());
	}

	#[test]
	fn br_file_003_routing_change_before_apply_is_rejected_before_mutation() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		write_test_file(&project_root.join("src/state.ts"), "old-src");
		write_test_file(&source, "incoming");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let chosen = preview
			.candidates
			.first()
			.or(preview.root_candidate.as_ref())
			.expect("a safe candidate should exist")
			.clone();

		write_test_file(&project_root.join("other/state.ts"), "old-other");

		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		let error = match validate_frozen_overlay_for_apply(
			&frozen,
			&chosen.destination_relative_path,
			&chosen.source_prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		) {
			Ok(_) => panic!("changed routing evidence must invalidate preview"),
			Err(error) => error,
		};

		assert!(error.contains("routing changed"));
		assert_eq!(
			fs::read_to_string(project_root.join("src/state.ts"))
				.expect("existing destination should remain readable"),
			"old-src",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("other/state.ts"))
				.expect("new route evidence should remain readable"),
			"old-other",
		);
	}

	#[test]
	fn br_file_004_unchanged_only_frozen_apply_creates_no_mutation_snapshot() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		write_test_file(&project_root.join("state.ts"), "same");
		write_test_file(&source, "same");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		)
		.expect("frozen input should remain valid");

		let (result, snapshot) = apply_overlay_manifest_blocking(
			frozen.root.clone(),
			&frozen.manifest,
			destination,
			prefix,
		)
		.expect("unchanged apply should succeed as a no-op");

		assert_eq!(result.unchanged_files, 1);
		assert_eq!(result.added_files + result.replaced_files + result.deleted_files, 0);
		assert!(snapshot.files.is_empty());
		assert!(snapshot.backup_directories.is_empty());
	}

	#[test]
	fn br_stage_001_files_apply_staging_is_fresh_unpredictable_and_non_reparse() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		fs::create_dir_all(&project_root).expect("project root should be created");
		let project_root = fs::canonicalize(project_root).expect("project root should canonicalize");
		let first = create_files_apply_staging_directory(&project_root)
			.expect("first staging directory should be created");
		let second = create_files_apply_staging_directory(&project_root)
			.expect("second staging directory should be created");

		assert_ne!(first, second);
		for path in [&first, &second] {
			let metadata = fs::symlink_metadata(path)
				.expect("staging directory should remain inspectable");
			assert!(metadata.is_dir());
			assert!(!safe_fs::metadata_is_link_or_reparse(&metadata));
		}

		storage::remove_managed_directory(&first).expect("first staging should be removed");
		storage::remove_managed_directory(&second).expect("second staging should be removed");
	}

	#[test]
	fn long_directory_overlay_keeps_every_nested_file() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory
			.path
			.join("patch")
			.join("apis")
			.join("api")
			.join("source");
		let project_destination = project_root
			.join("apps")
			.join("api")
			.join("source");

		fs::create_dir_all(project_destination.join("modules/flow"))
			.expect("project destination should be created");
		write_test_file(
			&source_root.join("main.ts"),
			"main",
		);
		for (name, content) in [
			("factory.ts", "factory"),
			("module.ts", "module"),
			("service.ts", "service"),
			("types.ts", "types"),
		] {
			write_test_file(
				&source_root.join("modules/flow").join(name),
				content,
			);
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("overlay should be prepared");

		assert_eq!(prepared.file_count, 5);
		let recommended_index = prepared
			.recommended_candidate_index
			.expect("long source path should resolve to the existing project branch");
		let candidate = prepared
			.candidates
			.get(recommended_index)
			.expect("recommended candidate should exist")
			.clone();
		assert_eq!(candidate.destination_relative_path, "./apps/api/source");

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
			candidate.destination_relative_path,
			candidate.source_prefix,
		)
		.expect("overlay should be applied");

		assert_eq!(result.added_files, 5);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(
			fs::read_to_string(project_destination.join("main.ts"))
				.expect("main file should exist"),
			"main",
		);
		for (name, content) in [
			("factory.ts", "factory"),
			("module.ts", "module"),
			("service.ts", "service"),
			("types.ts", "types"),
		] {
			assert_eq!(
				fs::read_to_string(project_destination.join("modules/flow").join(name))
					.expect("nested file should exist"),
				content,
			);
		}

		discard_snapshot(snapshot);
	}

	#[test]
	fn identical_file_overlay_is_reported_as_unchanged_without_backup() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_file = test_directory.path.join("patch/state.ts");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("state.ts"),
			"same content",
		);
		write_test_file(
			&source_file,
			"same content",
		);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_file.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("identical overlay should be accepted as a no-op");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(result.unchanged_files, 1);
		assert!(snapshot.backup_directories.is_empty());
		assert!(snapshot.files.is_empty());
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("project file should remain available"),
			"same content",
		);

		discard_snapshot(snapshot);
	}

	#[test]
	fn zip_overlay_skips_identical_files_and_undoes_only_real_changes() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/same.ts"),
			"same",
		);
		write_test_file(
			&project_root.join("src/change.ts"),
			"before",
		);
		write_test_zip(
			&archive_path,
			&[
				("src/same.ts", "same"),
				("src/change.ts", "after"),
			],
		);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("mixed zip overlay should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 1);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(result.unchanged_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("unchanged file should remain available"),
			"same",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("src/change.ts"))
				.expect("changed file should be written"),
			"after",
		);

		let undo = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("mixed zip overlay should be undoable");

		assert_eq!(undo.restored_files, 1);
		assert_eq!(undo.removed_files, 0);
		assert_eq!(
			fs::read_to_string(project_root.join("src/change.ts"))
				.expect("changed file should be restored"),
			"before",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("unchanged file should stay untouched"),
			"same",
		);
		discard_snapshot(undo.recovery);

		discard_snapshot(snapshot);
	}

	#[test]
	fn undo_history_respects_configured_limit_and_merges_one_drop() {
		let test_directory = TestDirectory::new();
		let root = test_directory.path.join("project");
		fs::create_dir_all(&root).expect("project root should be created");
		let mut history = Vec::new();

		for index in 0..=MAX_UNDO_HISTORY_ENTRIES {
			record_undo_snapshot(
				&mut history,
				UndoSnapshot {
					root: root.clone(),
					operation_id: format!("test-history-{index}"),
					backup_directories: Vec::new(),
					files: Vec::new(),
					created_directories: Vec::new(),
					applied_at_unix_ms: index as u64,
					source_kind: UndoSourceKind::Files,
					source_label: None,
					added_lines: None,
					deleted_lines: None,
					recovery_after_state_known: true,
				},
				false,
				10,
			);
		}

		assert_eq!(history.len(), 10);
		assert_eq!(history[0].applied_at_unix_ms, 91);

		record_undo_snapshot(
			&mut history,
			UndoSnapshot {
				root: root.clone(),
				operation_id: "test-history-append".to_string(),
				backup_directories: Vec::new(),
				files: Vec::new(),
				created_directories: Vec::new(),
				applied_at_unix_ms: 99,
				source_kind: UndoSourceKind::Files,
				source_label: None,
				added_lines: None,
				deleted_lines: None,
				recovery_after_state_known: true,
			},
			true,
			10,
		);

		assert_eq!(history.len(), 10);
		let latest = history.last().expect("latest history entry should exist");
		assert_eq!(latest.applied_at_unix_ms, 99);
		assert_eq!(latest.operation_id, "test-history-append");

		for snapshot in history {
			discard_snapshot(snapshot);
		}
	}

	#[test]
	fn br_storage_003_merged_files_undo_drops_unneeded_intermediate_backup_blob() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let first_patch = test_directory.path.join("first/state.ts");
		let second_patch = test_directory.path.join("second/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		let fixture_identity = test_directory.path.to_string_lossy();
		let original_content = format!("original-{fixture_identity}");
		let first_content = format!("first-{fixture_identity}");
		let second_content = format!("second-{fixture_identity}");
		write_test_file(&project_root.join("state.ts"), &original_content);
		write_test_file(&first_patch, &first_content);
		write_test_file(&second_patch, &second_content);

		let (_, first_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![first_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("first overlay should be applied");
		let (_, second_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![second_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("second overlay should be applied");

		let first_blob_id = match &first_snapshot.files[0].kind {
			UndoFileKind::Replaced { backup_blob_id: Some(blob_id), .. } => blob_id.clone(),
			_ => panic!("first replacement should use a content-addressed backup"),
		};
		let second_blob_id = match &second_snapshot.files[0].kind {
			UndoFileKind::Replaced { backup_blob_id: Some(blob_id), .. } => blob_id.clone(),
			_ => panic!("second replacement should use a content-addressed backup"),
		};
		assert_ne!(first_blob_id, second_blob_id);
		clear_recovery_journal(&first_snapshot).expect("first snapshot should commit");
		clear_recovery_journal(&second_snapshot).expect("second snapshot should commit");

		let merged = merge_undo_snapshots(first_snapshot, second_snapshot);
		assert_eq!(merged.backup_directories.len(), 1);
		let merged_blob_references = merged
			.backup_directories
			.iter()
			.map(|directory| storage::snapshot_blob_references(directory))
			.collect::<Result<Vec<_>, _>>()
			.expect("merged snapshot references should remain readable");
		assert!(merged_blob_references.iter().any(|references| references.contains(&first_blob_id)));
		assert!(merged_blob_references.iter().all(|references| !references.contains(&second_blob_id)));
		assert!(storage::blob_path(&first_blob_id).is_ok());

		let execution = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&merged,
		)
		.expect("merged Undo should still restore the original state");
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts")).expect("state should be restored"),
			original_content,
		);
		discard_snapshot(execution.recovery);
		discard_snapshot(merged);
	}

	#[test]
	fn br_recovery_002_multi_undo_restores_sequential_replacements_to_original_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let first_patch = test_directory.path.join("first/state.ts");
		let second_patch = test_directory.path.join("second/state.ts");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("state.ts"),
			"original",
		);
		write_test_file(
			&first_patch,
			"first",
		);
		write_test_file(
			&second_patch,
			"second",
		);

		let (_, first_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![first_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("first overlay should be applied");
		let (_, second_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![second_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("second overlay should be applied");
		let snapshots = vec![first_snapshot, second_snapshot];

		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("latest file should exist"),
			"second",
		);

		let execution = undo_project_overlays_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshots,
		)
		.expect("multi undo should complete atomically");

		assert_eq!(execution.restored_files, 2);
		assert_eq!(execution.removed_files, 0);
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("original file should be restored"),
			"original",
		);
		discard_snapshot(execution.recovery);

		for snapshot in snapshots {
			discard_snapshot(snapshot);
		}
	}

	#[test]
	fn rollback_preserves_unconfirmed_created_file_even_when_content_matches() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("created.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "same-content");
		let fingerprint = file_fingerprint(&destination).expect("fingerprint should be available");
		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root).expect("backup directory should be created");
		let snapshot = UndoSnapshot {
			root: fs::canonicalize(&project_root).expect("project root should canonicalize"),
			operation_id: next_operation_id("test"),
			backup_directories: vec![backup_directory],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("created.ts"),
				kind: UndoFileKind::Created,
				applied_fingerprint: Some(fingerprint),
				recovery_applied: false,
				recovery_allowed_states: vec![Some(fingerprint)],
			}],
			created_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: None,
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};

		assert!(rollback_snapshot(&snapshot).is_err());
		assert_eq!(
			fs::read_to_string(&destination).expect("external file should be preserved"),
			"same-content",
		);
		discard_snapshot(snapshot);
	}

	#[test]
	fn rollback_accepts_known_intermediate_undo_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "second");
		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root).expect("backup directory should be created");
		let backup = backup_directory.join("replaced/state.ts");
		write_test_file(&backup, "second");
		let first_fingerprint = {
			write_test_file(&destination, "first");
			file_fingerprint(&destination).expect("intermediate fingerprint should be available")
		};
		let original_fingerprint = {
			let original = test_directory.path.join("original.ts");
			write_test_file(&original, "original");
			file_fingerprint(&original).expect("final fingerprint should be available")
		};
		let snapshot = UndoSnapshot {
			root: fs::canonicalize(&project_root).expect("project root should canonicalize"),
			operation_id: next_operation_id("test"),
			backup_directories: vec![backup_directory],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("state.ts"),
				kind: UndoFileKind::Replaced {
					backup_path: backup,
					backup_blob_id: None,
				},
				applied_fingerprint: Some(original_fingerprint),
				recovery_applied: true,
				recovery_allowed_states: vec![Some(first_fingerprint), Some(original_fingerprint)],
			}],
			created_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: Some("undo-recovery-test".to_string()),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};

		rollback_snapshot(&snapshot).expect("known intermediate state should be rolled back");
		assert_eq!(
			fs::read_to_string(&destination).expect("pre-undo state should be restored"),
			"second",
		);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_undo_001_created_modified_deleted_restore_exact_prior_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/old.ts"),
			"old",
		);
		write_test_file(
			&project_root.join("src/existing.ts"),
			"existing-before",
		);
		write_test_zip(
			&archive_path,
			&[
				(
					DELETE_MANIFEST_FILE_NAME,
					"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/old.ts\"]}",
				),
				("src/new.ts", "new"),
				("src/existing.ts", "existing-after"),
			],
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("zip overlay should be prepared");

		assert_eq!(prepared.file_count, 2);
		assert_eq!(prepared.delete_count, 1);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("zip overlay should be applied");

		assert_eq!(result.added_files, 1);
		assert_eq!(result.replaced_files, 1);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/old.ts").exists());
		assert_eq!(
			fs::read_to_string(project_root.join("src/new.ts"))
				.expect("new file should exist"),
			"new",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("src/existing.ts"))
				.expect("modified file should exist"),
			"existing-after",
		);
		assert!(!project_root.join(DELETE_MANIFEST_FILE_NAME).exists());

		let undo = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("overlay should be undoable");

		assert_eq!(undo.restored_files, 2);
		assert_eq!(undo.removed_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("src/old.ts"))
				.expect("deleted file should be restored"),
			"old",
		);
		assert!(!project_root.join("src/new.ts").exists());
		assert_eq!(
			fs::read_to_string(project_root.join("src/existing.ts"))
				.expect("modified file should be restored"),
			"existing-before",
		);
		discard_snapshot(undo.recovery);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_undo_002_user_edit_blocks_undo_without_overwrite() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("patch/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("state.ts"), "before");
		write_test_file(&source, "applied");

		let (_, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("overlay should apply");
		write_test_file(&project_root.join("state.ts"), "user-edit");

		let error = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.err()
		.expect("user edit must block undo");
		assert!(error.contains("It is not safe to undo"));
		assert!(error.contains("state.ts"));
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts")).expect("user edit should remain"),
			"user-edit",
		);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_undo_003_concurrent_edit_before_restore_commit_is_preserved() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("state.ts");
		let backup = test_directory.path.join("backup.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "applied");
		write_test_file(&backup, "before");
		let expected_destination = file_fingerprint(&destination)
			.expect("applied state should be fingerprinted");

		let result = safe_fs::atomic_copy_checked(
			&backup,
			&destination,
			|| {
				write_test_file(&destination, "user-edit");
				revalidate_destination_before_commit(
					&project_root,
					Path::new("state.ts"),
					Some(expected_destination),
				)
			},
		);

		assert!(result.is_err());
		assert_eq!(
			fs::read_to_string(&destination).expect("external edit should remain readable"),
			"user-edit",
		);
	}

	#[test]
	fn br_recovery_003_apply_failure_after_first_mutation_restores_pre_apply_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("a.ts"), "a-before");
		write_test_file(&project_root.join("b.ts"), "b-before");
		write_test_zip(&archive_path, &[("a.ts", "a-after"), ("b.ts", "b-after")]);

		let error = {
			let _failure = fail_after_successful_mutations(0);
			apply_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				vec![archive_path.to_string_lossy().into_owned()],
				"./".to_string(),
				String::new(),
			)
			.err()
			.expect("injected failure should abort Apply")
		};
		assert!(error.contains("Injected test failure"));
		assert_eq!(fs::read_to_string(project_root.join("a.ts")).unwrap(), "a-before");
		assert_eq!(fs::read_to_string(project_root.join("b.ts")).unwrap(), "b-before");
	}

	#[test]
	fn br_recovery_004_undo_failure_rolls_back_then_allows_exact_retry() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("a.ts"), "a-before");
		write_test_file(&project_root.join("b.ts"), "b-before");
		write_test_zip(&archive_path, &[("a.ts", "a-after"), ("b.ts", "b-after")]);
		let (_, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("overlay should apply");

		let error = {
			let _failure = fail_after_successful_mutations(0);
			undo_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				&snapshot,
			)
			.err()
			.expect("injected Undo failure should be rolled back")
		};
		assert!(error.contains("Injected test failure"));
		assert_eq!(fs::read_to_string(project_root.join("a.ts")).unwrap(), "a-after");
		assert_eq!(fs::read_to_string(project_root.join("b.ts")).unwrap(), "b-after");

		let retry = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("Undo should remain recoverable after injected failure");
		assert_eq!(fs::read_to_string(project_root.join("a.ts")).unwrap(), "a-before");
		assert_eq!(fs::read_to_string(project_root.join("b.ts")).unwrap(), "b-before");
		discard_snapshot(retry.recovery);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_recovery_006_exact_after_state_recovers_when_applied_flag_was_not_persisted() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("state.ts");
		let expected_after_source = test_directory.path.join("expected-after.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "before");
		write_test_file(&expected_after_source, "after");

		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root)
			.expect("recovery snapshot directory should be created");
		let backup = storage::store_stable_backup(
			&destination,
			&backup_directory,
		)
		.expect("pre-apply state should be preserved");
		let expected_after = file_fingerprint(&expected_after_source)
			.expect("expected after-state should be fingerprinted");
		let snapshot = UndoSnapshot {
			root: canonical_root,
			operation_id: next_operation_id("test"),
			backup_directories: vec![backup_directory.clone()],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("state.ts"),
				kind: UndoFileKind::Replaced {
					backup_path: backup.path,
					backup_blob_id: Some(backup.blob_id),
				},
				applied_fingerprint: Some(expected_after),
				recovery_applied: false,
				recovery_allowed_states: Vec::new(),
			}],
			created_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: Some("recovery-unconfirmed-commit-test".to_string()),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};
		write_recovery_journal(&snapshot).expect("pending journal should be durable before mutation");

		// Simulate a process crash after the atomic destination commit but before
		// mark_recovery_file_applied could persist `applied = true` in the journal.
		write_test_file(&destination, "after");
		restore_recovery_directory(&backup_directory)
			.expect("exact known Orqeto after-state should be recoverable");
		assert_eq!(
			fs::read_to_string(&destination).expect("pre-apply bytes should be restored"),
			"before",
		);

		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_only_zip_is_valid() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("delete-only.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/obsolete.ts"),
			"obsolete",
		);
		write_test_zip(
			&archive_path,
			&[(
				DELETE_MANIFEST_FILE_NAME,
				"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/obsolete.ts\"]}",
			)],
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("delete-only overlay should be prepared");

		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 1);
		assert_eq!(prepared.recommended_candidate_index, Some(0));

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("delete-only overlay should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/obsolete.ts").exists());

		discard_snapshot(snapshot);
	}

	#[test]
	fn standalone_delete_manifest_is_applied_as_delete_only_item() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let manifest_path = test_directory.path.join(DELETE_MANIFEST_FILE_NAME);

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/obsolete.ts"),
			"obsolete",
		);
		write_test_file(
			&manifest_path,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/obsolete.ts\"]}",
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
		)
		.expect("standalone delete manifest should be prepared");

		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 1);
		assert_eq!(prepared.recommended_candidate_index, Some(0));

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("standalone delete manifest should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/obsolete.ts").exists());

		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_manifest_rejects_missing_project_file() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("invalid-delete.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_zip(
			&archive_path,
			&[(
				DELETE_MANIFEST_FILE_NAME,
				"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/missing.ts\"]}",
			)],
		);

		let error = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.err()
		.expect("missing deletion target should be rejected");

		assert!(error.contains("does not exist in the project"));
	}

	#[test]
	fn files_overlay_refuses_to_write_paths_ignored_by_orqeto_devignore() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("patch");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join(".orqeto-devignore"),
			"ignored/\n",
		);
		write_test_file(
			&source_root.join("ignored/secret.ts"),
			"new content",
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("ignored source should be inspected without creating a destination");

		assert!(prepared.root_candidate.is_none());
		assert!(prepared.candidates.is_empty());

		let error = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.err()
		.expect("ignored destination should be rejected during final planning");

		assert!(error.contains(".orqeto-devignore"));
		assert!(!project_root.join("ignored/secret.ts").exists());
	}

	#[test]
	fn delete_manifest_refuses_paths_ignored_by_orqeto_devignore() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join(".orqeto-devignore"),
			"private/\n",
		);
		write_test_file(
			&project_root.join("private/secret.ts"),
			"keep me",
		);

		let canonical_project_root = fs::canonicalize(&project_root)
			.expect("project root should be canonicalized");
		let error = parse_delete_manifest_content(
			&canonical_project_root,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"private/secret.ts\"]}",
		)
		.err()
		.expect("ignored deletion target should be rejected");

		assert!(error.contains(".orqeto-devignore"));
		assert!(project_root.join("private/secret.ts").is_file());
	}

	#[test]
	fn delete_manifest_rejects_invalid_format_and_traversal() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");

		fs::create_dir_all(&project_root).expect("project root should be created");

		let invalid_format = parse_delete_manifest_content(
			&project_root,
			"{\"format\":\"other\",\"version\":1,\"delete\":[]}",
		)
		.err()
		.expect("wrong manifest format should be rejected");
		assert!(invalid_format.contains("format identifier"));

		let traversal = parse_delete_manifest_content(
			&project_root,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"../outside.ts\"]}",
		)
		.err()
		.expect("path traversal should be rejected");
		assert!(traversal.contains("fora do formato esperado"));
	}

	#[test]
	fn delete_manifest_rejects_apply_delete_conflict() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("conflict.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/same.ts"),
			"old",
		);
		write_test_zip(
			&archive_path,
			&[
				(
					DELETE_MANIFEST_FILE_NAME,
					"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/same.ts\"]}",
				),
				("src/same.ts", "new"),
			],
		);

		let error = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.err()
		.expect("same file cannot be applied and deleted");

		assert!(error.contains("apply and delete the same file"));
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("project file should be untouched"),
			"old",
		);
	}

	#[test]
	fn br_scan_001_unreadable_routing_branch_fails_closed() {
		let test_directory = TestDirectory::new();
		let missing = test_directory.path.join("missing-routing-branch");
		let error = read_routing_directory(&missing)
			.err()
			.expect("an unreadable routing branch must fail closed");

		assert!(error.contains("routing was rejected"));
		assert!(error.contains("could not be completed"));
	}

	#[test]
	fn br_scan_002_directory_source_traversal_is_iterative_for_deep_trees() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("incoming");
		fs::create_dir_all(&project_root).expect("project root should be created");
		fs::create_dir_all(&source_root).expect("source root should be created");

		let mut current = source_root.clone();
		for _ in 0..64 {
			current.push("d");
			fs::create_dir(&current).expect("deep source directory should be created");
		}
		write_test_file(
			&current.join("deep.ts"),
			"deep",
		);

		let manifest = build_directory_manifest(
			&fs::canonicalize(&project_root).expect("project root should canonicalize"),
			&source_root,
		)
		.expect("deep source should be traversed iteratively");
		assert_eq!(manifest.files.len(), 1);
		assert!(manifest.files[0].relative_path.ends_with("deep.ts"));
	}

	#[test]
	fn br_route_001_repeated_basename_discovery_caps_expensive_candidate_validation() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("incoming/src");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&source_root.join("main.ts"),
			"export const value = 1\n",
		);

		for index in 0..64 {
			fs::create_dir_all(project_root.join(format!("candidate-{index}/src")))
				.expect("repeated basename candidate should be created");
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("routing analysis should complete without candidate-by-file explosion");

		assert!(prepared.ambiguity_limit_exceeded);
		assert!(prepared.candidate_count > MAX_ROUTING_CANDIDATE_VALIDATIONS);
		assert!(prepared.candidates.is_empty());
		assert_eq!(prepared.recommended_candidate_index, None);
	}

	#[test]
	fn br_route_002_root_relative_zip_requires_strong_exact_file_evidence() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("incoming.zip");
		let foreign_root = test_directory.path.join("foreign-project");
		let matching_root = test_directory.path.join("matching-project");
		let entries = [
			("src/features/context/api.ts", "api"),
			("src/features/context/types.ts", "types"),
			("src/shared/components/Button/index.tsx", "button"),
			("src/shared/components/Button/style.ts", "style"),
			("scripts/check.mts", "check"),
			("src-tauri/src/lib.rs", "lib"),
		];

		write_test_zip(
			&archive_path,
			&entries,
		);

		for (path, _) in entries {
			let destination = foreign_root.join(path);
			fs::create_dir_all(destination.parent().expect("entry should have a parent"))
				.expect("foreign project directories should be created");
		}
		write_test_file(
			&foreign_root.join("src/features/context/types.ts"),
			"foreign",
		);

		let foreign = prepare_project_overlay_blocking(
			foreign_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("weak foreign-project overlap should remain a safe root fallback");
		assert!(foreign.root_candidate.is_some());
		assert!(foreign.candidates.is_empty());
		assert_eq!(foreign.recommended_candidate_index, None);

		for (index, (path, content)) in entries.iter().enumerate() {
			let destination = matching_root.join(path);
			if index < 4 {
				write_test_file(
					&destination,
					content,
				);
			} else {
				fs::create_dir_all(destination.parent().expect("entry should have a parent"))
					.expect("matching project directories should be created");
			}
		}

		let matching = prepare_project_overlay_blocking(
			matching_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("strong exact-path coverage should resolve to the matching root");
		assert_eq!(matching.recommended_candidate_index, Some(0));
		assert_eq!(matching.candidates.len(), 1);
		assert_eq!(matching.candidates[0].destination_relative_path, "./");
		assert_eq!(matching.candidates[0].matched_files, 4);
	}


	#[test]
	fn br_route_002_exact_root_match_survives_repeated_directory_seed_overflow() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("person-dialog-fix.zip");
		let project_root = test_directory.path.join("assignment-manager");
		let relative_path = "src/features/congregation/components/PersonEditorDialog/style.ts";

		write_test_zip(
			&archive_path,
			&[(relative_path, "export const width = 640;\n")],
		);
		write_test_file(
			&project_root.join(relative_path),
			"export const width = 620;\n",
		);

		// Repeated generic directory names intentionally create more cheap
		// candidate seeds than the bounded validator will inspect. They must not
		// hide the independently proven exact ROOT-relative file match above.
		for index in 0..32 {
			fs::create_dir_all(project_root.join(format!(
				"decoy-{index}/src/features/congregation/components/PersonEditorDialog",
			)))
			.expect("decoy routing directories should be created");
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("exact root evidence should survive bounded candidate discovery");

		assert!(prepared.candidate_count > MAX_ROUTING_CANDIDATE_VALIDATIONS);
		assert!(!prepared.ambiguity_limit_exceeded);
		assert_eq!(prepared.recommended_candidate_index, Some(0));
		assert_eq!(prepared.candidates.len(), 1);
		assert_eq!(prepared.candidates[0].destination_relative_path, "./");
		assert_eq!(prepared.candidates[0].matched_files, 1);
	}



	struct FailingReader {
		first_chunk: bool,
	}

	impl std::io::Read for FailingReader {
		fn read(
			&mut self,
			buffer: &mut [u8],
		) -> std::io::Result<usize> {
			if self.first_chunk {
				self.first_chunk = false;
				let content = b"partial-new-content";
				let count = content.len().min(buffer.len());
				buffer[..count].copy_from_slice(&content[..count]);
				Ok(count)
			} else {
				Err(std::io::Error::other("injected temporary write failure"))
			}
		}
	}

	#[test]
	fn br_adv_003_fault_injection_boundaries_fail_closed() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		let destination = project_root.join("state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "before");
		write_test_file(&source, "after");

		{
			let _failure = fail_next_persistence(PersistenceFailurePoint::Snapshot);
			let error = apply_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				vec![source.to_string_lossy().into_owned()],
				"./".to_string(),
				String::new(),
			)
			.err()
			.expect("snapshot persistence failure should abort Apply");
			assert!(error.contains("safety snapshot"));
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		{
			let _failure = fail_next_persistence(PersistenceFailurePoint::Journal);
			let error = apply_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				vec![source.to_string_lossy().into_owned()],
				"./".to_string(),
				String::new(),
			)
			.err()
			.expect("journal persistence failure should abort Apply");
			assert!(error.contains("recovery journal"));
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		{
			let mut reader = FailingReader { first_chunk: true };
			let error = safe_fs::atomic_write_from_reader(
				&destination,
				&mut reader,
			)
			.err()
			.expect("temporary write failure should abort atomic replacement");
			assert_eq!(error.kind(), std::io::ErrorKind::Other);
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		{
			let mut reader = &b"commit-new-content"[..];
			let error = safe_fs::atomic_write_from_reader_checked(
				&destination,
				&mut reader,
				|| Err(std::io::Error::other("injected commit failure")),
			)
			.err()
			.expect("commit failure should abort atomic replacement");
			assert_eq!(error.kind(), std::io::ErrorKind::Other);
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		let canonical_root = fs::canonicalize(&project_root).expect("root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root)
			.expect("recovery snapshot should be created");
		let backup = storage::store_stable_backup(
			&destination,
			&backup_directory,
		)
		.expect("pre-operation state should be backed up");
		let expected_after_source = test_directory.path.join("expected-after.ts");
		write_test_file(&expected_after_source, "known-after");
		let expected_after = file_fingerprint(&expected_after_source)
			.expect("known after-state should be fingerprinted");
		let snapshot = UndoSnapshot {
			root: canonical_root,
			operation_id: next_operation_id("adversarial-recovery"),
			backup_directories: vec![backup_directory.clone()],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("state.ts"),
				kind: UndoFileKind::Replaced {
					backup_path: backup.path,
					backup_blob_id: Some(backup.blob_id),
				},
				applied_fingerprint: Some(expected_after),
				recovery_applied: true,
				recovery_allowed_states: vec![Some(expected_after)],
			}],
			created_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: Some("adversarial-unknown-state".to_string()),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};
		write_recovery_journal(&snapshot).expect("recovery journal should be durable");
		write_test_file(&destination, "external-unknown-state");
		let recovery_error = restore_recovery_directory(&backup_directory)
			.err()
			.expect("unknown recovery state must fail closed");
		assert!(!recovery_error.is_empty());
		assert_eq!(fs::read_to_string(&destination).unwrap(), "external-unknown-state");
		assert!(backup_directory.is_dir());
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_adv_004_zip_and_delete_manifest_path_corpus() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("src/unicode/Δ.ts"), "unicode");
		let canonical_project_root = fs::canonicalize(&project_root)
			.expect("project root should be canonicalized");

		assert_eq!(
			normalize_zip_entry_path(Path::new("src/unicode/Δ.ts"))
				.expect("safe Unicode ZIP path should be accepted"),
			PathBuf::from("src/unicode/Δ.ts"),
		);
		for unsafe_path in ["../escape.ts", "a/../../escape.ts", "/absolute.ts"] {
			assert!(
				normalize_zip_entry_path(Path::new(unsafe_path)).is_err(),
				"unsafe ZIP path {unsafe_path} should be rejected",
			);
		}

		for unsafe_delete in [
			"../outside.ts",
			"./src/unicode/Δ.ts",
			"/absolute.ts",
			"src\\unicode\\Δ.ts",
			"src//unicode/Δ.ts",
		] {
			let content = format!(
				"{{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[{}]}}",
				serde_json::to_string(unsafe_delete).unwrap(),
			);
			assert!(
				parse_delete_manifest_content(&canonical_project_root, &content).is_err(),
				"unsafe delete path {unsafe_delete} should be rejected",
			);
		}

		let safe_delete = "{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/unicode/Δ.ts\"]}";
		let parsed = parse_delete_manifest_content(&canonical_project_root, safe_delete)
			.expect("safe Unicode delete path should be accepted");
		assert_eq!(parsed, vec![PathBuf::from("src/unicode/Δ.ts")]);

		assert!(safe_fs::validate_project_relative_path(
			&canonical_project_root,
			Path::new("src/unicode/Δ.ts"),
		).is_ok());
		for unsafe_relative in ["../escape.ts", "/absolute.ts"] {
			assert!(safe_fs::validate_project_relative_path(
				&canonical_project_root,
				Path::new(unsafe_relative),
			).is_err());
		}

		#[cfg(target_os = "windows")]
		for unsafe_windows in [
			"CON",
			"nul.txt",
			"COM1.log",
			"file.txt:stream",
			"trailing.",
			"trailing ",
		] {
			assert!(safe_fs::validate_project_relative_path(
				&canonical_project_root,
				Path::new(unsafe_windows),
			).is_err());
		}
	}

	#[test]
	fn br_adv_002_ignore_change_between_preview_and_apply_is_rejected() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "incoming");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		write_test_file(&project_root.join(".orqeto-devignore"), "state.ts\n");
		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		let error = validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		)
		.err()
		.expect("ignore change should invalidate the routed preview");
		assert!(error.contains("routing changed"));
		assert!(!project_root.join("state.ts").exists());
	}

}
