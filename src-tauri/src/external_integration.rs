use serde::Serialize;
use std::{
	collections::{HashSet, VecDeque},
	sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

pub const EXTERNAL_ACTIONS_PENDING_EVENT: &str = "external-actions-pending";
const FORWARD_ONLY_ARG: &str = "--orqeto-dev-forward-only";
pub const FORWARD_ONLY_NO_PRIMARY_EXIT_CODE: i32 = 73;
const INTEGRATION_STATE_VALUE_NAME: &str = "IntegrationState";

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum ExternalAction {
	#[serde(rename = "openRoot")]
	OpenRoot { path: String },
	#[serde(rename = "addContext")]
	AddContext { paths: Vec<String> },
	#[serde(rename = "removeContext")]
	RemoveContext { paths: Vec<String> },
	#[serde(rename = "addContextAndCopy")]
	AddContextAndCopy { paths: Vec<String> },
	#[serde(rename = "addIgnore")]
	AddIgnore { paths: Vec<String> },
	#[serde(rename = "removeIgnore")]
	RemoveIgnore { paths: Vec<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalIntegrationState {
	version: u8,
	process_id: u32,
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
}

#[derive(Clone, Serialize)]
pub struct QueuedExternalAction {
	id: u64,
	action: ExternalAction,
}

struct PendingExternalActionsInner {
	next_id: u64,
	queue: VecDeque<QueuedExternalAction>,
}

pub struct PendingExternalActions(Mutex<PendingExternalActionsInner>);

pub fn is_forward_only_process() -> bool {
	std::env::args().any(|argument| argument == FORWARD_ONLY_ARG)
}

impl PendingExternalActions {
	pub fn from_current_process() -> Self {
		let args = std::env::args().collect::<Vec<_>>();
		let actions = parse_external_actions(&args);
		let mut inner = PendingExternalActionsInner {
			next_id: 1,
			queue: VecDeque::new(),
		};
		for action in actions {
			enqueue_external_action(&mut inner, action);
		}

		Self(Mutex::new(inner))
	}
}

fn enqueue_external_action(
	inner: &mut PendingExternalActionsInner,
	action: ExternalAction,
) {
	let id = inner.next_id;
	inner.next_id = inner.next_id.checked_add(1).unwrap_or(1);
	inner.queue.push_back(QueuedExternalAction { id, action });
}

fn acknowledge_external_action(
	inner: &mut PendingExternalActionsInner,
	id: u64,
) -> Result<(), String> {
	let Some(front) = inner.queue.front() else {
		return Err("The external action is no longer pending.".to_string());
	};
	if front.id != id {
		return Err(
			"The external action acknowledgment arrived out of order and was rejected to preserve the queue.".to_string(),
		);
	}
	inner.queue.pop_front();
	Ok(())
}

fn is_external_action_flag(value: &str) -> bool {
	matches!(
		value,
		"--open-root" |
			"--add-context" |
			"--remove-context" |
			"--add-context-and-copy" |
			"--add-ignore" |
			"--remove-ignore"
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
			"--add-context" | "--remove-context" | "--add-context-and-copy" | "--add-ignore" | "--remove-ignore" => {
				let action_flag = args[index].as_str();
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
					let action = match action_flag {
						"--remove-context" => ExternalAction::RemoveContext { paths },
						"--add-context-and-copy" => ExternalAction::AddContextAndCopy { paths },
						"--add-ignore" => ExternalAction::AddIgnore { paths },
						"--remove-ignore" => ExternalAction::RemoveIgnore { paths },
						_ => ExternalAction::AddContext { paths },
					};

					actions.push(action);
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
			for action in actions {
				enqueue_external_action(&mut pending, action);
			}
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
) -> Result<Vec<QueuedExternalAction>, String> {
	state
		.0
		.lock()
		.map(|pending| pending.queue.iter().cloned().collect())
		.map_err(|_| "Could not query pending external actions.".to_string())
}

#[tauri::command]
pub fn next_external_action(
	state: State<'_, PendingExternalActions>,
) -> Result<Option<QueuedExternalAction>, String> {
	state
		.0
		.lock()
		.map(|pending| pending.queue.front().cloned())
		.map_err(|_| "Could not access the next pending external action.".to_string())
}

#[tauri::command]
pub fn ack_external_action(
	id: u64,
	state: State<'_, PendingExternalActions>,
) -> Result<(), String> {
	let mut pending = state
		.0
		.lock()
		.map_err(|_| "Could not access pending external actions.".to_string())?;
	acknowledge_external_action(&mut pending, id)
}

fn sanitize_integration_state(
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
) -> ExternalIntegrationState {
	let mut seen = HashSet::new();
	let open_project_roots = open_project_roots
		.into_iter()
		.filter(|root| !root.trim().is_empty())
		.filter(|root| seen.insert(root.clone()))
		.collect::<Vec<_>>();
	let open_root_set = open_project_roots.iter().cloned().collect::<HashSet<_>>();
	let mut seen_context_roots = HashSet::new();
	let context_project_roots = context_project_roots
		.into_iter()
		.filter(|root| open_root_set.contains(root))
		.filter(|root| seen_context_roots.insert(root.clone()))
		.collect::<Vec<_>>();
	let ignore_project_root = ignore_project_root.filter(|root| open_root_set.contains(root));

	ExternalIntegrationState {
		version: 2,
		process_id: std::process::id(),
		open_project_roots,
		context_project_roots,
		ignore_project_root,
		hide_open_project_subfolders,
	}
}

#[cfg(target_os = "windows")]
fn set_external_integration_state_blocking(
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
) -> Result<(), String> {
	use winreg::enums::HKEY_CURRENT_USER;
	use winreg::RegKey;

	const APP_KEY: &str = r"Software\Orqeto\Orqeto Dev";

	let state = sanitize_integration_state(
		open_project_roots,
		context_project_roots,
		ignore_project_root,
		hide_open_project_subfolders,
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
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
) -> Result<(), String> {
	let _ = sanitize_integration_state(
		open_project_roots,
		context_project_roots,
		ignore_project_root,
		hide_open_project_subfolders,
	);
	Ok(())
}

#[tauri::command]
pub async fn set_external_integration_state(
	open_project_roots: Vec<String>,
	context_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		set_external_integration_state_blocking(
			open_project_roots,
			context_project_roots,
			ignore_project_root,
			hide_open_project_subfolders,
		)
	})
	.await
	.map_err(|error| format!("External integration update was interrupted: {error}"))?
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

	let (app_key, _) = hkcu
		.create_subkey(APP_KEY)
		.map_err(|error| format!("Could not register the Orqeto Dev integration: {error}"))?;

	app_key
		.set_value("ExecutablePath", &executable)
		.map_err(|error| format!("Could not register the Orqeto Dev executable: {error}"))?;

	set_external_integration_state_blocking(
		Vec::new(),
		Vec::new(),
		None,
		true,
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

#[cfg(not(target_os = "windows"))]
pub fn register_system_integrations() -> Result<(), String> {
	Ok(())
}
#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_context_and_ignore_action_groups() {
		let args = vec![
			"orqeto-dev.exe".to_string(),
			"--add-context".to_string(),
			"C:\\project\\src".to_string(),
			"--remove-ignore".to_string(),
			"C:\\project\\dist".to_string(),
			"--add-context-and-copy".to_string(),
			"C:\\project\\final.txt".to_string(),
		];
		let actions = parse_external_actions(&args);

		assert_eq!(actions.len(), 3);
		assert!(matches!(
			&actions[0],
			ExternalAction::AddContext { paths } if paths == &vec!["C:\\project\\src".to_string()]
		));
		assert!(matches!(
			&actions[1],
			ExternalAction::RemoveIgnore { paths } if paths == &vec!["C:\\project\\dist".to_string()]
		));
		assert!(matches!(
			&actions[2],
			ExternalAction::AddContextAndCopy { paths } if paths == &vec!["C:\\project\\final.txt".to_string()]
		));
	}

	#[test]
	fn queued_actions_require_ordered_acknowledgement() {
		let mut pending = PendingExternalActionsInner {
			next_id: 1,
			queue: VecDeque::new(),
		};
		enqueue_external_action(
			&mut pending,
			ExternalAction::OpenRoot { path: "first".to_string() },
		);
		enqueue_external_action(
			&mut pending,
			ExternalAction::OpenRoot { path: "second".to_string() },
		);

		assert_eq!(pending.queue.len(), 2);
		assert_eq!(pending.queue[0].id, 1);
		assert_eq!(pending.queue[1].id, 2);
		assert!(acknowledge_external_action(&mut pending, 2).is_err());
		assert_eq!(pending.queue.len(), 2);
		acknowledge_external_action(&mut pending, 1)
			.expect("the first action should be acknowledged");
		assert_eq!(pending.queue.len(), 1);
		assert_eq!(pending.queue[0].id, 2);
	}

	#[test]
	fn integration_state_keeps_ignore_root_only_when_it_is_open() {
		let state = sanitize_integration_state(
			vec![
				"C:\\project-a".to_string(),
				"C:\\project-a".to_string(),
				"C:\\project-b".to_string(),
			],
			vec![
				"C:\\project-b".to_string(),
				"C:\\missing".to_string(),
			],
			Some("C:\\project-b".to_string()),
			true,
		);

		assert_eq!(state.version, 2);
		assert_eq!(state.process_id, std::process::id());
		assert_eq!(state.open_project_roots.len(), 2);
		assert_eq!(state.context_project_roots, vec!["C:\\project-b".to_string()]);
		assert_eq!(state.ignore_project_root.as_deref(), Some("C:\\project-b"));
		assert!(state.hide_open_project_subfolders);

		let stale = sanitize_integration_state(
			vec!["C:\\project-a".to_string()],
			vec!["C:\\project-b".to_string()],
			Some("C:\\project-b".to_string()),
			false,
		);

		assert!(stale.context_project_roots.is_empty());
		assert_eq!(stale.ignore_project_root, None);
		assert!(!stale.hide_open_project_subfolders);
	}
}

