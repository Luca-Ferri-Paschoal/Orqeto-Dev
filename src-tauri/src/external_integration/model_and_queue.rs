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
	busy_project_roots: Vec<String>,
	ignore_project_root: Option<String>,
	hide_open_project_subfolders: bool,
	locale: String,
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

pub fn current_process_has_external_actions() -> bool {
	let args = std::env::args().collect::<Vec<_>>();
	!parse_external_actions(&args).is_empty()
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
		if crate::native_drop::bring_to_front(&window).is_err() {
			let _ = window.show();
			let _ = window.unminimize();
			let _ = window.set_focus();
		}
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

