fn append_context_tree(
	mut node: ContextTreeNode,
	blocks: &mut Vec<String>,
	is_root: bool,
	protocol: &ContextProtocol,
) {
	node.files.sort_by(|left, right| left.name.cmp(&right.name));
	for file in node.files {
		blocks.push(format_context_file(
			&file.name,
			file.content,
			protocol,
		));
	}
	for (directory_name, directory_node) in node.directories {
		let (directory_path, mut compressed) = compressed_context_directory(
			directory_name,
			directory_node,
		);
		if compressed.files.len() == 1 && compressed.directories.is_empty() {
			let file = compressed.files.pop().expect("single file should exist");
			let relative_name = if is_root {
				format!("./{directory_path}/{}", file.name)
			} else {
				format!("{directory_path}/{}", file.name)
			};
			blocks.push(format_context_file(
				&relative_name,
				file.content,
				protocol,
			));
			continue;
		}
		blocks.push(format!(
			"===== {}: {} =====",
			protocol.folder,
			if is_root {
				format!("./{directory_path}")
			} else {
				directory_path
			},
		));
		append_context_tree(
			compressed,
			blocks,
			false,
			protocol,
		);
		blocks.push(format!("===== {} =====", protocol.back));
	}
}

fn format_materialized_context(
	files: Vec<GeneratedFile>,
	locale: &str,
	work_mode: &str,
) -> Result<String, String> {
	if files.is_empty() {
		return Ok(String::new());
	}
	let protocol = context_protocol(locale)?;
	let mode_lines = match work_mode {
		"files" => vec![
			protocol.work_mode_files,
			protocol.files_patch_instruction,
			protocol.delete_manifest_description,
			protocol.delete_manifest_format,
			protocol.delete_manifest_paths,
			protocol.delete_manifest_permanent,
			protocol.delete_manifest_optional,
		],
		"git" => vec![
			protocol.work_mode_git,
			protocol.git_patch_instruction,
			protocol.git_patch_safety,
		],
		_ => return Err("The requested context work mode is invalid.".to_string()),
	};
	let mut header_lines = vec![
		protocol.header,
		protocol.label,
	];
	header_lines.extend(mode_lines);
	header_lines.extend([
		protocol.root_description,
		protocol.folder_description,
		protocol.back_description,
		protocol.file_description,
		protocol.content_description,
		protocol.path_only_description,
		protocol.redaction_description,
	]);
	let mut blocks = vec![format!(
		"{}\n===== {}: ./ =====",
		header_lines.join("\n"),
		protocol.root,
	)];
	let mut tree = ContextTreeNode::default();
	for file in files {
		insert_context_tree_file(
			&mut tree,
			file,
		);
	}
	append_context_tree(
		tree,
		&mut blocks,
		true,
		&protocol,
	);
	blocks.push(protocol.end.to_string());
	Ok(format!("{}\n", blocks.join("\n\n")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullProjectContextExportResult {
	saved: bool,
	file_count: usize,
	skipped_file_count: usize,
	skipped_directory_count: usize,
	history_error: Option<String>,
}

#[tauri::command]
async fn save_full_project_context_export_file(
	app: AppHandle,
	root_folder: String,
	relative_paths: Vec<String>,
	paths_only: bool,
	locale: String,
	work_mode: String,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	context_history_limit: i64,
	undo_state: State<'_, overlay::OverlayUndoState>,
	config_write_state: State<'_, config_database::ConfigDatabaseState>,
	instances: State<'_, DbInstances>,
) -> Result<FullProjectContextExportResult, String> {
	let root_folder_for_history = root_folder.clone();
	let materialized = {
		let _read_guard = undo_state.begin_project_read(&root_folder)?;
		tauri::async_runtime::spawn_blocking(move || {
			materialize_context_files_blocking(
				root_folder,
				relative_paths,
				paths_only,
			)
		})
		.await
		.map_err(|error| format!("Project-context generation was interrupted: {error}"))??
	};
	let file_count = materialized.files.len();
	let skipped_file_count = materialized.skipped_files.len();
	let skipped_directory_count = materialized.skipped_directory_count;
	if file_count == 0 {
		return Ok(FullProjectContextExportResult {
			saved: false,
			file_count,
			skipped_file_count,
			skipped_directory_count,
			history_error: None,
		});
	}
	let content = format_materialized_context(
		materialized.files,
		&locale,
		&work_mode,
	)?;
	let (saved, content) = save_export_file_content(
		app,
		suggested_file_name,
		dialog_title,
		filter_name,
		extension,
		content,
	).await?;
	let history_error = if saved {
		config_database::save_context_history_record(
			&root_folder_for_history,
			"project",
			&content,
			i64::try_from(file_count).map_err(|_| "The project context contains too many files.".to_string())?,
			i64::try_from(content.len()).map_err(|_| "The project context is too large.".to_string())?,
			i64::try_from(current_unix_ms()).unwrap_or(i64::MAX),
			context_history_limit,
			config_write_state,
			instances,
		).await.err()
	} else {
		None
	};
	Ok(FullProjectContextExportResult {
		saved,
		file_count,
		skipped_file_count,
		skipped_directory_count,
		history_error,
	})
}

const MAX_EXPORT_BYTES: usize = 128 * 1024 * 1024;

async fn save_export_file_content(
	app: AppHandle,
	suggested_file_name: String,
	dialog_title: String,
	filter_name: String,
	extension: String,
	content: String,
) -> Result<(bool, String), String> {
	if suggested_file_name.is_empty() ||
		suggested_file_name.len() > 255 ||
		suggested_file_name.chars().any(|character| matches!(character, '/' | '\\' | '\0'))
	{
		return Err("The suggested export name is invalid.".to_string());
	}

	if dialog_title.len() > 256 || filter_name.is_empty() || filter_name.len() > 128 {
		return Err("The export-window data is invalid.".to_string());
	}

	if extension != "txt" {
		return Err("The requested export format is not allowed.".to_string());
	}

	if content.len() > MAX_EXPORT_BYTES {
		return Err(format!(
			"The export file exceeds the {} MiB limit.",
			MAX_EXPORT_BYTES / (1024 * 1024),
		));
	}

	tauri::async_runtime::spawn_blocking(move || {
		let selected = app
			.dialog()
			.file()
			.set_title(dialog_title)
			.set_file_name(suggested_file_name)
			.add_filter(filter_name, &[extension.as_str()])
			.blocking_save_file();
		let Some(selected) = selected else {
			return Ok((false, content));
		};
		let path = selected
			.into_path()
			.map_err(|error| format!("The selected export destination is invalid: {error}"))?;
		safe_fs::atomic_write_bytes(&path, content.as_bytes())
			.map_err(|error| format!("Could not save the file: {error}"))?;
		Ok((true, content))
	})
	.await
	.map_err(|error| format!("Writing the file was interrupted: {error}"))?
}

