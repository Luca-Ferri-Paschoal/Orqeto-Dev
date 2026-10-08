pub async fn save_context_history_record(
	root_folder: &str,
	kind: &str,
	content: &str,
	file_count: i64,
	byte_count: i64,
	created_at: i64,
	limit: i64,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	let _write_guard = write_state.write_lock.lock().await;
	validate_history_limit(limit)?;
	validate_root_folder(root_folder)?;
	validate_context_history_kind(kind)?;
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
	sqlx::query("INSERT INTO context_export_history (root_folder, kind, content, file_count, byte_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
		.bind(root_folder).bind(kind).bind(content).bind(file_count).bind(byte_count).bind(created_at)
		.execute(&mut *tx).await
		.map_err(|error| database_error("Could not save the context history", error))?;
	sqlx::query("DELETE FROM context_export_history WHERE root_folder = ?1 AND id NOT IN (SELECT id FROM context_export_history WHERE root_folder = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2)")
		.bind(root_folder).bind(limit)
		.execute(&mut *tx).await
		.map_err(|error| database_error("Could not trim the context history", error))?;
	trim_context_history_bytes(&mut tx, root_folder).await?;
	tx.commit().await.map_err(|error| database_error("Could not finish writing the context history", error))
}

#[tauri::command]
pub async fn config_save_context_history_entry(
	root_folder: String,
	kind: String,
	content: String,
	file_count: i64,
	byte_count: i64,
	created_at: i64,
	limit: i64,
	write_state: State<'_, ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<(), String> {
	save_context_history_record(
		&root_folder,
		&kind,
		&content,
		file_count,
		byte_count,
		created_at,
		limit,
		write_state,
		instances,
	).await
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
				kind TEXT NOT NULL DEFAULT 'custom',
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
					kind: "custom".to_string(),
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
	fn br_history_006_context_history_metadata_preserves_generator_kind() {
		tauri::async_runtime::block_on(async {
			let pool = history_test_pool().await;
			let content = "eslint report";

			sqlx::query(
				"INSERT INTO context_export_history (root_folder, kind, content, file_count, byte_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
			)
			.bind("C:/project")
			.bind("eslint")
			.bind(content)
			.bind(3_i64)
			.bind(i64::try_from(content.len()).expect("content length"))
			.bind(321_i64)
			.execute(&pool)
			.await
			.expect("insert typed history");

			let entries = load_context_history_metadata(
				&pool,
				"C:/project",
				5,
			)
			.await
			.expect("load typed metadata");

			assert_eq!(entries.len(), 1);
			assert_eq!(entries[0].kind, "eslint");
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

