#[tauri::command]
async fn save_export_file(
	app: AppHandle,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	content: String,
) -> Result<bool, String> {
	let (saved, _) = save_export_file_content(
		app,
		suggested_file_name,
		dialog_title,
		filter_name,
		extension,
		content,
	).await?;
	Ok(saved)
}

#[tauri::command]
async fn save_context_history_export_file(
	app: AppHandle,
	root_folder: String,
	id: i64,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	instances: State<'_, DbInstances>,
) -> Result<bool, String> {
	let content = config_database::load_context_history_content(
		&root_folder,
		id,
		instances,
	).await?;

	save_export_file(
		app,
		suggested_file_name,
		dialog_title,
		filter_name,
		extension,
		content,
	).await
}

#[tauri::command]
async fn destroy_main_window(
	app: AppHandle,
	undo_state: State<'_, overlay::OverlayUndoState>,
	project_log_state: State<'_, project_logs::ProjectLogState>,
) -> Result<(), String> {
	// A detached recovery thread must not be terminated by closing the last
	// window while it is still restoring files or loading persisted Undo state.
	tauri::async_runtime::spawn_blocking(overlay::wait_for_startup_tasks)
		.await
		.map_err(|error| format!("Shutdown was interrupted: {error}"))??;
	if undo_state.has_active_mutations() {
		return Err("A critical project operation is in progress. Wait for it to finish before closing the application.".to_string());
	}
	project_log_state.stop_all_and_wait()?;

	let window = app
		.get_webview_window("main")
		.ok_or_else(|| "The main window is not available.".to_string())?;
	// The frontend can cancel CloseRequested while a workspace is busy. Save
	// again only after this final, authorized shutdown path is reached.
	if let Err(error) = window_state::save(&window) {
		eprintln!("Could not save window placement: {error}");
	}
	window
		.destroy()
		.map_err(|error| format!("Could not close the main window: {error}"))
}

#[cfg(test)]
mod context_selection_tests {
	use super::*;
	use std::time::{SystemTime, UNIX_EPOCH};

	fn test_root(name: &str) -> PathBuf {
		let nonce = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time")
			.as_nanos();

		std::env::temp_dir().join(format!(
			"orqeto-live-context-{name}-{}-{nonce}",
			std::process::id(),
		))
	}

	#[test]
	fn br_ctx_004_materialization_reads_current_content_instead_of_selection_time_content() {
		let root = test_root("fresh");
		fs::create_dir_all(&root).expect("create root");
		let file = root.join("example.txt");
		fs::write(&file, "first").expect("write first");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![file.to_string_lossy().into_owned()],
		).expect("select file");
		assert_eq!(selected.files[0].relative_path, "./example.txt");
		assert_eq!(selected.selected_bytes, 5);

		fs::write(&file, "second").expect("write second");
		let current = materialize_context_files_blocking(
			root.to_string_lossy().into_owned(),
			vec!["./example.txt".to_string()],
			false,
		).expect("materialize current file");

		assert_eq!(current.files.len(), 1);
		assert_eq!(current.files[0].content.as_deref(), Some("second"));
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn br_ctx_005_selection_keeps_binary_file_as_reference_without_materializing_body() {
		let root = test_root("reference-only");
		fs::create_dir_all(&root).expect("create root");
		let file = root.join("binary.dat");
		fs::write(
			&file,
			[0_u8, 0xFF, 0xFE, 0x00, 0x80],
		).expect("write binary");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![file.to_string_lossy().into_owned()],
		).expect("select binary path");

		assert_eq!(selected.files.len(), 1);
		assert_eq!(selected.files[0].relative_path, "./binary.dat");
		assert!(selected.skipped_files.is_empty());

		let materialized = materialize_context_files_blocking(
			root.to_string_lossy().into_owned(),
			vec!["./binary.dat".to_string()],
			false,
		).expect("materialize binary path");

