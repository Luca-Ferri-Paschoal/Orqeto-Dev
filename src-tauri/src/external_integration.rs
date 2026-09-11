use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const EXTERNAL_ACTIONS_PENDING_EVENT: &str = "external-actions-pending";
const FORWARD_ONLY_ARG: &str = "--orqeto-dev-forward-only";

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum ExternalAction {
	#[serde(rename = "openRoot")]
	OpenRoot { path: String },
	#[serde(rename = "addContext")]
	AddContext { paths: Vec<String> },
	#[serde(rename = "removeContext")]
	RemoveContext { paths: Vec<String> },
}

pub struct PendingExternalActions(Mutex<Vec<ExternalAction>>);

pub fn is_forward_only_process() -> bool {
	std::env::args().any(|argument| argument == FORWARD_ONLY_ARG)
}

impl PendingExternalActions {
	pub fn from_current_process() -> Self {
		let args = std::env::args().collect::<Vec<_>>();

		Self(Mutex::new(parse_external_actions(&args)))
	}
}

fn is_external_action_flag(value: &str) -> bool {
	matches!(
		value,
		"--open-root" | "--add-context" | "--remove-context"
	)
}

fn parse_external_actions(args: &[String]) -> Vec<ExternalAction> {
	let mut actions = Vec::new();
	let mut index = 0;

	while index < args.len() {
		match args[index].as_str() {
			"--open-root" => {
				if let Some(path) = args.get(index + 1) {
					actions.push(ExternalAction::OpenRoot {
						path: path.clone(),
					});
					index += 2;
					continue;
				}
			}
			"--add-context" | "--remove-context" => {
				let remove = args[index] == "--remove-context";
				let mut paths = Vec::new();
				index += 1;

				while index < args.len() {
					let value = &args[index];

					if is_external_action_flag(value) {
						break;
					}

					paths.push(value.clone());
					index += 1;
				}

				if !paths.is_empty() {
					if remove {
						actions.push(ExternalAction::RemoveContext { paths });
					} else {
						actions.push(ExternalAction::AddContext { paths });
					}
				}

				continue;
			}
			_ => {}
		}

		index += 1;
	}

	actions
}

pub fn handle_second_instance(
	app: &AppHandle,
	args: &[String],
) {
	let actions = parse_external_actions(args);

	if !actions.is_empty() {
		let state = app.state::<PendingExternalActions>();

		if let Ok(mut pending) = state.0.lock() {
			pending.extend(actions);
		}

		let _ = app.emit(EXTERNAL_ACTIONS_PENDING_EVENT, ());
	}

	if let Some(window) = app.get_webview_window("main") {
		let _ = window.show();
		let _ = window.unminimize();
		let _ = window.set_focus();
	}
}

#[tauri::command]
pub fn peek_external_actions(
	state: State<'_, PendingExternalActions>,
) -> Result<Vec<ExternalAction>, String> {
	state
		.0
		.lock()
		.map(|pending| pending.clone())
		.map_err(|_| "Não foi possível consultar as ações externas pendentes.".to_string())
}

#[tauri::command]
pub fn take_external_actions(
	state: State<'_, PendingExternalActions>,
) -> Result<Vec<ExternalAction>, String> {
	let mut pending = state
		.0
		.lock()
		.map_err(|_| "Não foi possível acessar as ações externas pendentes.".to_string())?;

	Ok(std::mem::take(&mut *pending))
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
		.map_err(|error| format!("Não foi possível localizar o executável do Orqeto Dev: {error}"))?;
	let executable = executable.to_string_lossy().into_owned();
	let hkcu = RegKey::predef(HKEY_CURRENT_USER);

	let (app_key, _) = hkcu
		.create_subkey(APP_KEY)
		.map_err(|error| format!("Não foi possível registrar a integração do Orqeto Dev: {error}"))?;

	app_key
		.set_value("ExecutablePath", &executable)
		.map_err(|error| format!("Não foi possível registrar o executável do Orqeto Dev: {error}"))?;

	for shell_key_path in [
		DIRECTORY_SHELL_KEY,
		DIRECTORY_BACKGROUND_SHELL_KEY,
	] {
		let (shell_key, _) = hkcu
			.create_subkey(shell_key_path)
			.map_err(|error| format!("Não foi possível registrar o menu do Explorer: {error}"))?;

		shell_key
			.set_value("", &"Abrir no Orqeto Dev")
			.map_err(|error| format!("Não foi possível configurar o menu do Explorer: {error}"))?;
		shell_key
			.set_value("Icon", &executable)
			.map_err(|error| format!("Não foi possível configurar o ícone do menu do Explorer: {error}"))?;

		let (command_key, _) = shell_key
			.create_subkey("command")
			.map_err(|error| format!("Não foi possível registrar o comando do Explorer: {error}"))?;
		let command = format!(r#""{executable}" --open-root "%V""#);

		command_key
			.set_value("", &command)
			.map_err(|error| format!("Não foi possível configurar o comando do Explorer: {error}"))?;
	}

	Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn register_system_integrations() -> Result<(), String> {
	Ok(())
}
