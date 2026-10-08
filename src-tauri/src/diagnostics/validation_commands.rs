#[tauri::command]
pub fn cancel_project_validation_operation(
	root_folder: String,
	kind: String,
	operation_id: String,
	validation_state: State<'_, ValidationOperationState>,
) -> Result<bool, String> {
	if kind != "lintfix" && kind != "test" {
		return Err("Only Lint Fix and Test validation operations can be cancelled through this command.".to_string());
	}

	let root = canonical_project_root(&root_folder)?;
	validation_state.cancel(
		&root,
		&kind,
		&operation_id,
	)
}

#[cfg(test)]
mod tests {
	use super::{
		child_process_path,
		read_project_validation_commands,
		select_typecheck_configs,
		DiagnosticTrustState,
	};
	use std::{
		fs,
		path::{Path, PathBuf},
		time::{SystemTime, UNIX_EPOCH},
	};

	fn temporary_test_root(label: &str) -> PathBuf {
		let nonce = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time should be after the epoch")
			.as_nanos();
		std::env::temp_dir().join(format!(
			"orqeto-diagnostics-{label}-{}-{nonce}",
			std::process::id(),
		))
	}

	#[test]
	fn typecheck_config_selection_prefers_workspace_package_configs() {
		let root = temporary_test_root("workspace");
		let api = root.join("apps").join("api");
		let scripts = root.join("scripts");
		fs::create_dir_all(&api).expect("api directory should be created");
		fs::create_dir_all(&scripts).expect("scripts directory should be created");
		fs::write(
			root.join("package.json"),
			r#"{"workspaces":["apps/*"],"scripts":{"typecheck":"npm run typecheck --workspaces --if-present"}}"#,
		).expect("root package should be written");
		fs::write(api.join("package.json"), r#"{"name":"api"}"#)
			.expect("api package should be written");
		fs::write(root.join("tsconfig.json"), "{}").expect("root tsconfig should be written");
		fs::write(root.join("tsconfig.base.json"), "{}").expect("base tsconfig should be written");
		fs::write(api.join("tsconfig.json"), "{}").expect("api tsconfig should be written");
		fs::write(scripts.join("tsconfig.json"), "{}").expect("scripts tsconfig should be written");

		let selected = select_typecheck_configs(
			&root,
			vec![
				root.join("tsconfig.json"),
				root.join("tsconfig.base.json"),
				api.join("tsconfig.json"),
				scripts.join("tsconfig.json"),
			],
			&[
				root.join("package.json"),
				api.join("package.json"),
			],
		);

		assert_eq!(selected, vec![api.join("tsconfig.json")]);
		let _ = fs::remove_dir_all(root);
	}

	#[test]
	fn typecheck_config_selection_expands_solution_config_without_base_config() {
		let root = temporary_test_root("solution");
		fs::create_dir_all(&root).expect("test root should be created");
		fs::write(root.join("package.json"), r#"{"name":"web"}"#)
			.expect("package should be written");
		fs::write(
			root.join("tsconfig.json"),
			r#"{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}]}"#,
		).expect("solution config should be written");
		for name in ["tsconfig.app.json", "tsconfig.node.json", "tsconfig.base.json"] {
			fs::write(root.join(name), "{}").expect("leaf config should be written");
		}

		let selected = select_typecheck_configs(
			&root,
			vec![
				root.join("tsconfig.json"),
				root.join("tsconfig.app.json"),
				root.join("tsconfig.node.json"),
				root.join("tsconfig.base.json"),
			],
			&[root.join("package.json")],
		);

		assert_eq!(
			selected,
			vec![
				root.join("tsconfig.app.json"),
				root.join("tsconfig.node.json"),
			],
		);
		let _ = fs::remove_dir_all(root);
	}


	#[test]
	fn diagnostic_child_process_path_preserves_normal_paths() {
		let path = Path::new("project/node_modules/typescript/bin/tsc");
		assert_eq!(child_process_path(path).as_os_str(), path.as_os_str());
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn diagnostic_child_process_path_removes_windows_verbatim_disk_prefix() {
		let path = Path::new(r"\\?\C:\Users\dev\project\node_modules\typescript\bin\tsc");
		assert_eq!(
			child_process_path(path),
			std::ffi::OsString::from(r"C:\Users\dev\project\node_modules\typescript\bin\tsc"),
		);
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn diagnostic_child_process_path_converts_windows_verbatim_unc_prefix() {
		let path = Path::new(r"\\?\UNC\server\share\project\node_modules\eslint\bin\eslint.js");
		assert_eq!(
			child_process_path(path),
			std::ffi::OsString::from(r"\\server\share\project\node_modules\eslint\bin\eslint.js"),
		);
	}
	#[test]
	fn br_diag_002_project_validation_commands_are_explicit_and_limited_to_fix_and_test() {
		let root = temporary_test_root("custom-validation-commands");
		fs::create_dir_all(&root).expect("test root should be created");
		fs::write(
			root.join("package.json"),
			r#"{"orqetoDev":{"validation":{"typecheck":"npm run custom:typecheck","lint":"npm run custom:lint","lintFix":"npm run lint:fix","test":"npm test"}}}"#,
		)
		.expect("package.json should be written");

		let commands = read_project_validation_commands(&root);
		assert_eq!(commands.lint_fix.as_deref(), Some("npm run lint:fix"));
		assert_eq!(commands.test.as_deref(), Some("npm test"));

		let _ = fs::remove_dir_all(root);
	}

	#[test]
	fn br_diag_003_custom_command_trust_is_bound_to_exact_command_text() {
		let root = temporary_test_root("custom-validation-trust");
		let trust = DiagnosticTrustState::new();
		trust
			.approve_custom_command(
				root.clone(),
				"npm test".to_string(),
			)
			.expect("custom command trust should be recorded");

		assert!(trust
			.is_custom_command_approved(
				&root,
				"npm test",
			)
			.expect("trust lookup should succeed"));
		assert!(!trust
			.is_custom_command_approved(
				&root,
				"npm run test:changed",
			)
			.expect("trust lookup should succeed"));
	}

}

