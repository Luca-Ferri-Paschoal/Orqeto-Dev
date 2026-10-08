async fn trim_context_history_count(
	tx: &mut sqlx::Transaction<'_, Sqlite>,
	limit: i64,
) -> Result<(), String> {
	sqlx::query(
		 r#"
		DELETE FROM context_export_history
		WHERE id IN (
			SELECT id FROM (
				SELECT id,
					ROW_NUMBER() OVER (
						PARTITION BY root_folder
						ORDER BY created_at DESC, id DESC
					) AS history_position
				FROM context_export_history
			)
			WHERE history_position > ?1
		)
		"#,
	)
	.bind(limit)
	.execute(&mut **tx)
	.await
	.map_err(|error| database_error("Could not trim the context history", error))?;
	Ok(())
}

async fn trim_context_history_bytes(
	tx: &mut sqlx::Transaction<'_, Sqlite>,
	root_folder: &str,
) -> Result<(), String> {
	let rows = sqlx::query(
		"SELECT id, byte_count FROM context_export_history WHERE root_folder = ?1 ORDER BY created_at DESC, id DESC",
	)
	.bind(root_folder)
	.fetch_all(&mut **tx)
	.await
	.map_err(|error| database_error("Could not measure the context history", error))?;
	let mut total = 0_i64;
	let mut delete_ids = Vec::new();

	for row in rows {
		let id: i64 = row
			.try_get("id")
			.map_err(|error| database_error("The context history contains an invalid ID", error))?;
		let bytes: i64 = row
			.try_get("byte_count")
			.map_err(|error| database_error("The context history contains an invalid size", error))?;
		total = total.saturating_add(bytes.max(0));
		if total > MAX_CONTEXT_HISTORY_TOTAL_BYTES {
			delete_ids.push(id);
		}
	}

	for id in delete_ids {
		sqlx::query("DELETE FROM context_export_history WHERE id = ?1")
			.bind(id)
			.execute(&mut **tx)
			.await
			.map_err(|error| database_error("Could not reduce the context history", error))?;
	}
	Ok(())
}

#[tauri::command]
pub async fn config_get_settings(
	instances: State<'_, DbInstances>,
) -> Result<Vec<SettingRowOutput>, String> {
	let pool = sqlite_pool(instances).await?;
	let rows = sqlx::query(
		r#"
		SELECT key, value
		FROM app_settings
		WHERE key IN (
			'locale',
			'theme',
			'work_mode',
			'auto_copy_context_after_add',
			'auto_clear_after_export',
			'context_filter_history_limit',
			'context_history_limit',
			'overlay_undo_history_limit',
			'diagnostic_file_limit',
			'open_explorer_on_app_start',
			'open_explorer_on_project_open',
			'close_explorer_on_folder_close',
			'close_explorer_on_app_exit',
			'hide_open_project_subfolders',
			'folder_action',
			'folder_section_expanded',
			'context_section_expanded',
			'apply_section_expanded',
			'settings_general_expanded',
			'settings_context_expanded',
			'settings_history_expanded',
			'settings_vscode_expanded',
			'settings_explorer_expanded'
		)
		"#,
	)
	.fetch_all(&pool)
	.await
	.map_err(|error| database_error("Could not load the settings", error))?;
	rows.into_iter().map(|row| {
		Ok(SettingRowOutput {
			key: row.try_get("key").map_err(|error| database_error("Invalid setting", error))?,
			value: row.try_get("value").map_err(|error| database_error("Invalid setting", error))?,
		})
	}).collect()
}

#[tauri::command]
pub async fn config_get_project_tabs(
	instances: State<'_, DbInstances>,
) -> Result<Vec<ProjectTabOutput>, String> {
	let pool = sqlite_pool(instances).await?;
	let rows = sqlx::query(
		"SELECT id, root_folder, position, folder_section_expanded, context_section_expanded, apply_section_expanded FROM project_tabs ORDER BY position ASC, id ASC",
	)
	.fetch_all(&pool)
	.await
	.map_err(|error| database_error("Could not load the project tabs", error))?;
	rows.into_iter().map(|row| {
		Ok(ProjectTabOutput {
			id: row.try_get("id").map_err(|error| database_error("Invalid tab", error))?,
			root_folder: row.try_get("root_folder").map_err(|error| database_error("Invalid tab", error))?,
			position: row.try_get("position").map_err(|error| database_error("Invalid tab", error))?,
			folder_section_expanded: row.try_get("folder_section_expanded").map_err(|error| database_error("Invalid tab", error))?,
			context_section_expanded: row.try_get("context_section_expanded").map_err(|error| database_error("Invalid tab", error))?,
			apply_section_expanded: row.try_get("apply_section_expanded").map_err(|error| database_error("Invalid tab", error))?,
		})
	}).collect()
}

