#[tauri::command]
pub async fn config_set_setting(
	key: String,
	value: String,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	validate_setting(&key, &value)?;
	let pool = sqlite_pool(instances).await?;
	let mut tx = pool.begin().await.map_err(|error| database_error("Could not start writing the setting", error))?;

	sqlx::query(
		"INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	)
	.bind(&key)
	.bind(&value)
	.execute(&mut *tx)
	.await
	.map_err(|error| database_error("Could not save the setting", error))?;

	if key == "context_filter_history_limit" {
		let limit = value.parse::<i64>().map_err(|_| "Invalid history limit.".to_string())?;
		trim_filter_history(&mut tx, limit).await?;
	} else if key == "context_history_limit" {
		let limit = value.parse::<i64>().map_err(|_| "Invalid history limit.".to_string())?;
		trim_context_history_count(&mut tx, limit).await?;
	}

	tx.commit().await.map_err(|error| database_error("Could not finish writing the setting", error))
}

#[tauri::command]
pub async fn config_upsert_project_tab(
	tab: ProjectTabInput,
	position: i64,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	if tab.id.is_empty() || tab.id.len() > 256 || position < 0 || position >= MAX_PROJECT_TABS as i64 {
		return Err("The project tab contains invalid data.".to_string());
	}
	if let Some(root_folder) = tab.root_folder.as_deref() {
		validate_root_folder(root_folder)?;
	}
	let pool = sqlite_pool(instances).await?;
	if let Some(root_folder) = tab.root_folder.as_deref() {
		ensure_unique_project_root(
			&pool,
			&tab.id,
			root_folder,
		)
		.await?;
	}
	sqlx::query(
		r#"
		INSERT INTO project_tabs (
			id, root_folder, position, folder_section_expanded,
			context_section_expanded, apply_section_expanded
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
		ON CONFLICT(id) DO UPDATE SET
			root_folder = excluded.root_folder,
			position = excluded.position,
			folder_section_expanded = excluded.folder_section_expanded,
			context_section_expanded = excluded.context_section_expanded,
			apply_section_expanded = excluded.apply_section_expanded
		"#,
	)
	.bind(tab.id)
	.bind(tab.root_folder)
	.bind(position)
	.bind(if tab.folder_section_expanded { 1_i64 } else { 0_i64 })
	.bind(if tab.context_section_expanded { 1_i64 } else { 0_i64 })
	.bind(if tab.apply_section_expanded { 1_i64 } else { 0_i64 })
	.execute(&pool)
	.await
	.map_err(|error| database_error("Could not save the project tab", error))?;
	Ok(())
}

#[tauri::command]
pub async fn config_delete_project_tab(
	id: String,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	if id.is_empty() || id.len() > 256 {
		return Err("The project tab is invalid.".to_string());
	}
	let pool = sqlite_pool(instances).await?;
	sqlx::query("DELETE FROM project_tabs WHERE id = ?1")
		.bind(id)
		.execute(&pool)
		.await
		.map_err(|error| database_error("Could not delete the project tab", error))?;
	Ok(())
}

#[tauri::command]
pub async fn config_save_project_tab_order(
	ids: Vec<String>,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	if ids.len() > MAX_PROJECT_TABS || ids.iter().any(|id| id.is_empty() || id.len() > 256) {
		return Err("The tab order contains invalid data.".to_string());
	}
	let unique_ids = ids.iter().collect::<HashSet<_>>();
	if unique_ids.len() != ids.len() {
		return Err("The tab order contains duplicate identifiers.".to_string());
	}
	let pool = sqlite_pool(instances).await?;
	let mut tx = pool.begin().await.map_err(|error| database_error("Could not start writing the tab order", error))?;
	let existing_rows = sqlx::query("SELECT id FROM project_tabs ORDER BY position ASC, id ASC")
		.fetch_all(&mut *tx)
		.await
		.map_err(|error| database_error("Could not validate the tab order", error))?;
	let existing_ids = existing_rows
		.into_iter()
		.map(|row| row.try_get::<String, _>("id")
			.map_err(|error| database_error("Invalid tab while ordering tabs", error)))
		.collect::<Result<Vec<_>, _>>()?;
	let existing_set = existing_ids.iter().cloned().collect::<HashSet<_>>();
	if ids.iter().any(|id| !existing_set.contains(id)) {
		return Err("The tab order became stale because a tab was already removed.".to_string());
	}

	let requested_set = ids.iter().cloned().collect::<HashSet<_>>();
	let mut complete_order = ids;
	complete_order.extend(existing_ids.into_iter().filter(|id| !requested_set.contains(id)));

	for (position, id) in complete_order.iter().enumerate() {
		sqlx::query("UPDATE project_tabs SET position = ?1 WHERE id = ?2")
			.bind(position as i64)
			.bind(id)
			.execute(&mut *tx)
			.await
			.map_err(|error| database_error("Could not save the tab order", error))?;
	}
	tx.commit().await.map_err(|error| database_error("Could not finish writing the tab order", error))
}

#[tauri::command]
pub async fn config_set_project_tab_section_expanded(
	id: String,
	section: String,
	expanded: bool,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	if id.is_empty() || id.len() > 256 {
		return Err("The project tab is invalid.".to_string());
	}
	let column = match section.as_str() {
		"folder" => "folder_section_expanded",
		"context" => "context_section_expanded",
		"apply" => "apply_section_expanded",
		_ => return Err("The requested project section is invalid.".to_string()),
	};
	let pool = sqlite_pool(instances).await?;
	let sql = format!("UPDATE project_tabs SET {column} = ?1 WHERE id = ?2");
	sqlx::query(&sql)
		.bind(if expanded { 1_i64 } else { 0_i64 })
		.bind(id)
		.execute(&pool)
		.await
		.map_err(|error| database_error("Could not save the project section", error))?;
	Ok(())
}

#[tauri::command]
pub async fn config_save_context_filter_history_entry(
	root_folder: String,
	pattern: String,
	target: String,
	mode: String,
	last_used_at: i64,
	limit: i64,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	validate_history_limit(limit)?;
	validate_root_folder(&root_folder)?;
	if pattern.len() > MAX_FILTER_PATTERN_BYTES {
		return Err("The context filter is too large.".to_string());
	}
	if !matches!(target.as_str(), "fileName" | "path") || !matches!(mode.as_str(), "contains" | "exact" | "regex") {
		return Err("The context filter contains invalid data.".to_string());
	}
	let pool = sqlite_pool(instances).await?;
	let mut tx = pool.begin().await.map_err(|error| database_error("Could not start writing the filter", error))?;
	sqlx::query(
		"INSERT INTO context_filter_history (root_folder, pattern, target, mode, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(root_folder, pattern, target, mode) DO UPDATE SET last_used_at = excluded.last_used_at",
	)
	.bind(&root_folder).bind(pattern).bind(target).bind(mode).bind(last_used_at)
	.execute(&mut *tx).await
	.map_err(|error| database_error("Could not save the context filter", error))?;
	sqlx::query(
		"DELETE FROM context_filter_history WHERE root_folder = ?1 AND rowid NOT IN (SELECT rowid FROM context_filter_history WHERE root_folder = ?1 ORDER BY last_used_at DESC, rowid DESC LIMIT ?2)",
	)
	.bind(&root_folder).bind(limit)
	.execute(&mut *tx).await
	.map_err(|error| database_error("Could not trim the filter history", error))?;
	tx.commit().await.map_err(|error| database_error("Could not finish writing the filter", error))
}

#[tauri::command]
pub async fn config_delete_context_filter_history_entry(
	root_folder: String,
	pattern: String,
	target: String,
	mode: String,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	validate_root_folder(&root_folder)?;
	if pattern.len() > MAX_FILTER_PATTERN_BYTES || !matches!(target.as_str(), "fileName" | "path") || !matches!(mode.as_str(), "contains" | "exact" | "regex") {
		return Err("The context filter contains invalid data.".to_string());
	}
	let pool = sqlite_pool(instances).await?;
	sqlx::query("DELETE FROM context_filter_history WHERE root_folder = ?1 AND pattern = ?2 AND target = ?3 AND mode = ?4")
		.bind(root_folder).bind(pattern).bind(target).bind(mode)
		.execute(&pool).await
		.map_err(|error| database_error("Could not delete the filter history entry", error))?;
	Ok(())
}

fn validate_context_history_kind(kind: &str) -> Result<(), String> {
	if matches!(kind, "custom" | "project" | "commit" | "typecheck" | "lintfix" | "eslint" | "test") {
		Ok(())
	} else {
		Err("The context history kind is invalid.".to_string())
	}
}

