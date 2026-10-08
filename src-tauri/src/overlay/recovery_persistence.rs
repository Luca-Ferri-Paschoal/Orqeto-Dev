const RECOVERY_FILE_NAME: &str = "recovery.json";
const RECOVERY_FORMAT: &str = "orqeto-dev-recovery";
const RECOVERY_VERSION: u32 = 5;

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
	deleted_directories: Vec<PathBuf>,
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

fn persisted_undo_history_path(directory: &Path) -> PathBuf {
	directory.join(UNDO_HISTORY_FILE_NAME)
}

fn persist_undo_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	if snapshot.backup_directories.is_empty() {
		return Err("The application history has no managed snapshot directory.".to_string());
	}

	persistence_failure_checkpoint(PersistenceFailurePoint::History)?;
	let document = PersistedUndoHistory {
		format: UNDO_HISTORY_FORMAT.to_string(),
		version: UNDO_HISTORY_VERSION,
		snapshot: snapshot.clone(),
	};
	let content = serde_json::to_vec(&document)
		.map_err(|error| format!("Could not serialize the persistent application history: {error}"))?;
	if u64::try_from(content.len()).unwrap_or(u64::MAX) > MAX_UNDO_HISTORY_METADATA_BYTES {
		return Err("The persistent application-history metadata is too large.".to_string());
	}

	// Every directory retained by a merged Undo entry carries the same compact
	// history record. Startup can therefore distinguish all live ActiveUndo
	// directories from stale storage before reconstructing and deduplicating the
	// in-memory history.
	for directory in &snapshot.backup_directories {
		storage::validate_managed_directory(directory)?;
		safe_fs::atomic_write_bytes(
			&persisted_undo_history_path(directory),
			&content,
		)
		.map_err(|error| format!("Could not persist the application history: {error}"))?;
	}

	Ok(())
}

fn load_persisted_undo_snapshot(directory: &Path) -> Result<Option<UndoSnapshot>, String> {
	storage::validate_managed_directory(directory)?;
	let path = persisted_undo_history_path(directory);
	let metadata = match fs::symlink_metadata(&path) {
		Ok(metadata) => metadata,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
		Err(error) => {
			return Err(format!(
				"Could not inspect {}: {error}",
				path.display(),
			));
		}
	};
	if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
		return Err(format!(
			"Persistent application history is not a safe regular file: {}.",
			path.display(),
		));
	}
	if metadata.len() > MAX_UNDO_HISTORY_METADATA_BYTES {
		return Err("Persistent application-history metadata exceeds the safety limit.".to_string());
	}
	storage::validate_managed_regular_file(&path)?;
	let content = fs::read(&path)
		.map_err(|error| format!("Could not read persistent application history: {error}"))?;
	let document: PersistedUndoHistory = serde_json::from_slice(&content)
		.map_err(|error| format!("Persistent application history is invalid: {error}"))?;
	if document.format != UNDO_HISTORY_FORMAT || document.version != UNDO_HISTORY_VERSION {
		return Err("Persistent application history uses an unsupported format or version.".to_string());
	}

	let snapshot = document.snapshot;
	if snapshot.operation_id.trim().is_empty() ||
		(snapshot.files.is_empty() && snapshot.deleted_directories.is_empty()) ||
		!snapshot.root.is_absolute()
	{
		return Err("Persistent application history contains invalid operation metadata.".to_string());
	}
	let canonical_directory = fs::canonicalize(directory)
		.map_err(|error| format!("Could not validate persistent application history: {error}"))?;
	let mut owns_directory = false;
	for backup_directory in &snapshot.backup_directories {
		let canonical_backup = fs::canonicalize(backup_directory)
			.map_err(|error| format!("Could not validate the history backup directory: {error}"))?;
		if canonical_backup == canonical_directory {
			owns_directory = true;
		}
	}
	if !owns_directory {
		return Err("Persistent application history is stored under an unrelated snapshot directory.".to_string());
	}

	for backup_directory in &snapshot.backup_directories {
		storage::validate_managed_directory(backup_directory)?;
		if storage::storage_class(backup_directory)? != storage::StorageClass::ActiveUndo {
			return Err("Persistent application history references a non-active Undo snapshot.".to_string());
		}
	}
	for file in &snapshot.files {
		parse_relative_path(&file.destination_relative_path.to_string_lossy())?;
		let _ = validated_undo_backup_path(&file.kind)?;
	}
	for directory in snapshot.created_directories.iter().chain(&snapshot.deleted_directories) {
		parse_relative_path(&directory.to_string_lossy())?;
	}

	Ok(Some(snapshot))
}

fn has_persisted_undo_history_file(directory: &Path) -> Result<bool, String> {
	let path = persisted_undo_history_path(directory);
	match fs::symlink_metadata(&path) {
		Ok(metadata) => {
			if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
				return Err(format!(
					"Persistent application history is not a safe regular file: {}.",
					path.display(),
				));
			}
			Ok(true)
		}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
		Err(error) => Err(format!("Could not inspect persistent application history: {error}")),
	}
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PersistenceFailurePoint {
	Snapshot,
	Journal,
	History,
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
				PersistenceFailurePoint::History => "Injected test failure while persisting application history.",
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
	if snapshot.files.is_empty() && snapshot.created_directories.is_empty() && snapshot.deleted_directories.is_empty() {
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
		deleted_directories: snapshot.deleted_directories.clone(),
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

