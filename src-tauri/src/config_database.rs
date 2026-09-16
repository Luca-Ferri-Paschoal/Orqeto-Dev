use serde::{Deserialize, Serialize};
use std::{
	collections::HashSet,
	fs,
	path::Path,
};
use sqlx::{Pool, Row, Sqlite};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_URL: &str = "sqlite:orqeto-dev.db";
const HISTORY_LIMIT_MIN: i64 = 1;
const HISTORY_LIMIT_MAX: i64 = 100;
const MAX_PROJECT_TABS: usize = 1_000;
const MAX_CONTEXT_HISTORY_FILES: i64 = 500_000;
const MAX_CONTEXT_HISTORY_ENTRY_BYTES: i64 = 128 * 1024 * 1024;
const MAX_CONTEXT_HISTORY_TOTAL_BYTES: i64 = 256 * 1024 * 1024;

const MAX_ROOT_FOLDER_BYTES: usize = 32 * 1024;
const MAX_FILTER_PATTERN_BYTES: usize = 16 * 1024;

pub struct ConfigDatabaseState {
	write_lock: tokio::sync::Mutex<()>,
}

impl ConfigDatabaseState {
	pub fn new() -> Self {
		Self {
			write_lock: tokio::sync::Mutex::new(()),
		}
	}
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRowOutput {
	key: String,
	value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTabOutput {
	id: String,
	root_folder: Option<String>,
	position: i64,
	folder_section_expanded: i64,
	context_section_expanded: i64,
	apply_section_expanded: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextFilterHistoryOutput {
	pattern: String,
	target: String,
	mode: String,
	last_used_at: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextHistoryOutput {
	id: i64,
	file_count: i64,
	byte_count: i64,
	created_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTabInput {
	id: String,
	root_folder: Option<String>,
	folder_section_expanded: bool,
	context_section_expanded: bool,
	apply_section_expanded: bool,
}

fn database_error(context: &str, error: impl std::fmt::Display) -> String {
	format!("{context}: {error}")
}

async fn sqlite_pool(instances: State<'_, DbInstances>) -> Result<Pool<Sqlite>, String> {
	let instances = instances.0.read().await;
	let pool = instances
		.get(DATABASE_URL)
		.ok_or_else(|| "The configuration database has not been initialized yet.".to_string())?;
	match pool {
		DbPool::Sqlite(pool) => Ok(pool.clone()),
		#[allow(unreachable_patterns)]
		_ => Err("The configuration database has an unexpected type.".to_string()),
	}
}

fn validate_history_limit(limit: i64) -> Result<(), String> {
	if (HISTORY_LIMIT_MIN..=HISTORY_LIMIT_MAX).contains(&limit) {
		Ok(())
	} else {
		Err(format!(
			"The history limit must be between {HISTORY_LIMIT_MIN} and {HISTORY_LIMIT_MAX}.",
		))
	}
}

fn validate_root_folder(root_folder: &str) -> Result<(), String> {
	if root_folder.is_empty() || root_folder.len() > MAX_ROOT_FOLDER_BYTES {
		Err("The project folder has an invalid length.".to_string())
	} else {
		Ok(())
	}
}

fn canonical_project_roots_equal(
	left: &Path,
	right: &Path,
) -> bool {
	#[cfg(target_os = "windows")]
	{
		return left
			.to_string_lossy()
			.eq_ignore_ascii_case(&right.to_string_lossy());
	}

	#[cfg(not(target_os = "windows"))]
	{
		left == right
	}
}

async fn ensure_unique_project_root(
	pool: &Pool<Sqlite>,
	tab_id: &str,
	root_folder: &str,
) -> Result<(), String> {
	let requested = fs::canonicalize(root_folder)
		.map_err(|error| database_error("Could not validate the project folder", error))?;

	if !requested.is_dir() {
		return Err("The project folder is not available.".to_string());
	}

	let rows = sqlx::query(
		"SELECT root_folder FROM project_tabs WHERE id <> ?1 AND root_folder IS NOT NULL",
	)
	.bind(tab_id)
	.fetch_all(pool)
	.await
	.map_err(|error| database_error("Could not validate the project tabs", error))?;

	for row in rows {
		let existing_root = row
			.try_get::<String, _>("root_folder")
			.map_err(|error| database_error("Invalid project tab", error))?;
		let Ok(existing) = fs::canonicalize(existing_root) else {
			continue;
		};

		if canonical_project_roots_equal(
			&requested,
			&existing,
		) {
			return Err("This project is already open in another tab.".to_string());
		}
	}

	Ok(())
}

fn validate_setting(key: &str, value: &str) -> Result<(), String> {
	let valid = match key {
		"active_project_tab_id" => !value.is_empty() && value.len() <= 256,
		"locale" => matches!(value, "pt-BR" | "en"),
		"theme" => matches!(value, "light" | "dark"),
		"work_mode" => matches!(value, "files" | "git"),
		"folder_action" => matches!(value, "select" | "explorer" | "vscode" | "close"),
		"auto_copy_context_after_add" |
		"auto_clear_after_export" |
		"open_explorer_on_app_start" |
		"open_explorer_on_project_open" |
		"close_explorer_on_folder_close" |
		"close_explorer_on_app_exit" |
		"hide_open_project_subfolders" |
		"folder_section_expanded" |
		"context_section_expanded" |
		"apply_section_expanded" |
		"settings_general_expanded" |
		"settings_context_expanded" |
		"settings_history_expanded" |
		"settings_vscode_expanded" |
		"settings_explorer_expanded" => matches!(value, "0" | "1"),
		"context_filter_history_limit" |
		"context_history_limit" |
		"overlay_undo_history_limit" |
		"diagnostic_file_limit" => value
			.parse::<i64>()
			.ok()
			.is_some_and(|limit| (HISTORY_LIMIT_MIN..=HISTORY_LIMIT_MAX).contains(&limit)),
		_ => false,
	};

	if valid {
		Ok(())
	} else {
		Err("The requested setting is not recognized or has an invalid value.".to_string())
	}
}

async fn trim_filter_history(
	tx: &mut sqlx::Transaction<'_, Sqlite>,
	limit: i64,
) -> Result<(), String> {
	sqlx::query(
		r#"
		DELETE FROM context_filter_history
		WHERE rowid IN (
			SELECT rowid FROM (
				SELECT rowid,
					ROW_NUMBER() OVER (
						PARTITION BY root_folder
						ORDER BY last_used_at DESC, rowid DESC
					) AS history_position
				FROM context_filter_history
			)
			WHERE history_position > ?1
		)
		"#,
	)
	.bind(limit)
	.execute(&mut **tx)
	.await
	.map_err(|error| database_error("Could not trim the filter history", error))?;
	Ok(())
}

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
	let rows = sqlx::query("SELECT id, file_count, byte_count, created_at FROM context_export_history WHERE root_folder = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2")
		.bind(root_folder)
		.bind(limit)
		.fetch_all(pool)
		.await
		.map_err(|error| database_error("Could not load the context history", error))?;

	rows.into_iter().map(|row| {
		Ok(ContextHistoryOutput {
			id: row.try_get("id").map_err(|error| database_error("Invalid history entry", error))?,
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

#[tauri::command]
pub async fn config_save_context_history_entry(
	root_folder: String,
	content: String,
	file_count: i64,
	byte_count: i64,
	created_at: i64,
	limit: i64,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	validate_history_limit(limit)?;
	validate_root_folder(&root_folder)?;
	let actual_bytes = i64::try_from(content.len()).map_err(|_| "The context is too large.".to_string())?;
	if byte_count != actual_bytes ||
		byte_count < 0 ||
		byte_count > MAX_CONTEXT_HISTORY_ENTRY_BYTES ||
		file_count < 0 ||
		file_count > MAX_CONTEXT_HISTORY_FILES
	{
		return Err(format!(
			"The history entry exceeds the {} MiB limit or contains invalid metadata.",
			MAX_CONTEXT_HISTORY_ENTRY_BYTES / (1024 * 1024),
		));
	}
	let pool = sqlite_pool(instances).await?;
	let mut tx = pool.begin().await.map_err(|error| database_error("Could not start writing the context history", error))?;
	sqlx::query("INSERT INTO context_export_history (root_folder, content, file_count, byte_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
		.bind(&root_folder).bind(content).bind(file_count).bind(byte_count).bind(created_at)
		.execute(&mut *tx).await
		.map_err(|error| database_error("Could not save the context history", error))?;
	sqlx::query("DELETE FROM context_export_history WHERE root_folder = ?1 AND id NOT IN (SELECT id FROM context_export_history WHERE root_folder = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2)")
		.bind(&root_folder).bind(limit)
		.execute(&mut *tx).await
		.map_err(|error| database_error("Could not trim the context history", error))?;
	trim_context_history_bytes(&mut tx, &root_folder).await?;
	tx.commit().await.map_err(|error| database_error("Could not finish writing the context history", error))
}

#[tauri::command]
pub async fn config_delete_context_history_entry(
	root_folder: String,
	id: i64,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	validate_root_folder(&root_folder)?;
	if id <= 0 {
		return Err("The history entry is invalid.".to_string());
	}
	let pool = sqlite_pool(instances).await?;
	sqlx::query("DELETE FROM context_export_history WHERE root_folder = ?1 AND id = ?2")
		.bind(root_folder).bind(id)
		.execute(&pool).await
		.map_err(|error| database_error("Could not delete the context history entry", error))?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use sqlx::sqlite::SqlitePoolOptions;

	async fn history_test_pool() -> Pool<Sqlite> {
		let pool = SqlitePoolOptions::new()
			.max_connections(1)
			.connect("sqlite::memory:")
			.await
			.expect("open in-memory sqlite");

		sqlx::query(
			"
			CREATE TABLE context_export_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				root_folder TEXT NOT NULL,
				content TEXT NOT NULL,
				file_count INTEGER NOT NULL,
				byte_count INTEGER NOT NULL,
				created_at INTEGER NOT NULL
			);
			",
		)
		.execute(&pool)
		.await
		.expect("create history table");

		pool
	}

	#[test]
	fn br_history_001_history_listing_returns_metadata_without_content_blob() {
		tauri::async_runtime::block_on(async {
			let pool = history_test_pool().await;
			let content = "large-history-payload-".repeat(16_384);
			let content_bytes = i64::try_from(content.len()).expect("content length");

			sqlx::query(
				"INSERT INTO context_export_history (root_folder, content, file_count, byte_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
			)
			.bind("C:/project")
			.bind(&content)
			.bind(7_i64)
			.bind(content_bytes)
			.bind(123_i64)
			.execute(&pool)
			.await
			.expect("insert history");

			let entries = load_context_history_metadata(
				&pool,
				"C:/project",
				5,
			)
			.await
			.expect("load metadata");

			assert_eq!(
				entries,
				vec![ContextHistoryOutput {
					id: 1,
					file_count: 7,
					byte_count: content_bytes,
					created_at: 123,
				}],
			);

			let serialized = serde_json::to_string(&entries).expect("serialize metadata");
			assert!(serialized.len() < 256);
			assert!(!serialized.contains("large-history-payload"));
		});
	}

	#[test]
	fn br_history_002_history_content_is_loaded_lazily_and_exactly() {
		tauri::async_runtime::block_on(async {
			let pool = history_test_pool().await;
			let content = "exact archived context\nwith unicode: Δ🚀\n";

			sqlx::query(
				"INSERT INTO context_export_history (root_folder, content, file_count, byte_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
			)
			.bind("C:/project")
			.bind(content)
			.bind(2_i64)
			.bind(i64::try_from(content.len()).expect("content length"))
			.bind(456_i64)
			.execute(&pool)
			.await
			.expect("insert history");

			let loaded = load_context_history_content_from_pool(
				&pool,
				"C:/project",
				1,
			)
			.await
			.expect("load exact content");

			assert_eq!(loaded, content);
		});
	}
}

