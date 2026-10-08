fn sanitize_integration_state(
	open_project_roots: Vec<String>,
	_context_project_roots: Vec<String>,
	busy_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
	locale: String,
) -> ExternalIntegrationState {
	let mut seen = HashSet::new();
	let open_project_roots = open_project_roots
		.into_iter()
		.filter(|root| !root.trim().is_empty())
		.filter(|root| seen.insert(root.clone()))
		.collect::<Vec<_>>();
	let open_root_set = open_project_roots.iter().cloned().collect::<HashSet<_>>();
	// Legacy extension builds used `contextProjectRoots` as the menu-availability
	// list. Keep every open project context-capable regardless of which Context
	// generator is currently visible so Full, Commit, and Validation never hide
	// the Explorer Context commands.
	let context_project_roots = open_project_roots.clone();
	let mut seen_busy_roots = HashSet::new();
	let busy_project_roots = busy_project_roots
		.into_iter()
		.filter(|root| open_root_set.contains(root))
		.filter(|root| seen_busy_roots.insert(root.clone()))
		.collect::<Vec<_>>();
	let ignore_project_root = ignore_project_root.filter(|root| open_root_set.contains(root));
	let locale = if locale == "en" {
		"en".to_string()
	} else {
		"pt-BR".to_string()
	};

	ExternalIntegrationState {
		version: 2,
		process_id: std::process::id(),
		open_project_roots,
		context_project_roots,
		busy_project_roots,
		ignore_project_root,
		hide_open_project_subfolders,
		locale,
	}
}

#[cfg(target_os = "windows")]
fn set_external_integration_state_blocking(
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	busy_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
	locale: String,
) -> Result<(), String> {
	use winreg::enums::HKEY_CURRENT_USER;
	use winreg::RegKey;

	const APP_KEY: &str = r"Software\Orqeto\Orqeto Dev";

	let state = sanitize_integration_state(
		open_project_roots,
		context_project_roots,
		busy_project_roots,
		ignore_project_root,
		hide_open_project_subfolders,
		locale,
	);
	let serialized = serde_json::to_string(&state)
		.map_err(|error| format!("Could not serialize Orqeto Dev integration state: {error}"))?;
	let hkcu = RegKey::predef(HKEY_CURRENT_USER);
	let (app_key, _) = hkcu
		.create_subkey(APP_KEY)
		.map_err(|error| format!("Could not update Orqeto Dev integration state: {error}"))?;

	app_key
		.set_value(INTEGRATION_STATE_VALUE_NAME, &serialized)
		.map_err(|error| format!("Could not publish Orqeto Dev integration state: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn set_external_integration_state_blocking(
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	busy_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
	locale: String,
) -> Result<(), String> {
	let _ = sanitize_integration_state(
		open_project_roots,
		context_project_roots,
		busy_project_roots,
		ignore_project_root,
		hide_open_project_subfolders,
		locale,
	);
	Ok(())
}

#[tauri::command]
pub async fn set_external_integration_state(
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	busy_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
	locale: String,
) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::overlay::wait_for_startup_tasks()?;
		set_external_integration_state_blocking(
			open_project_roots,
			context_project_roots,
			busy_project_roots,
			ignore_project_root,
			hide_open_project_subfolders,
			locale,
		)
	})
	.await
	.map_err(|error| format!("External integration update was interrupted: {error}"))?
}

#[cfg(target_os = "windows")]
fn is_orqeto_shell_verb(
	shell_root: &winreg::RegKey,
	verb_name: &str,
) -> bool {
	use winreg::enums::KEY_READ;

	let Ok(verb_key) = shell_root.open_subkey_with_flags(
		verb_name,
		KEY_READ,
	) else {
		return false;
	};
	let label = verb_key
		.get_value::<String, _>("")
		.unwrap_or_default()
		.to_ascii_lowercase();
	let command = verb_key
		.open_subkey_with_flags(
			"command",
			KEY_READ,
		)
		.ok()
		.and_then(|command_key| command_key.get_value::<String, _>("").ok())
		.unwrap_or_default()
		.to_ascii_lowercase();
	let normalized_name = verb_name.to_ascii_lowercase();

	normalized_name.starts_with("orqeto") ||
		label.contains("orqeto dev") ||
		(command.contains("--open-root") && command.contains("orqeto"))
}

