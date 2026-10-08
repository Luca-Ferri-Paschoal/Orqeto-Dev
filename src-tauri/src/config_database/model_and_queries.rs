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
	kind: String,
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

