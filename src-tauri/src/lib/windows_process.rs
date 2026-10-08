#[cfg(target_os = "windows")]
fn run_windows_command_bounded(mut command: Command) -> Result<Output, String> {
	command.stdout(Stdio::piped()).stderr(Stdio::piped());
	let mut child = command
		.spawn()
		.map_err(|error| format!("Could not start the external process: {error}"))?;
	let stdout = match child.stdout.take() {
		Some(stdout) => stdout,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The external process did not provide stdout.".to_string());
		}
	};
	let stderr = match child.stderr.take() {
		Some(stderr) => stderr,
		None => {
			process_tree::terminate_process_tree(&mut child);
			return Err("The external process did not provide stderr.".to_string());
		}
	};
	let exceeded = Arc::new(AtomicBool::new(false));
	let total_bytes = Arc::new(AtomicUsize::new(0));
	let stdout_task = read_external_output_bounded(
		stdout,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);
	let stderr_task = read_external_output_bounded(
		stderr,
		Arc::clone(&total_bytes),
		Arc::clone(&exceeded),
	);
	let started = Instant::now();
	let status = loop {
		if exceeded.load(Ordering::Acquire) {
			process_tree::terminate_process_tree(&mut child);
			break Err(format!(
				"External process output exceeded the {} MiB limit.",
				MAX_EXTERNAL_COMMAND_OUTPUT_BYTES / (1024 * 1024),
			));
		}
		if started.elapsed() > MAX_EXTERNAL_COMMAND_RUNTIME {
			process_tree::terminate_process_tree(&mut child);
			break Err("The external process exceeded the 60-second limit and was stopped.".to_string());
		}
		match child.try_wait() {
			Ok(Some(status)) => break Ok(status),
			Ok(None) => thread::sleep(Duration::from_millis(10)),
			Err(error) => {
				process_tree::terminate_process_tree(&mut child);
				break Err(format!("Could not wait for the external process: {error}"));
			}
		}
	};
	let stdout = stdout_task
		.join()
		.map_err(|_| "Reading external-process stdout was interrupted.".to_string())?
		.map_err(|error| format!("Could not read external-process stdout: {error}"))?;
	let stderr = stderr_task
		.join()
		.map_err(|_| "Reading external-process stderr was interrupted.".to_string())?
		.map_err(|error| format!("Could not read external-process stderr: {error}"))?;

	Ok(Output {
		status: status?,
		stdout,
		stderr,
	})
}

#[cfg(target_os = "windows")]
fn vscode_install_roots() -> Vec<PathBuf> {
	let mut roots = Vec::new();

	if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
		roots.push(
			PathBuf::from(local_app_data)
				.join("Programs")
				.join("Microsoft VS Code"),
		);
	}

	for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
		if let Some(program_files) = std::env::var_os(variable) {
			roots.push(
				PathBuf::from(program_files)
					.join("Microsoft VS Code"),
			);
		}
	}

	roots
}

#[cfg(target_os = "windows")]
fn canonical_existing_candidates(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
	let mut seen = HashSet::new();

	candidates
		.into_iter()
		.filter(|candidate| candidate.is_file())
		.filter_map(|candidate| fs::canonicalize(candidate).ok())
		.filter(|candidate| seen.insert(candidate.clone()))
		.collect()
}

#[cfg(target_os = "windows")]
fn vscode_registry_executable_candidates() -> Vec<PathBuf> {
	use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
	use winreg::RegKey;

	const APP_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\App Paths\Code.exe";
	let mut candidates = Vec::new();

	for root in [
		RegKey::predef(HKEY_CURRENT_USER),
		RegKey::predef(HKEY_LOCAL_MACHINE),
	] {
		let Ok(key) = root.open_subkey(APP_PATH) else {
			continue;
		};
		let Ok(path) = key.get_value::<String, _>("") else {
			continue;
		};
		let trimmed = path.trim().trim_matches('"');

		if !trimmed.is_empty() {
			candidates.push(PathBuf::from(trimmed));
		}
	}

	candidates
}

#[cfg(target_os = "windows")]
fn vscode_executable_candidates() -> Vec<PathBuf> {
	let mut candidates = vscode_install_roots()
		.into_iter()
		.map(|root| root.join("Code.exe"))
		.collect::<Vec<_>>();

	candidates.extend(vscode_registry_executable_candidates());

	if let Some(path_candidate) = resolve_executable_from_path("Code.exe") {
		candidates.push(path_candidate);
	}

	if let Some(cli_candidate) = resolve_executable_from_path("code.cmd") {
		if let Some(install_root) = cli_candidate.parent().and_then(Path::parent) {
			candidates.push(install_root.join("Code.exe"));
		}
	}

	canonical_existing_candidates(candidates)
}

#[cfg(target_os = "windows")]
fn vscode_cli_candidates() -> Vec<PathBuf> {
	let mut candidates = vscode_install_roots()
		.into_iter()
		.map(|root| root.join("bin").join("code.cmd"))
		.collect::<Vec<_>>();

	if let Some(path_candidate) = resolve_executable_from_path("code.cmd") {
		candidates.push(path_candidate);
	}

	// Code.exe accepts the same extension-install CLI arguments and is a safe
	// fallback when the shell wrapper is unavailable.
	candidates.extend(vscode_executable_candidates());
	canonical_existing_candidates(candidates)
}

#[cfg(target_os = "windows")]
fn is_vscode_available_blocking() -> bool {
	!vscode_executable_candidates().is_empty()
}

#[cfg(not(target_os = "windows"))]
fn is_vscode_available_blocking() -> bool {
	false
}

#[tauri::command]
async fn is_vscode_available() -> Result<bool, String> {
	tauri::async_runtime::spawn_blocking(is_vscode_available_blocking)
		.await
		.map_err(|error| format!("VS Code detection was interrupted: {error}"))
}

#[cfg(target_os = "windows")]
fn open_folder_in_vscode_blocking(path: &Path) -> Result<(), String> {
	let executable = vscode_executable_candidates()
		.into_iter()
		.next()
		.ok_or_else(|| "Could not locate a Visual Studio Code installation.".to_string())?;
	let mut command = Command::new(executable);
	command
		.arg(path)
		.stdin(Stdio::null())
		.stdout(Stdio::null())
		.stderr(Stdio::null())
		.creation_flags(WINDOWS_NO_WINDOW);
	command
		.spawn()
		.map_err(|error| format!("Could not open the project in VS Code: {error}"))?;
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_folder_in_vscode_blocking(_path: &Path) -> Result<(), String> {
	Err("Automatic VS Code integration is available only on Windows.".to_string())
}

#[tauri::command]
async fn open_folder_in_vscode(path: String) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		let folder = PathBuf::from(path);

		if !folder.is_dir() {
			return Err("The configured folder no longer exists.".to_string());
		}

		if !is_vscode_available_blocking() {
			return Err("Visual Studio Code is not available in this environment.".to_string());
		}

		open_folder_in_vscode_blocking(&folder)
	})
	.await
	.map_err(|error| format!("Opening VS Code was interrupted: {error}"))?
}

