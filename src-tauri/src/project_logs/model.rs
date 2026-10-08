#[cfg(target_os = "windows")]
const WINDOWS_NO_WINDOW: u32 = 0x0800_0000;
const MAX_LOG_BUFFER_BYTES: usize = 8 * 1024 * 1024;
const MAX_LOG_BUFFER_ENTRIES: usize = 20_000;
const MAX_LOG_COMMAND_CHARS: usize = 8_192;
const MAX_STREAM_ENTRY_BYTES: usize = 64 * 1024;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLogEntry {
	sequence: u64,
	timestamp_ms: u64,
	stream: String,
	message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLogSnapshot {
	session_id: Option<String>,
	command: Option<String>,
	running: bool,
	started_at_ms: Option<u64>,
	exit_code: Option<i32>,
	entries: Vec<ProjectLogEntry>,
	truncated: bool,
	latest_sequence: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLogClearResult {
	cursor: u64,
}

struct LogBuffer {
	entries: VecDeque<ProjectLogEntry>,
	bytes: usize,
	next_sequence: u64,
	truncated: bool,
}

impl LogBuffer {
	fn new() -> Self {
		Self {
			entries: VecDeque::new(),
			bytes: 0,
			next_sequence: 1,
			truncated: false,
		}
	}

	fn append(
		&mut self,
		stream: &str,
		message: String,
	) {
		if message.is_empty() {
			return;
		}
		let message = context_redaction::redact_unstructured_text(message);
		let message_bytes = message.len();
		let entry = ProjectLogEntry {
			sequence: self.next_sequence,
			timestamp_ms: current_unix_ms(),
			stream: stream.to_string(),
			message,
		};
		self.next_sequence = self.next_sequence.saturating_add(1);
		self.bytes = self.bytes.saturating_add(message_bytes);
		self.entries.push_back(entry);

		while self.bytes > MAX_LOG_BUFFER_BYTES || self.entries.len() > MAX_LOG_BUFFER_ENTRIES {
			let Some(removed) = self.entries.pop_front() else {
				break;
			};
			self.bytes = self.bytes.saturating_sub(removed.message.len());
			self.truncated = true;
		}
	}

	fn clear_through(&mut self, through_sequence: Option<u64>) -> u64 {
		let latest_sequence = self.next_sequence.saturating_sub(1);
		let cursor = through_sequence
			.unwrap_or(latest_sequence)
			.min(latest_sequence);
		while self
			.entries
			.front()
			.is_some_and(|entry| entry.sequence <= cursor)
		{
			let Some(removed) = self.entries.pop_front() else {
				break;
			};
			self.bytes = self.bytes.saturating_sub(removed.message.len());
		}
		self.truncated = false;
		cursor
	}

	fn snapshot_after(&self, after_sequence: u64) -> (Vec<ProjectLogEntry>, bool, u64) {
		let entries = self.entries
			.iter()
			.filter(|entry| entry.sequence > after_sequence)
			.cloned()
			.collect();
		(
			entries,
			self.truncated,
			self.next_sequence.saturating_sub(1),
		)
	}
}

struct ProjectLogSession {
	session_id: String,
	command: String,
	started_at_ms: u64,
	running: AtomicBool,
	stop_requested: AtomicBool,
	exit_code: Mutex<Option<i32>>,
	buffer: Mutex<LogBuffer>,
}

impl ProjectLogSession {
	fn append(&self, stream: &str, message: String) {
		if let Ok(mut buffer) = self.buffer.lock() {
			buffer.append(stream, message);
		}
	}

	fn snapshot(&self, after_sequence: u64) -> Result<ProjectLogSnapshot, String> {
		let (entries, truncated, latest_sequence) = self
			.buffer
			.lock()
			.map_err(|_| "The project log buffer became unavailable.".to_string())?
			.snapshot_after(after_sequence);
		let exit_code = *self
			.exit_code
			.lock()
			.map_err(|_| "The project log process state became unavailable.".to_string())?;
		Ok(ProjectLogSnapshot {
			session_id: Some(self.session_id.clone()),
			command: Some(self.command.clone()),
			running: self.running.load(Ordering::Acquire),
			started_at_ms: Some(self.started_at_ms),
			exit_code,
			entries,
			truncated,
			latest_sequence,
		})
	}
}

#[derive(Default)]
struct ProjectLogStateInner {
	approved_commands: HashSet<(PathBuf, String)>,
	sessions: HashMap<PathBuf, Arc<ProjectLogSession>>,
}

pub struct ProjectLogState(Mutex<ProjectLogStateInner>);

impl ProjectLogState {
	pub fn new() -> Self {
		Self(Mutex::new(ProjectLogStateInner::default()))
	}

	fn session(&self, root: &Path) -> Result<Option<Arc<ProjectLogSession>>, String> {
		Ok(self
			.0
			.lock()
			.map_err(|_| "The project log state became unavailable.".to_string())?
			.sessions
			.get(root)
			.cloned())
	}

	fn approve(&self, root: PathBuf, command: String) -> Result<(), String> {
		self
			.0
			.lock()
			.map_err(|_| "The project log state became unavailable.".to_string())?
			.approved_commands
			.insert((root, command));
		Ok(())
	}

	fn is_approved(&self, root: &Path, command: &str) -> Result<bool, String> {
		Ok(self
			.0
			.lock()
			.map_err(|_| "The project log state became unavailable.".to_string())?
			.approved_commands
			.contains(&(root.to_path_buf(), command.to_string())))
	}

	fn insert_session(&self, root: PathBuf, session: Arc<ProjectLogSession>) -> Result<(), String> {
		self
			.0
			.lock()
			.map_err(|_| "The project log state became unavailable.".to_string())?
			.sessions
			.insert(root, session);
		Ok(())
	}

	pub fn stop_all_and_wait(&self) -> Result<(), String> {
		let sessions = self
			.0
			.lock()
			.map_err(|_| "The project log state became unavailable.".to_string())?
			.sessions
			.values()
			.cloned()
			.collect::<Vec<_>>();
		for session in &sessions {
			session.stop_requested.store(true, Ordering::Release);
		}
		let started = std::time::Instant::now();
		while sessions.iter().any(|session| session.running.load(Ordering::Acquire)) {
			if started.elapsed() > STOP_WAIT_TIMEOUT {
				return Err("A project log process could not be stopped before shutdown.".to_string());
			}
			thread::sleep(PROCESS_POLL_INTERVAL);
		}
		Ok(())
	}
}

fn request_stop_and_wait(session: &ProjectLogSession) -> Result<bool, String> {
	if !session.running.load(Ordering::Acquire) {
		return Ok(false);
	}
	session.stop_requested.store(true, Ordering::Release);
	let started = std::time::Instant::now();
	while session.running.load(Ordering::Acquire) {
		if started.elapsed() > STOP_WAIT_TIMEOUT {
			return Err("The project log process could not be stopped in time.".to_string());
		}
		thread::sleep(PROCESS_POLL_INTERVAL);
	}
	Ok(true)
}

fn current_unix_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
		.unwrap_or_default()
}