#[tauri::command]
pub async fn config_get_active_project_tab_id(
	instances: State<'_, DbInstances>,
) -> Result<Option<String>, String> {
	let pool = sqlite_pool(instances).await?;
	let row = sqlx::query("SELECT value FROM app_settings WHERE key = 'active_project_tab_id'")
		.fetch_optional(&pool)
		.await
		.map_err(|error| database_error("Could not load the active tab", error))?;
	row.map(|row| row.try_get("value").map_err(|error| database_error("Invalid active tab", error))).transpose()
}

#[tauri::command]
pub async fn config_get_context_filter_history(
	root_folder: String,
	limit: i64,
	instances: State<'_, DbInstances>,
) -> Result<Vec<ContextFilterHistoryOutput>, String> {
	validate_root_folder(&root_folder)?;
	validate_history_limit(limit)?;
	let pool = sqlite_pool(instances).await?;
	let rows = sqlx::query("SELECT pattern, target, mode, last_used_at FROM context_filter_history WHERE root_folder = ?1 ORDER BY last_used_at DESC, rowid DESC LIMIT ?2")
		.bind(root_folder)
		.bind(limit)
		.fetch_all(&pool)
		.await
		.map_err(|error| database_error("Could not load the filter history", error))?;
	rows.into_iter().map(|row| {
		Ok(ContextFilterHistoryOutput {
			pattern: row.try_get("pattern").map_err(|error| database_error("Invalid filter", error))?,
			target: row.try_get("target").map_err(|error| database_error("Invalid filter", error))?,
			mode: row.try_get("mode").map_err(|error| database_error("Invalid filter", error))?,
			last_used_at: row.try_get("last_used_at").map_err(|error| database_error("Invalid filter", error))?,
		})
	}).collect()
}

async fn load_context_history_metadata(
	pool: &Pool<Sqlite>,
	root_folder: &str,
	limit: i64,
) -> Result<Vec<ContextHistoryOutput>, String> {
	let rows = sqlx::query("SELECT id, kind, file_count, byte_count, created_at FROM context_export_history WHERE root_folder = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2")
		.bind(root_folder)
		.bind(limit)
		.fetch_all(pool)
		.await
		.map_err(|error| database_error("Could not load the context history", error))?;

	rows.into_iter().map(|row| {
		Ok(ContextHistoryOutput {
			id: row.try_get("id").map_err(|error| database_error("Invalid history entry", error))?,
			kind: row.try_get("kind").map_err(|error| database_error("Invalid history entry", error))?,
			file_count: row.try_get("file_count").map_err(|error| database_error("Invalid history entry", error))?,
			byte_count: row.try_get("byte_count").map_err(|error| database_error("Invalid history entry", error))?,
			created_at: row.try_get("created_at").map_err(|error| database_error("Invalid history entry", error))?,
		})
	}).collect()
}

async fn load_context_history_content_from_pool(
	pool: &Pool<Sqlite>,
	root_folder: &str,
	id: i64,
) -> Result<String, String> {
	let row = sqlx::query("SELECT content FROM context_export_history WHERE root_folder = ?1 AND id = ?2")
		.bind(root_folder)
		.bind(id)
		.fetch_optional(pool)
		.await
		.map_err(|error| database_error("Could not load the context history entry", error))?
		.ok_or_else(|| "The requested history entry no longer exists.".to_string())?;

	row.try_get("content")
		.map_err(|error| database_error("The history content is invalid", error))
}

pub async fn load_context_history_content(
	root_folder: &str,
	id: i64,
	instances: State<'_, DbInstances>,
) -> Result<String, String> {
	validate_root_folder(root_folder)?;
	if id <= 0 {
		return Err("The history entry is invalid.".to_string());
	}

	let pool = sqlite_pool(instances).await?;
	load_context_history_content_from_pool(
		&pool,
		root_folder,
		id,
	).await
}

#[tauri::command]
pub async fn config_get_context_history(
	root_folder: String,
	limit: i64,
	instances: State<'_, DbInstances>,
) -> Result<Vec<ContextHistoryOutput>, String> {
	validate_root_folder(&root_folder)?;
	validate_history_limit(limit)?;
	let pool = sqlite_pool(instances).await?;
	load_context_history_metadata(
		&pool,
		&root_folder,
		limit,
	).await
}

#[tauri::command]
pub async fn config_get_context_history_content(
	root_folder: String,
	id: i64,
	instances: State<'_, DbInstances>,
) -> Result<String, String> {
	load_context_history_content(
		&root_folder,
		id,
		instances,
	).await
}

