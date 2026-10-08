#[tauri::command]
pub fn approve_project_log_command(
	root_folder: String,
	expected_command: String,
	state: State<'_, ProjectLogState>,
) -> Result<(), String> {
	let root = canonical_project_root(&root_folder)?;
	let current_command = read_development_log_command(&root)
		.ok_or_else(|| "No development log command is configured at orqetoDev.logs.development.".to_string())?;
	if current_command != expected_command {
		return Err("The configured development command changed before approval. Review it and try again.".to_string());
	}
	state.approve(root, current_command)
}

#[tauri::command]
pub fn start_project_log_session(
	root_folder: String,
	state: State<'_, ProjectLogState>,
) -> Result<ProjectLogSnapshot, String> {
	let root = canonical_project_root(&root_folder)?;
	let command = read_development_log_command(&root)
		.ok_or_else(|| "No development log command is configured at orqetoDev.logs.development.".to_string())?;
	if !state.is_approved(&root, &command)? {
		return Err("The development command must be approved for this app session before it can run.".to_string());
	}
	if let Some(existing) = state.session(&root)? {
		if existing.running.load(Ordering::Acquire) {
			return existing.snapshot(0);
		}
	}

	let session = Arc::new(ProjectLogSession {
		session_id: crate::operation_id::next_operation_id("project_log"),
		command: command.clone(),
		started_at_ms: current_unix_ms(),
		running: AtomicBool::new(true),
		stop_requested: AtomicBool::new(false),
		exit_code: Mutex::new(None),
		buffer: Mutex::new(LogBuffer::new()),
	});
	session.append("system", "Development command started.".to_string());
	state.insert_session(root.clone(), Arc::clone(&session))?;
	let thread_session = Arc::clone(&session);
	if let Err(error) = thread::Builder::new()
		.name("orqeto-project-log".to_string())
		.spawn(move || {
			if let Err(error) = run_session(root, command, Arc::clone(&thread_session)) {
				thread_session.append("system", error);
				thread_session.running.store(false, Ordering::Release);
			}
		})
	{
		session.running.store(false, Ordering::Release);
		return Err(format!("Could not create the project log worker: {error}"));
	}
	session.snapshot(0)
}

#[tauri::command]
pub async fn stop_project_log_session(
	root_folder: String,
	state: State<'_, ProjectLogState>,
) -> Result<bool, String> {
	let root = canonical_project_root(&root_folder)?;
	let Some(session) = state.session(&root)? else {
		return Ok(false);
	};
	tauri::async_runtime::spawn_blocking(move || request_stop_and_wait(&session))
		.await
		.map_err(|error| format!("Stopping the project log process was interrupted: {error}"))?
}

#[tauri::command]
pub async fn get_project_log_snapshot(
	root_folder: String,
	after_sequence: Option<u64>,
	state: State<'_, ProjectLogState>,
) -> Result<ProjectLogSnapshot, String> {
	let root = canonical_project_root(&root_folder)?;
	let Some(session) = state.session(&root)? else {
		return Ok(empty_snapshot());
	};
	let cursor = after_sequence.unwrap_or_default();
	tauri::async_runtime::spawn_blocking(move || session.snapshot(cursor))
		.await
		.map_err(|error| format!("Reading the project log buffer was interrupted: {error}"))?
}

#[tauri::command]
pub fn clear_project_log_session(
	root_folder: String,
	through_sequence: Option<u64>,
	state: State<'_, ProjectLogState>,
) -> Result<ProjectLogClearResult, String> {
	let root = canonical_project_root(&root_folder)?;
	let Some(session) = state.session(&root)? else {
		return Ok(ProjectLogClearResult { cursor: 0 });
	};
	let cursor = session
		.buffer
		.lock()
		.map_err(|_| "The project log buffer became unavailable.".to_string())?
		.clear_through(through_sequence);
	Ok(ProjectLogClearResult { cursor })
}