#[cfg(target_os = "windows")]
fn remove_legacy_shell_verbs(
	hkcu: &winreg::RegKey,
) -> Result<(), String> {
	use winreg::enums::{KEY_READ, KEY_WRITE};

	const SHELL_ROOTS: [&str; 5] = [
		r"Software\Classes\Directory\shell",
		r"Software\Classes\Directory\Background\shell",
		r"Software\Classes\Folder\shell",
		r"Software\Classes\AllFilesystemObjects\shell",
		r"Software\Classes\*\shell",
	];

	for shell_root_path in SHELL_ROOTS {
		let Ok(shell_root) = hkcu.open_subkey_with_flags(
			shell_root_path,
			KEY_READ | KEY_WRITE,
		) else {
			continue;
		};
		let legacy_verbs = shell_root
			.enum_keys()
			.filter_map(Result::ok)
			.filter(|verb_name| is_orqeto_shell_verb(&shell_root, verb_name))
			.collect::<Vec<_>>();

		for verb_name in legacy_verbs {
			shell_root
				.delete_subkey_all(&verb_name)
				.map_err(|error| format!(
					"Could not remove a legacy Orqeto Dev Explorer menu entry: {error}",
				))?;
		}
	}

	Ok(())
}

#[cfg(target_os = "windows")]
pub fn register_system_integrations() -> Result<(), String> {
	use winreg::enums::HKEY_CURRENT_USER;
	use winreg::RegKey;

	const APP_KEY: &str = r"Software\Orqeto\Orqeto Dev";
	const DIRECTORY_SHELL_KEY: &str = r"Software\Classes\Directory\shell\OrqetoDev";
	const DIRECTORY_BACKGROUND_SHELL_KEY: &str =
		r"Software\Classes\Directory\Background\shell\OrqetoDev";

	let executable = std::env::current_exe()
		.map_err(|error| format!("Could not locate the Orqeto Dev executable: {error}"))?;
	let executable = executable.to_string_lossy().into_owned();
	let hkcu = RegKey::predef(HKEY_CURRENT_USER);

	remove_legacy_shell_verbs(&hkcu)?;

	let (app_key, _) = hkcu
		.create_subkey(APP_KEY)
		.map_err(|error| format!("Could not register the Orqeto Dev integration: {error}"))?;

	app_key
		.set_value("ExecutablePath", &executable)
		.map_err(|error| format!("Could not register the Orqeto Dev executable: {error}"))?;

	set_external_integration_state_blocking(
		Vec::new(),
		Vec::new(),
		Vec::new(),
		None,
		true,
		"pt-BR".to_string(),
	)?;

	for shell_key_path in [
		DIRECTORY_SHELL_KEY,
		DIRECTORY_BACKGROUND_SHELL_KEY,
	] {
		let (shell_key, _) = hkcu
			.create_subkey(shell_key_path)
			.map_err(|error| format!("Could not register the Explorer menu: {error}"))?;

		shell_key
			.set_value("", &"Open in Orqeto Dev")
			.map_err(|error| format!("Could not configure the Explorer menu: {error}"))?;
		shell_key
			.set_value("Icon", &executable)
			.map_err(|error| format!("Could not configure the Explorer menu icon: {error}"))?;

		let (command_key, _) = shell_key
			.create_subkey("command")
			.map_err(|error| format!("Could not register the Explorer command: {error}"))?;
		let command = format!(r#""{executable}" --open-root "%V""#);

		command_key
			.set_value("", &command)
			.map_err(|error| format!("Could not configure the Explorer command: {error}"))?;
	}

	Ok(())
}

