fn append_stream<R: Read>(mut reader: R, stream: &'static str, session: Arc<ProjectLogSession>) {
	let mut read_buffer = [0_u8; 8 * 1024];
	let mut pending = Vec::<u8>::new();
	loop {
		let read = match reader.read(&mut read_buffer) {
			Ok(read) => read,
			Err(error) => {
				session.append("system", format!("Could not read {stream}: {error}"));
				break;
			}
		};
		if read == 0 {
			break;
		}
		pending.extend_from_slice(&read_buffer[..read]);
		loop {
			let newline = pending.iter().position(|byte| *byte == b'\n');
			let chunk_len = match newline {
				Some(index) => index.saturating_add(1),
				None if pending.len() >= MAX_STREAM_ENTRY_BYTES => MAX_STREAM_ENTRY_BYTES,
				None => break,
			};
			let remainder = pending.split_off(chunk_len);
			let chunk = std::mem::replace(&mut pending, remainder);
			let message = String::from_utf8_lossy(&chunk)
				.trim_end_matches(|character| character == '\r' || character == '\n')
				.to_string();
			session.append(stream, message);
		}
	}
	if !pending.is_empty() {
		session.append(
			stream,
			String::from_utf8_lossy(&pending).into_owned(),
		);
	}
}

fn run_session(root: PathBuf, command_text: String, session: Arc<ProjectLogSession>) -> Result<(), String> {
	let mut command = create_development_command(&root, &command_text);
	let mut child = command
		.spawn()
		.map_err(|error| format!("Could not start the development command: {error}"))?;
	let stdout = match child.stdout.take() {
		Some(stdout) => stdout,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The development command did not provide stdout.".to_string());
		}
	};
	let stderr = match child.stderr.take() {
		Some(stderr) => stderr,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The development command did not provide stderr.".to_string());
		}
	};
	let stdout_session = Arc::clone(&session);
	let stderr_session = Arc::clone(&session);
	let stdout_task = thread::spawn(move || append_stream(stdout, "stdout", stdout_session));
	let stderr_task = thread::spawn(move || append_stream(stderr, "stderr", stderr_session));

	let mut stopped = false;
	let exit_code = loop {
		if session.stop_requested.load(Ordering::Acquire) {
			stopped = true;
			process_tree::terminate_process_tree(&mut child);
			break None;
		}
		match child.try_wait() {
			Ok(Some(status)) => break status.code(),
			Ok(None) => thread::sleep(PROCESS_POLL_INTERVAL),
			Err(error) => {
				process_tree::terminate_process_tree(&mut child);
				session.append("system", format!("Could not wait for the development command: {error}"));
				break None;
			}
		}
	};
	let _ = stdout_task.join();
	let _ = stderr_task.join();
	if let Ok(mut stored_exit_code) = session.exit_code.lock() {
		*stored_exit_code = exit_code;
	}
	if stopped {
		session.append("system", "Development command stopped.".to_string());
	} else if let Some(code) = exit_code {
		session.append("system", format!("Development command exited with code {code}."));
	} else {
		session.append("system", "Development command finished.".to_string());
	}
	session.running.store(false, Ordering::Release);
	Ok(())
}

fn empty_snapshot() -> ProjectLogSnapshot {
	ProjectLogSnapshot {
		session_id: None,
		command: None,
		running: false,
		started_at_ms: None,
		exit_code: None,
		entries: Vec::new(),
		truncated: false,
		latest_sequence: 0,
	}
}
