fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
	let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
		String::from_utf8(bytes[3..].to_vec())
			.map_err(|_| "The file does not contain valid UTF-8 text.".to_string())?
	} else if bytes.starts_with(&[0xFF, 0xFE]) {
		decode_utf16(
			&bytes[2..],
			true,
		)?
	} else if bytes.starts_with(&[0xFE, 0xFF]) {
		decode_utf16(
			&bytes[2..],
			false,
		)?
	} else {
		String::from_utf8(bytes)
			.map_err(|_| "The file does not contain valid UTF-8 text.".to_string())?
	};

	if content.contains('\0') {
		return Err("The file appears to be binary and was skipped.".to_string());
	}

	Ok(content)
}

fn relative_path(
	root: &Path,
	path: &Path,
) -> Result<String, String> {
	let relative = path
		.strip_prefix(root)
		.map_err(|_| "Could not calculate the file-relative path.".to_string())?;
	let normalized = relative
		.to_string_lossy()
		.replace('\\', "/");

	Ok(format!("./{normalized}"))
}

fn is_context_zip_file(file_path: &Path) -> bool {
	file_path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

fn materialize_context_file(
	file_path: &Path,
	relative_path: String,
	paths_only: bool,
	total_content_bytes: &mut u64,
) -> Result<Result<GeneratedFile, SkippedFile>, String> {
	if is_context_zip_file(file_path) {
		return Ok(Err(SkippedFile {
			relative_path,
			reason: "ZIP files are not added to context. Use the Apply code area.".to_string(),
		}));
	}

	if paths_only {
		return Ok(Ok(GeneratedFile {
			relative_path,
			content: None,
		}));
	}

	let metadata_size = fs::metadata(file_path)
		.map_err(|error| format!("Could not read {}: {error}", file_path.display()))?
		.len();
	if metadata_size > CONTEXT_MAX_FILE_BYTES {
		return Ok(Err(SkippedFile {
			relative_path,
			reason: format!(
				"File omitted because it exceeds the {} MiB per-context-file limit.",
				CONTEXT_MAX_FILE_BYTES / (1024 * 1024),
			),
		}));
	}

	let file = File::open(file_path)
		.map_err(|error| format!("Could not open {}: {error}", file_path.display()))?;
	let mut bytes = Vec::with_capacity(metadata_size.min(CONTEXT_MAX_FILE_BYTES) as usize);
	file.take(CONTEXT_MAX_FILE_BYTES + 1)
		.read_to_end(&mut bytes)
		.map_err(|error| format!("Could not read {}: {error}", file_path.display()))?;
	if bytes.len() as u64 > CONTEXT_MAX_FILE_BYTES {
		return Ok(Err(SkippedFile {
			relative_path,
			reason: format!(
				"File omitted because it grew beyond the {} MiB limit while being read.",
				CONTEXT_MAX_FILE_BYTES / (1024 * 1024),
			),
		}));
	}

	*total_content_bytes = total_content_bytes
		.checked_add(bytes.len() as u64)
		.ok_or_else(|| "The total context size is invalid.".to_string())?;
	if *total_content_bytes > CONTEXT_MAX_TOTAL_BYTES {
		return Err(format!(
			"The selected content exceeds the {} MiB per-context-operation limit.",
			CONTEXT_MAX_TOTAL_BYTES / (1024 * 1024),
		));
	}

	match decode_text(bytes) {
		Ok(content) => {
			let redacted_content = context_redaction::redact_file_content(
				&relative_path,
				content,
			);
			Ok(Ok(GeneratedFile {
				relative_path,
				content: Some(redacted_content),
			}))
		}
		Err(reason) => Ok(Err(SkippedFile {
			relative_path,
			reason,
		})),
	}
}

fn parse_stored_context_relative_path(
	root: &Path,
	value: &str,
) -> Result<PathBuf, String> {
	if value.is_empty() || value.len() > CONTEXT_MAX_PATH_BYTES || value.contains('\0') || value.contains('\\') {
		return Err("The context contains an invalid saved path.".to_string());
	}

	let stripped = value
		.strip_prefix("./")
		.ok_or_else(|| "The context contains a path that is not relative to the project root.".to_string())?;
	if stripped.is_empty() {
		return Err("The context contains an empty file path.".to_string());
	}

	let relative = PathBuf::from(stripped);
	safe_fs::validate_project_relative_path(
		root,
		&relative,
	)?;
	Ok(relative)
}

#[tauri::command]
fn folder_exists(path: String) -> bool {
	Path::new(&path).is_dir()
}

fn canonical_project_roots(root_folders: &[String]) -> Vec<Option<PathBuf>> {
	root_folders
		.iter()
		.map(|root_folder| {
			canonicalize_existing(Path::new(root_folder))
				.ok()
				.filter(|root| root.is_dir())
		})
		.collect()
}

#[tauri::command]
fn find_project_for_root(
	root_folders: Vec<String>,
	path: String,
) -> Result<Option<usize>, String> {
	let requested = canonicalize_existing(Path::new(&path))?;

	if !requested.is_dir() {
		return Ok(None);
	}

	Ok(canonical_project_roots(&root_folders)
		.into_iter()
		.position(|root| root.is_some_and(|root| root == requested)))
}

#[tauri::command]
fn find_project_for_paths(
	root_folders: Vec<String>,
	paths: Vec<String>,
) -> Result<Option<usize>, String> {
	if paths.is_empty() {
		return Ok(None);
	}

	let canonical_paths = paths
		.iter()
		.map(|path| canonicalize_existing(Path::new(path)))
		.collect::<Result<Vec<_>, _>>()?;
	let roots = canonical_project_roots(&root_folders);
	let mut best_match: Option<(usize, usize)> = None;

	for (index, root) in roots.into_iter().enumerate() {
		let Some(root) = root else {
			continue;
		};

		if !canonical_paths.iter().all(|path| path.starts_with(&root)) {
			continue;
		}

		let depth = root.components().count();

		if best_match.is_none_or(|(_, best_depth)| depth > best_depth) {
			best_match = Some((index, depth));
		}
	}

	Ok(best_match.map(|(index, _)| index))
}

fn resolve_executable_from_path(name: &str) -> Option<PathBuf> {
	let path = std::env::var_os("PATH")?;
	std::env::split_paths(&path)
		.map(|directory| directory.join(name))
		.find(|candidate| candidate.is_file())
		.and_then(|candidate| fs::canonicalize(candidate).ok())
}

#[cfg(target_os = "windows")]
const WINDOWS_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const MAX_EXTERNAL_COMMAND_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
#[cfg(target_os = "windows")]
const MAX_EXTERNAL_COMMAND_RUNTIME: Duration = Duration::from_secs(60);

#[cfg(target_os = "windows")]
fn read_external_output_bounded<R: Read + Send + 'static>(
	mut reader: R,
	total_bytes: Arc<AtomicUsize>,
	exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
	thread::spawn(move || {
		let mut output = Vec::new();
		let mut buffer = [0_u8; 16 * 1024];
		loop {
			let read = reader.read(&mut buffer)?;
			if read == 0 {
				break;
			}
			let previous = total_bytes.fetch_add(read, Ordering::AcqRel);
			if previous.saturating_add(read) > MAX_EXTERNAL_COMMAND_OUTPUT_BYTES {
				exceeded.store(true, Ordering::Release);
				continue;
			}
			output.extend_from_slice(&buffer[..read]);
		}
		Ok(output)
	})
}

