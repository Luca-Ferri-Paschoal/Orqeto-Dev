fn read_bounded<R: Read + Send + 'static>(
	mut reader: R,
	total_bytes: Arc<AtomicUsize>,
	exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<io::Result<Vec<u8>>> {
	thread::spawn(move || {
		let mut output = Vec::new();
		let mut buffer = [0_u8; 64 * 1024];
		loop {
			let read = reader.read(&mut buffer)?;
			if read == 0 {
				break;
			}
			let previous = total_bytes.fetch_add(read, Ordering::AcqRel);
			if previous.saturating_add(read) > MAX_DIAGNOSTIC_OUTPUT_BYTES {
				exceeded.store(true, Ordering::Release);
				continue;
			}
			output.extend_from_slice(&buffer[..read]);
		}
		Ok(output)
	})
}

fn run_bounded_command_with_runtime(
	mut command: Command,
	max_runtime: Duration,
	operation_label: &str,
	cancellation: Option<&AtomicBool>,
) -> Result<CapturedOutput, String> {
	process_tree::configure_process_tree(&mut command);
	command.stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = command
		.spawn()
		.map_err(|error| format!("Could not start {operation_label}: {error}"))?;
	let stdout = match child.stdout.take() {
		Some(stdout) => stdout,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err(format!("The {operation_label} did not provide stdout."));
		}
	};
	let stderr = match child.stderr.take() {
		Some(stderr) => stderr,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err(format!("The {operation_label} did not provide stderr."));
		}
	};
	let exceeded = Arc::new(AtomicBool::new(false));
	let total_bytes = Arc::new(AtomicUsize::new(0));
	let stdout_task = read_bounded(stdout, Arc::clone(&total_bytes), Arc::clone(&exceeded));
	let stderr_task = read_bounded(stderr, Arc::clone(&total_bytes), Arc::clone(&exceeded));
	let started = Instant::now();
	let status_result = loop {
		if cancellation.is_some_and(|token| token.load(Ordering::Acquire)) {
			process_tree::terminate_process_tree(&mut child);
			break Err(format!("The {operation_label} was cancelled."));
		}
		if exceeded.load(Ordering::Acquire) {
			process_tree::terminate_process_tree(&mut child);
			break Err(format!(
				"The {operation_label} output exceeded the {} MiB limit.",
				MAX_DIAGNOSTIC_OUTPUT_BYTES / (1024 * 1024),
			));
		}
		if started.elapsed() > max_runtime {
			process_tree::terminate_process_tree(&mut child);
			let runtime_minutes = max_runtime.as_secs() / 60;
			break Err(format!(
				"The {operation_label} exceeded the {runtime_minutes}-minute limit and was stopped.",
			));
		}
		match child.try_wait() {
			Ok(Some(status)) => break Ok(status),
			Ok(None) => thread::sleep(Duration::from_millis(10)),
			Err(error) => {
				process_tree::terminate_process_tree(&mut child);
				break Err(format!("Could not wait for the {operation_label}: {error}"));
			}
		}
	};
	let stdout = stdout_task
		.join()
		.map_err(|_| format!("Reading {operation_label} output was interrupted."))?
		.map_err(|error| format!("Could not read {operation_label} output: {error}"))?;
	let stderr = stderr_task
		.join()
		.map_err(|_| format!("Reading {operation_label} stderr was interrupted."))?
		.map_err(|error| format!("Could not read {operation_label} stderr: {error}"))?;
	let status = status_result?;

	Ok(CapturedOutput { status, stdout, stderr })
}

fn run_bounded_command(command: Command) -> Result<CapturedOutput, String> {
	run_bounded_command_with_runtime(
		command,
		MAX_DIAGNOSTIC_RUNTIME,
		"diagnostic tool",
		None,
	)
}

fn run_bounded_cancellable_diagnostic_command(
	command: Command,
	cancellation: &AtomicBool,
) -> Result<CapturedOutput, String> {
	run_bounded_command_with_runtime(
		command,
		MAX_DIAGNOSTIC_RUNTIME,
		"diagnostic tool",
		Some(cancellation),
	)
}

