#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct UndoSnapshot {
	root: PathBuf,
	operation_id: String,
	backup_directories: Vec<PathBuf>,
	files: Vec<UndoFile>,
	created_directories: Vec<PathBuf>,
	#[serde(default)]
	deleted_directories: Vec<PathBuf>,
	applied_at_unix_ms: u64,
	source_kind: UndoSourceKind,
	source_label: Option<String>,
	source_fingerprints: Vec<String>,
	added_lines: Option<usize>,
	deleted_lines: Option<usize>,
	recovery_after_state_known: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedUndoHistory {
	format: String,
	version: u32,
	snapshot: UndoSnapshot,
}

// Bootstrap runs on a worker so the window can paint immediately. Until recovery
// and the persisted Undo history have finished loading, writes must not start.
static STARTUP_TASKS: OnceLock<(Mutex<bool>, Condvar)> = OnceLock::new();

fn startup_tasks() -> &'static (Mutex<bool>, Condvar) {
	STARTUP_TASKS.get_or_init(|| (Mutex::new(false), Condvar::new()))
}

pub(crate) fn begin_startup_tasks() {
	let (pending, _) = startup_tasks();
	*pending.lock().expect("Startup state lock was poisoned") = true;
}

pub(crate) fn finish_startup_tasks() {
	let (pending, ready) = startup_tasks();
	if let Ok(mut pending) = pending.lock() {
		*pending = false;
		ready.notify_all();
	}
}

pub(crate) fn wait_for_startup_tasks() -> Result<(), String> {
	let (pending, ready) = startup_tasks();
	let mut pending = pending.lock().map_err(|_| "Startup state became unavailable.".to_string())?;
	while *pending {
		pending = ready.wait(pending)
			.map_err(|_| "Startup state became unavailable.".to_string())?;
	}
	Ok(())
}

pub(crate) fn startup_tasks_pending() -> Result<bool, String> {
	startup_tasks().0.lock()
		.map(|pending| *pending)
		.map_err(|_| "Startup state became unavailable.".to_string())
}

pub(crate) fn protect_startup_failure() {
	protect_mutations("Startup recovery was interrupted. Project changes are blocked until a safe restart.".to_string());
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

