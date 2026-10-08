fn execute_command_bounded(
	mut command: Command,
	stdin_data: Option<Arc<[u8]>>,
) -> Result<Output, GitCommandExecutionError> {
	process_tree::configure_process_tree(&mut command);
	if stdin_data.is_some() {
		command.stdin(Stdio::piped());
	} else {
		command.stdin(Stdio::null());
	}
	command.stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = command
		.spawn()
		.map_err(|error| GitCommandExecutionError::Spawn(format!("Could not start Git: {error}")))?;
	let stdin_task = if let Some(data) = stdin_data {
		let Some(mut stdin) = child.stdin.take() else {
			process_tree::terminate_process_tree(&mut child);
			return Err(GitCommandExecutionError::Runtime("Git did not provide stdin for the immutable patch.".to_string()));
		};
		Some(thread::spawn(move || -> io::Result<()> {
			stdin.write_all(&data)?;
			stdin.flush()?;
			Ok(())
		}))
	} else {
		None
	};
	let Some(stdout) = child.stdout.take() else {
		process_tree::terminate_process_tree(&mut child);
		return Err(GitCommandExecutionError::Runtime("Git did not provide stdout.".to_string()));
	};
	let Some(stderr) = child.stderr.take() else {
		process_tree::terminate_process_tree(&mut child);
		return Err(GitCommandExecutionError::Runtime("Git did not provide stderr.".to_string()));
	};
	let exceeded = Arc::new(AtomicBool::new(false));
	let total_bytes = Arc::new(AtomicUsize::new(0));
	let stdout_task = read_bounded(
		stdout,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);
	let stderr_task = read_bounded(
		stderr,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);

	let mut wait_error = None;
	let mut timed_out = false;
	let started = Instant::now();
	let status = loop {
		if exceeded.load(Ordering::Acquire) {
			process_tree::terminate_process_tree(&mut child);
			break None;
		}
		if started.elapsed() > MAX_GIT_COMMAND_RUNTIME {
			timed_out = true;
			process_tree::terminate_process_tree(&mut child);
			break None;
		}
		match child.try_wait() {
			Ok(Some(status)) => break Some(status),
			Ok(None) => thread::sleep(Duration::from_millis(5)),
			Err(error) => {
				wait_error = Some(error);
				process_tree::terminate_process_tree(&mut child);
				break None;
			}
		}
	};
	let stdin_result: Option<io::Result<()>> = stdin_task.map(|task| match task.join() {
		Ok(result) => result,
		Err(_) => Err(io::Error::other(
			"writing the patch to Git was interrupted",
		)),
	});
	let stdout = stdout_task
		.join()
		.map_err(|_| GitCommandExecutionError::Runtime("Reading Git output was interrupted.".to_string()))?
		.map_err(|error| GitCommandExecutionError::Runtime(format!("Could not read Git output: {error}")))?;
	let stderr = stderr_task
		.join()
		.map_err(|_| GitCommandExecutionError::Runtime("Reading Git stderr was interrupted.".to_string()))?
		.map_err(|error| GitCommandExecutionError::Runtime(format!("Could not read Git stderr: {error}")))?;

	let Some(status) = status else {
		if timed_out {
			return Err(GitCommandExecutionError::Runtime(
				"Git exceeded the 5-minute limit and was stopped.".to_string(),
			));
		}
		if let Some(error) = wait_error {
			return Err(GitCommandExecutionError::Runtime(format!("Could not wait for Git: {error}")));
		}
		return Err(GitCommandExecutionError::Runtime(format!(
			"Combined Git output exceeded the {} MiB limit and the operation was stopped.",
			MAX_GIT_COMMAND_OUTPUT_BYTES / (1024 * 1024),
		)));
	};

	if status.success() {
		if let Some(Err(error)) = stdin_result {
			return Err(GitCommandExecutionError::Runtime(format!(
				"Could not provide Git with the complete immutable patch bytes: {error}",
			)));
		}
	}

	Ok(Output { status, stdout, stderr })
}

fn execute_git(
	root: &Path,
	args: &[&str],
) -> Result<Output, String> {
	let mut last_error: Option<String> = None;

	for executable in git_candidates() {
		let mut command = configure_git_command(
			&executable,
			root,
		);
		command.args(args);

		match execute_command_bounded(command, None) {
			Ok(output) => return Ok(output),
			Err(GitCommandExecutionError::Spawn(error)) => {
				last_error = Some(format!(
					"Could not execute {}: {error}",
					executable.display(),
				));
			}
			Err(error @ GitCommandExecutionError::Runtime(_)) => {
				return Err(format!(
					"Execution of {} failed after the process started: {}",
					executable.display(),
					error.into_message(),
				));
			}
		}
	}

	Err(last_error.unwrap_or_else(|| {
		"Could not locate Git on this computer.".to_string()
	}))
}

struct GitApplySandbox {
	root: PathBuf,
	git_dir: PathBuf,
	global_config: PathBuf,
	xdg_config_home: PathBuf,
}

impl Drop for GitApplySandbox {
	fn drop(&mut self) {
		let _ = fs::remove_dir_all(&self.root);
	}
}

fn create_git_apply_sandbox() -> Result<GitApplySandbox, String> {
	let base = std::env::temp_dir().join("orqeto-dev").join("git-apply-sandboxes");
	safe_fs::create_dir_all_durable(&base)
		.map_err(|error| format!("Could not prepare the private Git environment: {error}"))?;
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(|error| format!("Could not identify the private Git environment: {error}"))?
		.as_nanos();

	for attempt in 0_u32..128 {
		let root = base.join(format!(
			"git-apply-{}-{timestamp}-{attempt}",
			std::process::id(),
		));
		match fs::create_dir(&root) {
			Ok(()) => {
				let git_dir = root.join("git-dir");
				let xdg_config_home = root.join("xdg");
				fs::create_dir(&git_dir).map_err(|error| {
					let _ = fs::remove_dir_all(&root);
					format!("Could not create the private Git dir: {error}")
				})?;
				fs::create_dir(&xdg_config_home).map_err(|error| {
					let _ = fs::remove_dir_all(&root);
					format!("Could not create the private Git configuration: {error}")
				})?;
				let global_config = root.join("global.gitconfig");
				OpenOptions::new()
					.write(true)
					.create_new(true)
					.open(&global_config)
					.map_err(|error| {
						let _ = fs::remove_dir_all(&root);
						format!("Could not create the private global Git configuration: {error}")
					})?;

				return Ok(GitApplySandbox {
					root,
					git_dir,
					global_config,
					xdg_config_home,
				});
			}
			Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
			Err(error) => {
				return Err(format!(
					"Could not reserve the private Git environment: {error}",
				));
			}
		}
	}

	Err("Could not reserve a private environment for Git.".to_string())
}

fn configure_git_apply_sandbox(
	command: &mut Command,
	sandbox: &GitApplySandbox,
	repository_root: &Path,
) {
	command
		.env("GIT_DIR", &sandbox.git_dir)
		.env("GIT_WORK_TREE", repository_root)
		.env("GIT_CONFIG_NOSYSTEM", "1")
		.env("GIT_CONFIG_GLOBAL", &sandbox.global_config)
		.env("GIT_ATTR_NOSYSTEM", "1")
		.env("XDG_CONFIG_HOME", &sandbox.xdg_config_home);
}