fn run_bounded_custom_validation_command(
	command: Command,
	cancellation: &AtomicBool,
) -> Result<CapturedOutput, String> {
	run_bounded_command_with_runtime(
		command,
		MAX_CUSTOM_VALIDATION_RUNTIME,
		"custom validation command",
		Some(cancellation),
	)
}

#[cfg(target_os = "windows")]
fn child_process_path(path: &Path) -> OsString {
	use std::os::windows::ffi::{OsStrExt, OsStringExt};
	use std::path::{Component, Prefix};

	let mut components = path.components();
	let Some(Component::Prefix(prefix)) = components.next() else {
		return path.as_os_str().to_os_string();
	};
	let path_wide = path.as_os_str().encode_wide().collect::<Vec<_>>();

	match prefix.kind() {
		Prefix::VerbatimDisk(_) => {
			const VERBATIM_PREFIX_LEN: usize = 4;
			if path_wide.len() > VERBATIM_PREFIX_LEN {
				OsString::from_wide(&path_wide[VERBATIM_PREFIX_LEN..])
			} else {
				path.as_os_str().to_os_string()
			}
		}
		Prefix::VerbatimUNC(_, _) => {
			const VERBATIM_UNC_PREFIX_LEN: usize = 8;
			if path_wide.len() > VERBATIM_UNC_PREFIX_LEN {
				let mut normalized = Vec::with_capacity(path_wide.len().saturating_sub(6));
				normalized.extend_from_slice(&[b'\\' as u16, b'\\' as u16]);
				normalized.extend_from_slice(&path_wide[VERBATIM_UNC_PREFIX_LEN..]);
				OsString::from_wide(&normalized)
			} else {
				path.as_os_str().to_os_string()
			}
		}
		_ => path.as_os_str().to_os_string(),
	}
}

#[cfg(not(target_os = "windows"))]
fn child_process_path(path: &Path) -> OsString {
	path.as_os_str().to_os_string()
}

fn create_node_command(
	node: &Path,
	cwd: &Path,
	script: &Path,
) -> Command {
	let mut command = Command::new(child_process_path(node));
	command
		.current_dir(cwd)
		.arg(child_process_path(script))
		.stdin(Stdio::null())
		.env_remove("NODE_OPTIONS")
		.env_remove("NODE_PATH")
		.env("NO_COLOR", "1")
		.env("FORCE_COLOR", "0")
		.env("CI", "1");

	#[cfg(target_os = "windows")]
	command.creation_flags(WINDOWS_NO_WINDOW);

	command
}

fn create_custom_validation_command(
	root: &Path,
	command_text: &str,
) -> Command {
	#[cfg(target_os = "windows")]
	let mut command = {
		let shell = std::env::var_os("COMSPEC").unwrap_or_else(|| OsString::from("cmd.exe"));
		let mut command = Command::new(shell);
		command
			.arg("/D")
			.arg("/S")
			.arg("/C")
			.arg(command_text);
		command.creation_flags(WINDOWS_NO_WINDOW);
		command
	};

	#[cfg(not(target_os = "windows"))]
	let mut command = {
		let mut command = Command::new("sh");
		command
			.arg("-lc")
			.arg(command_text);
		command
	};

	command
		.current_dir(root)
		.stdin(Stdio::null())
		.env("NO_COLOR", "1")
		.env("FORCE_COLOR", "0");
	command
}

fn run_custom_validation_command_blocking(
	root: PathBuf,
	kind: String,
	command_text: String,
	cancellation: &AtomicBool,
) -> Result<ProjectValidationCommandResult, String> {
	let started = Instant::now();
	let output = run_bounded_custom_validation_command(
		create_custom_validation_command(
			&root,
			&command_text,
		),
		cancellation,
	)?;
	let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
	let reported_command = crate::context_redaction::redact_unstructured_text(command_text);

	Ok(ProjectValidationCommandResult {
		kind,
		command: reported_command,
		exit_code: output.status.code(),
		success: output.status.success(),
		duration_ms,
		stdout: crate::context_redaction::redact_unstructured_text(
			String::from_utf8_lossy(&output.stdout).into_owned(),
		),
		stderr: crate::context_redaction::redact_unstructured_text(
			String::from_utf8_lossy(&output.stderr).into_owned(),
		),
	})
}