		assert!(materialized.files.is_empty());
		assert_eq!(materialized.skipped_files.len(), 1);
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn br_ctx_006_unavailable_selected_members_never_use_stale_content() {
		let root = test_root("unavailable");
		fs::create_dir_all(&root).expect("create root");
		let missing_file = root.join("missing.txt");
		let ignored_file = root.join("ignored.txt");
		fs::write(&missing_file, "selection-time missing content").expect("write missing candidate");
		fs::write(&ignored_file, "selection-time ignored content").expect("write ignored candidate");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![
				missing_file.to_string_lossy().into_owned(),
				ignored_file.to_string_lossy().into_owned(),
			],
		).expect("select files");
		assert_eq!(selected.files.len(), 2);

		fs::remove_file(&missing_file).expect("remove selected file");
		fs::write(
			root.join(".orqeto-devignore"),
			"ignored.txt\n",
		).expect("ignore selected file");

		let materialized = materialize_context_files_blocking(
			root.to_string_lossy().into_owned(),
			vec![
				"./missing.txt".to_string(),
				"./ignored.txt".to_string(),
			],
			false,
		).expect("materialize unavailable files");

		assert!(materialized.files.is_empty());
		assert_eq!(materialized.skipped_files.len(), 2);
		assert!(materialized.skipped_files.iter().any(|file| {
			file.relative_path == "./missing.txt" &&
			file.reason.contains("no longer exists")
		}));
		assert!(materialized.skipped_files.iter().any(|file| {
			file.relative_path == "./ignored.txt" &&
			file.reason.contains(".orqeto-devignore")
		}));
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn br_perf_003_backend_full_project_formatter_preserves_context_protocol() {
		let formatted = format_materialized_context(
			vec![
				GeneratedFile {
					relative_path: "./src/main.ts".to_string(),
					content: Some("export {}".to_string()),
				},
				GeneratedFile {
					relative_path: "./README.md".to_string(),
					content: None,
				},
			],
			"en",
			"files",
		).expect("format backend full-project context");

		assert!(formatted.starts_with("===== ORQETO DEV: CONTEXT =====\nPROTOCOL:"));
		assert!(formatted.contains("===== ROOT: ./ ====="));
		assert!(formatted.contains("===== FILE: README.md ====="));
		assert!(formatted.contains("===== FILE: ./src/main.ts =====\n===== CONTENT START =====\nexport {}\n===== CONTENT END ====="));
		assert!(formatted.ends_with("===== END OF ORQETO DEV: CONTEXT =====\n"));
	}

	#[test]
	fn recursive_selection_reports_child_directories() {
		let root = test_root("directories");
		let nested = root.join("src").join("feature");
		fs::create_dir_all(&nested).expect("create nested root");
		fs::write(nested.join("index.ts"), "export {}\n").expect("write file");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![root.join("src").to_string_lossy().into_owned()],
		).expect("select tree");

		assert_eq!(selected.files.len(), 1);
		assert!(selected.directories.contains(&"./src".to_string()));
		assert!(selected.directories.contains(&"./src/feature".to_string()));
		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn overlapping_selection_deduplicates_ignored_directories() {
		let root = test_root("ignored-dedup");
		let ignored = root.join("ignored");
		fs::create_dir_all(&ignored).expect("create ignored root");
		fs::write(root.join(".orqeto-devignore"), "ignored/\n").expect("write ignore");
		fs::write(root.join("keep.txt"), "keep").expect("write keep");
		fs::write(ignored.join("hidden.txt"), "hidden").expect("write hidden");

		let selected = process_drop_blocking(
			root.to_string_lossy().into_owned(),
			vec![
				root.to_string_lossy().into_owned(),
				ignored.to_string_lossy().into_owned(),
			],
		).expect("select overlapping tree");

		assert_eq!(selected.skipped_directory_count, 1);
		fs::remove_dir_all(root).expect("cleanup");
	}
}

