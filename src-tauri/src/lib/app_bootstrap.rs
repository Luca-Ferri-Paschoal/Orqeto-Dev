// Expensive snapshot recovery, history deserialization and Windows Explorer menu
// registration are deliberately not run inside Tauri's synchronous setup hook.
fn initialize_background_services(handle: AppHandle) {
	let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
		if let Err(error) = overlay::recover_stale_snapshots() {
			eprintln!("{error}");
		}
		if let Err(error) = handle
			.state::<overlay::OverlayUndoState>()
			.load_persisted_histories()
		{
			eprintln!("{error}");
		}
		if let Err(error) = external_integration::register_system_integrations() {
			eprintln!("{error}");
		}
	}));
	if result.is_err() {
		// Never release project writes after an incomplete/panicked recovery.
		overlay::protect_startup_failure();
		eprintln!("Orqeto Dev startup recovery was interrupted.");
	}
	overlay::finish_startup_tasks();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let migrations = vec![
		Migration {
			version: 1,
			description: "create_app_settings",
			sql: "
				CREATE TABLE IF NOT EXISTS app_settings (
					key TEXT PRIMARY KEY NOT NULL,
					value TEXT NOT NULL
				);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 2,
			description: "create_context_filter_history",
			sql: "
				CREATE TABLE IF NOT EXISTS context_filter_history (
					root_folder TEXT NOT NULL,
					pattern TEXT NOT NULL,
					target TEXT NOT NULL,
					mode TEXT NOT NULL,
					last_used_at INTEGER NOT NULL,
					PRIMARY KEY (root_folder, pattern, target, mode)
				);

				CREATE INDEX IF NOT EXISTS context_filter_history_recent
				ON context_filter_history (root_folder, last_used_at DESC);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 3,
			description: "create_project_tabs",
			sql: "
				CREATE TABLE IF NOT EXISTS project_tabs (
					id TEXT PRIMARY KEY NOT NULL,
					root_folder TEXT,
					position INTEGER NOT NULL
				);

				CREATE UNIQUE INDEX IF NOT EXISTS project_tabs_root_unique
					ON project_tabs (root_folder);

				INSERT OR IGNORE INTO project_tabs (id, root_folder, position)
				SELECT 'legacy-root', value, 0
				FROM app_settings
				WHERE key = 'root_folder';

				DELETE FROM app_settings WHERE key = 'root_folder';
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 4,
			description: "create_context_export_history",
			sql: "
				CREATE TABLE IF NOT EXISTS context_export_history (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					root_folder TEXT NOT NULL,
					content TEXT NOT NULL,
					file_count INTEGER NOT NULL,
					byte_count INTEGER NOT NULL,
					created_at INTEGER NOT NULL
				);

				CREATE INDEX IF NOT EXISTS context_export_history_recent
					ON context_export_history (root_folder, created_at DESC, id DESC);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 5,
			description: "persist_project_section_expansion",
			sql: "
				ALTER TABLE project_tabs
					ADD COLUMN folder_section_expanded INTEGER NOT NULL DEFAULT 1;
				ALTER TABLE project_tabs
					ADD COLUMN context_section_expanded INTEGER NOT NULL DEFAULT 1;
				ALTER TABLE project_tabs
					ADD COLUMN apply_section_expanded INTEGER NOT NULL DEFAULT 1;
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 6,
			description: "classify_context_history",
			sql: "
				ALTER TABLE context_export_history
					ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom';
			",
			kind: MigrationKind::Up,
		},
	];

	let builder = tauri::Builder::default()
		.manage(external_integration::PendingExternalActions::from_current_process())
		.manage(overlay::OverlayUndoState::new())
		.manage(diagnostics::DiagnosticTrustState::new())
		.manage(diagnostics::ValidationOperationState::new())
		.manage(project_logs::ProjectLogState::new())
		.manage(config_database::ConfigDatabaseState::new())
		.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
			external_integration::handle_second_instance(
				app,
				&args,
			)
		}))
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_clipboard_manager::init())
		.plugin(
			tauri_plugin_sql::Builder::default()
				.add_migrations(
					DATABASE_URL,
					migrations,
				)
				.build(),
		)
		.setup(|app| {
			if external_integration::is_forward_only_process() {
				app.handle().cleanup_before_exit();
				std::process::exit(external_integration::FORWARD_ONLY_NO_PRIMARY_EXIT_CODE);
			}

			let foreground_external_launch =
				external_integration::current_process_has_external_actions();

			overlay::begin_startup_tasks();
			let handle = app.handle().clone();
			if let Err(error) = std::thread::Builder::new()
				.name("orqeto-startup".to_string())
				.spawn(move || initialize_background_services(handle))
			{
				// If no background thread can be created, retain the safe synchronous
				// recovery path instead of leaving writes blocked indefinitely.
				eprintln!("Could not create the startup worker: {error}");
				initialize_background_services(app.handle().clone());
			}

			if let Some(window) = app.get_webview_window("main") {
				if let Err(error) = window_state::restore(&window) {
					eprintln!("Could not restore the main window geometry: {error}");
				}
				// A missing or invalid preference keeps the default Tauri placement.
				if let Err(error) = window.show() {
					eprintln!("Could not display the main window: {error}");
				}
				if let Err(error) = native_drop::install(&window) {
					eprintln!("{error}");
				}

				if foreground_external_launch {
					if let Err(error) = native_drop::bring_to_front(&window) {
						eprintln!("{error}");
					}
				}

				let native_window = window.clone();
				let close_after_startup = std::sync::Arc::new(
					std::sync::atomic::AtomicBool::new(false),
				);
				window.on_window_event(move |event| {
					if matches!(
						event,
						WindowEvent::Focused(true) | WindowEvent::Resized(_)
					) {
						let _ = native_drop::refresh(&native_window);
					}
					if let WindowEvent::CloseRequested { api, .. } = event {
						if let Err(error) = window_state::save(&native_window) {
							eprintln!("Could not save window placement: {error}");
						}
						if overlay::startup_tasks_pending().unwrap_or(true) {
							// Even if the frontend close handler has not mounted yet, never
							// terminate an in-progress filesystem recovery on window close.
							api.prevent_close();
							if !close_after_startup.swap(true, std::sync::atomic::Ordering::AcqRel) {
								let closing_window = native_window.clone();
								std::thread::spawn(move || {
									if overlay::wait_for_startup_tasks().is_ok() {
										let _ = closing_window.close();
									}
								});
							}
						}
					}
				});
			}

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			config_database::config_get_settings,
			config_database::config_get_project_tabs,
			config_database::config_get_active_project_tab_id,
			config_database::config_get_context_filter_history,
			config_database::config_get_context_history,
			config_database::config_get_context_history_content,
			config_database::config_set_setting,
			config_database::config_upsert_project_tab,
			config_database::config_delete_project_tab,
			config_database::config_save_project_tab_order,
			config_database::config_set_project_tab_section_expanded,
			config_database::config_save_context_filter_history_entry,
			config_database::config_delete_context_filter_history_entry,
			config_database::config_save_context_history_entry,
			config_database::config_delete_context_history_entry,
			external_integration::peek_external_actions,
			external_integration::next_external_action,
			external_integration::ack_external_action,
			external_integration::set_external_integration_state,
			project_ignore::project_ignore_exists,
			project_ignore::create_project_ignore,
			project_ignore::update_project_ignore,
			git_context::is_git_repository,
			git_context::generate_git_commit_context,
			git_context::list_git_commits,
			git_context::compare_git_commits,
			git_context::git_patch_source_fingerprint,
			diagnostics::get_project_diagnostic_capabilities,
			diagnostics::approve_project_diagnostics,
			diagnostics::approve_project_validation_command,
			diagnostics::generate_project_diagnostic_context,
			diagnostics::run_project_validation_command,
			diagnostics::fix_project_eslint,
			diagnostics::cancel_project_validation_operation,
			project_logs::approve_project_log_command,
			project_logs::start_project_log_session,
			project_logs::stop_project_log_session,
			project_logs::get_project_log_snapshot,
			project_logs::clear_project_log_session,
			git_context::prepare_git_patch,
			git_context::apply_git_patch,
			folder_exists,
			find_project_for_root,
			find_project_for_paths,
			open_folder_in_explorer,
			close_folder_in_explorer,
			is_vscode_available,
			open_folder_in_vscode,
			install_vscode_extension,
			native_drop::cleanup_native_drop,
			process_drop,
			materialize_context_files,
			save_full_project_context_export_file,
			resolve_context_removal_paths,
			overlay::overlay_recovery_status,
			overlay::discard_overlay_recovery_state,
			overlay::prepare_project_overlay,
			overlay::apply_project_overlay,
            overlay::preview_project_overlay_secrets,
            overlay::delete_project_generated_directories_permanently,
			overlay::project_overlay_undo_history,
			overlay::project_overlay_source_history_match,
			overlay::undo_project_overlay,
			overlay::discard_project_overlay_undo,
			destroy_main_window,
			save_context_history_export_file,
			save_export_file,
		]);

	builder
		.run(tauri::generate_context!())
		.expect("error while running Orqeto Dev");
}
