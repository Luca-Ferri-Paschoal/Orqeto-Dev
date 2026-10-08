fn execute_git_apply(
	repository_root: &Path,
	root_relative_to_repository: &Path,
	options: &[&str],
	patch_bytes: Arc<[u8]>,
) -> Result<Output, String> {
	let sandbox = create_git_apply_sandbox()?;
	let mut last_error: Option<String> = None;

	for executable in git_candidates() {
		let mut command = configure_git_command(
			&executable,
			repository_root,
		);
		configure_git_apply_sandbox(
			&mut command,
			&sandbox,
			repository_root,
		);
		command.arg("apply");
		command.arg("--whitespace=warn");
		command.args(options);

		if !root_relative_to_repository.as_os_str().is_empty() {
			command.arg(format!(
				"--directory={}",
				root_relative_to_repository.to_string_lossy().replace('\\', "/"),
			));
		}

		match execute_command_bounded(command, Some(Arc::clone(&patch_bytes))) {
			Ok(output) => return Ok(output),
			Err(GitCommandExecutionError::Spawn(error)) => {
				last_error = Some(format!(
					"Could not execute {}: {error}",
					executable.display(),
				));
			}
			Err(error @ GitCommandExecutionError::Runtime(_)) => {
				return Err(format!(
					"Execution of {} failed after the process started: {}",
					executable.display(),
					error.into_message(),
				));
			}
		}
	}

	Err(last_error.unwrap_or_else(|| {
		"Could not locate Git on this computer.".to_string()
	}))
}

fn output_text(output: &[u8]) -> String {
	String::from_utf8_lossy(output)
		.trim_end_matches(|character| character == '\r' || character == '\n')
		.to_string()
}

fn git_failure(output: &Output) -> String {
	let stderr = output_text(&output.stderr);
	let stdout = output_text(&output.stdout);
	let details = if stderr.is_empty() {
		stdout
	} else {
		stderr
	};

	if details.is_empty() {
		"Git could not complete the requested operation.".to_string()
	} else {
		details
	}
}

fn run_git(
	root: &Path,
	args: &[&str],
) -> Result<String, String> {
	let output = execute_git(
		root,
		args,
	)?;

	if output.status.success() {
		return Ok(output_text(&output.stdout));
	}

	Err(git_failure(&output))
}

fn is_git_repository_blocking(root_folder: &str) -> Result<bool, String> {
	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Ok(false);
	}

	let output = execute_git(
		&root,
		&[
			"rev-parse",
			"--is-inside-work-tree",
		],
	)?;

	Ok(output.status.success() && output_text(&output.stdout) == "true")
}

fn decode_utf16(
	bytes: &[u8],
	little_endian: bool,
) -> Option<String> {
	if bytes.len() % 2 != 0 {
		return None;
	}

	let code_units = bytes
		.chunks_exact(2)
		.map(|chunk| {
			let pair = [chunk[0], chunk[1]];

			if little_endian {
				u16::from_le_bytes(pair)
			} else {
				u16::from_be_bytes(pair)
			}
		})
		.collect::<Vec<_>>();

	String::from_utf16(&code_units).ok()
}

fn decode_text(bytes: Vec<u8>) -> Option<String> {
	let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
		String::from_utf8(bytes[3..].to_vec()).ok()?
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
		String::from_utf8(bytes).ok()?
	};

	if content.contains('\0') {
		return None;
	}

	Some(content)
}

fn add_git_context_bytes(
	total_bytes: &mut usize,
	amount: usize,
) -> Result<(), String> {
	*total_bytes = total_bytes
		.checked_add(amount)
		.ok_or_else(|| "The commit context size is invalid.".to_string())?;
	if *total_bytes > MAX_GIT_CONTEXT_TOTAL_BYTES {
		return Err(format!(
			"The commit context exceeds the aggregate {} MiB limit.",
			MAX_GIT_CONTEXT_TOTAL_BYTES / (1024 * 1024),
		));
	}
	Ok(())
}

fn read_untracked_files(
	root: &Path,
	paths_output: &[u8],
	total_context_bytes: &mut usize,
) -> Result<Vec<GitCommitUntrackedFile>, String> {
	let mut files = Vec::new();

	for path_bytes in paths_output.split(|byte| *byte == 0) {
		if path_bytes.is_empty() {
			continue;
		}
		if files.len() >= MAX_GIT_CONTEXT_FILES {
			return Err(format!(
				"The commit context exceeds the limit of {MAX_GIT_CONTEXT_FILES} untracked files.",
			));
		}

		let relative_path = String::from_utf8_lossy(path_bytes).to_string();
		add_git_context_bytes(total_context_bytes, relative_path.len())?;
		let candidate = root.join(&relative_path);
		let metadata = match fs::symlink_metadata(&candidate) {
			Ok(metadata) => metadata,
			Err(_) => continue,
		};

		if !metadata.is_file() || safe_fs::metadata_is_link_or_reparse(&metadata) {
			files.push(GitCommitUntrackedFile {
				relative_path,
				content: None,
				size_bytes: metadata.len(),
			});
			continue;
		}

		let canonical_candidate = match fs::canonicalize(&candidate) {
			Ok(path) if path.starts_with(root) => path,
			_ => continue,
		};
		let size_bytes = metadata.len();
		let content = if size_bytes <= MAX_UNTRACKED_TEXT_BYTES {
			fs::read(canonical_candidate)
				.ok()
				.and_then(decode_text)
				.map(|content| crate::context_redaction::redact_file_content(
					&relative_path,
					content,
				))
		} else {
			None
		};
		if let Some(content) = content.as_ref() {
			add_git_context_bytes(total_context_bytes, content.len())?;
		}

		files.push(GitCommitUntrackedFile {
			relative_path,
			content,
			size_bytes,
		});
	}

	Ok(files)
}

fn repository_name(root: &Path) -> String {
	root.file_name()
		.and_then(|name| name.to_str())
		.filter(|name| !name.is_empty())
		.unwrap_or("repository")
		.to_string()
}

