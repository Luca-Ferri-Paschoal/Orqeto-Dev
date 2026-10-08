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
			vec![
				"C:\\project-b".to_string(),
				"C:\\missing".to_string(),
			],
			Some("C:\\project-b".to_string()),
			true,
			"en".to_string(),
		);

		assert_eq!(state.version, 2);
		assert_eq!(state.process_id, std::process::id());
		assert_eq!(state.open_project_roots.len(), 2);
		assert_eq!(
			state.context_project_roots,
			vec!["C:\\project-a".to_string(), "C:\\project-b".to_string()]
		);
		assert_eq!(state.busy_project_roots, vec!["C:\\project-b".to_string()]);
		assert_eq!(state.ignore_project_root.as_deref(), Some("C:\\project-b"));
		assert!(state.hide_open_project_subfolders);
		assert_eq!(state.locale, "en");

		let stale = sanitize_integration_state(
			vec!["C:\\project-a".to_string()],
			vec!["C:\\project-b".to_string()],
			vec!["C:\\project-b".to_string()],
			Some("C:\\project-b".to_string()),
			false,
			"invalid".to_string(),
		);

		assert_eq!(stale.context_project_roots, vec!["C:\\project-a".to_string()]);
		assert!(stale.busy_project_roots.is_empty());
		assert_eq!(stale.ignore_project_root, None);
		assert!(!stale.hide_open_project_subfolders);
		assert_eq!(stale.locale, "pt-BR");
	}
}

