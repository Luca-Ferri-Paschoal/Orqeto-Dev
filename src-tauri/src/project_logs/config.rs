fn canonical_project_root(root_folder: &str) -> Result<PathBuf, String> {
	let root = fs::canonicalize(root_folder)
		.map_err(|error| format!("Could not resolve the project folder: {error}"))?;
	if !root.is_dir() {
		return Err("The selected project root is not a folder.".to_string());
	}
	Ok(root)
}

fn read_log_command(value: Option<&serde_json::Value>) -> Option<String> {
	let value = value?.as_str()?.trim();
	if value.is_empty() || value.chars().count() > MAX_LOG_COMMAND_CHARS {
		return None;
	}
	Some(value.to_string())
}

pub(crate) fn read_development_log_command(root: &Path) -> Option<String> {
	let content = fs::read_to_string(root.join("package.json")).ok()?;
	let value = serde_json::from_str::<serde_json::Value>(&content).ok()?;
	read_log_command(
		value
			.get("orqetoDev")
			.and_then(|orqeto| orqeto.get("logs"))
			.and_then(|logs| logs.get("development")),
	)
}

fn create_development_command(root: &Path, command_text: &str) -> Command {
	#[cfg(target_os = "windows")]
	let mut command = {
		let shell = std::env::var_os("COMSPEC").unwrap_or_else(|| OsString::from("cmd.exe"));
		let mut command = Command::new(shell);
		command
			.arg("/D")
			.arg("/S")
			.arg("/C")
			.arg(command_text)
			.creation_flags(WINDOWS_NO_WINDOW);
		command
	};

	#[cfg(not(target_os = "windows"))]
	let mut command = {
		let mut command = Command::new("sh");
		command.arg("-lc").arg(command_text);
		command
	};

	command
		.current_dir(root)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.env("NO_COLOR", "1")
		.env("FORCE_COLOR", "0");
	process_tree::configure_process_tree(&mut command);
	command
}
