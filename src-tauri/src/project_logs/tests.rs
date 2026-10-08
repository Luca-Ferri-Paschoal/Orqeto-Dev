fn test_root(name: &str) -> PathBuf {
	let nonce = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.expect("time")
		.as_nanos();
	std::env::temp_dir().join(format!(
		"orqeto-project-logs-{name}-{}-{nonce}",
		std::process::id(),
	))
}

#[test]
fn development_log_command_is_explicit_only() {
	let root = test_root("config");
	fs::create_dir_all(&root).expect("root");
	fs::write(
		root.join("package.json"),
		r#"{"scripts":{"dev":"ignored"},"orqetoDev":{"logs":{"development":" npm run dev "}}}"#,
	).expect("package");
	assert_eq!(read_development_log_command(&root).as_deref(), Some("npm run dev"));
	fs::write(root.join("package.json"), r#"{"scripts":{"dev":"npm run dev"}}"#).expect("package");
	assert_eq!(read_development_log_command(&root), None);
	fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn log_buffer_is_bounded_redacted_and_clear_advances_the_cursor() {
	let mut buffer = LogBuffer::new();
	buffer.append("stderr", "token=ghp_abcdefghijklmnopqrstuvwxyz123456".to_string());
	assert!(!buffer.entries.front().expect("entry").message.contains("ghp_"));
	for _ in 0..(MAX_LOG_BUFFER_ENTRIES + 10) {
		buffer.append("stdout", "line".to_string());
	}
	assert!(buffer.entries.len() <= MAX_LOG_BUFFER_ENTRIES);
	assert!(buffer.truncated);
	let cursor = buffer.clear_through(None);
	assert!(buffer.entries.is_empty());
	assert!(!buffer.truncated);
	buffer.append("stdout", "after clear".to_string());
	let (entries, _, _) = buffer.snapshot_after(cursor);
	assert_eq!(entries.len(), 1);
	assert_eq!(entries[0].message, "after clear");
	buffer.append("stdout", "newer".to_string());
	let copied_cursor = entries[0].sequence;
	buffer.clear_through(Some(copied_cursor));
	let (remaining, _, _) = buffer.snapshot_after(copied_cursor);
	assert_eq!(remaining.len(), 1);
	assert_eq!(remaining[0].message, "newer");
}

#[test]
fn development_process_streams_output_and_can_stop() {
	let root = test_root("process");
	fs::create_dir_all(&root).expect("root");
	let command = if cfg!(target_os = "windows") {
		"echo ready && ping -n 20 127.0.0.1 >NUL"
	} else {
		"printf 'ready\\n'; sleep 20"
	}.to_string();
	let session = Arc::new(ProjectLogSession {
		session_id: "test".to_string(),
		command: command.clone(),
		started_at_ms: current_unix_ms(),
		running: AtomicBool::new(true),
		stop_requested: AtomicBool::new(false),
		exit_code: Mutex::new(None),
		buffer: Mutex::new(LogBuffer::new()),
	});
	let worker_session = Arc::clone(&session);
	let worker_root = root.clone();
	let worker = thread::spawn(move || run_session(worker_root, command, worker_session));
	let started = Instant::now();
	loop {
		let snapshot = session.snapshot(0).expect("snapshot");
		if snapshot.entries.iter().any(|entry| entry.message.contains("ready")) {
			break;
		}
		assert!(started.elapsed() < Duration::from_secs(5), "output was not captured");
		thread::sleep(Duration::from_millis(20));
	}
	assert!(request_stop_and_wait(&session).expect("stop"));
	worker.join().expect("worker").expect("run");
	assert!(!session.running.load(Ordering::Acquire));
	fs::remove_dir_all(root).expect("cleanup");
}
