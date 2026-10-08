fn current_branch(root: &Path) -> Result<String, String> {
	let symbolic = execute_git(
		root,
		&[
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		],
	)?;

	if symbolic.status.success() {
		let branch = output_text(&symbolic.stdout);

		if !branch.is_empty() {
			return Ok(branch);
		}
	}

	let detached = execute_git(
		root,
		&[
			"rev-parse",
			"--short",
			"HEAD",
		],
	)?;

	if detached.status.success() {
		let commit = output_text(&detached.stdout);

		if !commit.is_empty() {
			return Ok(format!("detached@{commit}"));
		}
	}

	Ok("HEAD".to_string())
}

fn generate_git_commit_context_blocking(
	root_folder: String,
) -> Result<GitCommitContextData, String> {
	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	if !is_git_repository_blocking(&root_folder)? {
		return Err("The selected folder does not belong to a Git repository.".to_string());
	}

	let status = run_git(
		&root,
		&[
			"status",
			"--short",
			"--untracked-files=all",
			"--",
			".",
		],
	)?;
	if status.lines().count() > MAX_GIT_CONTEXT_FILES {
		return Err(format!(
			"The commit context exceeds the limit of {MAX_GIT_CONTEXT_FILES} changed files.",
		));
	}
	let staged_diff = run_git(
		&root,
		&[
			"diff",
			"--cached",
			"--relative",
			"--no-ext-diff",
			"--no-textconv",
			"--find-renames",
			"--find-copies",
			"--submodule=short",
			"--",
			".",
		],
	)?;
	let staged_diff = crate::context_redaction::redact_git_diff(staged_diff);
	let unstaged_diff = run_git(
		&root,
		&[
			"diff",
			"--relative",
			"--no-ext-diff",
			"--no-textconv",
			"--find-renames",
			"--find-copies",
			"--submodule=short",
			"--",
			".",
		],
	)?;
	let unstaged_diff = crate::context_redaction::redact_git_diff(unstaged_diff);
	let untracked_output = execute_git(
		&root,
		&[
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			".",
		],
	)?;

	if !untracked_output.status.success() {
		let error = output_text(&untracked_output.stderr);
		return Err(if error.is_empty() {
			"Could not list untracked Git files.".to_string()
		} else {
			error
		});
	}

	let branch = current_branch(&root)?;
	let repository_name = repository_name(&root);
	let mut total_context_bytes = 0_usize;
	for value in [
		&repository_name,
		&branch,
		&status,
		&staged_diff,
		&unstaged_diff,
	] {
		add_git_context_bytes(&mut total_context_bytes, value.len())?;
	}
	let untracked_files = read_untracked_files(
		&root,
		&untracked_output.stdout,
		&mut total_context_bytes,
	)?;

	Ok(GitCommitContextData {
		repository_name,
		branch,
		status,
		staged_diff,
		unstaged_diff,
		untracked_files,
	})
}

fn validate_patch_extension(path: &Path) -> Result<(), String> {
	let supported = path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| {
			extension.eq_ignore_ascii_case("patch") ||
				extension.eq_ignore_ascii_case("diff")
		});

	if supported {
		Ok(())
	} else {
		Err("In Git Mode, only .patch and .diff files can be applied.".to_string())
	}
}

fn validate_text_patch(content: &str) -> Result<(), String> {
	if content.trim().is_empty() {
		return Err("The patch file is empty.".to_string());
	}

	for line in content.lines() {
		if line == "GIT binary patch" || line.starts_with("Binary files ") {
			return Err("Binary patches are not accepted in Git Mode.".to_string());
		}

		if line.starts_with("old mode ") || line.starts_with("new mode ") {
			return Err("File permission/mode changes are not accepted in Git Mode.".to_string());
		}

		if line.starts_with("copy from ") || line.starts_with("copy to ") {
			return Err("Git copy operations are not accepted in Git Mode. Create the new file directly in the patch.".to_string());
		}

		if let Some(mode) = line.strip_prefix("new file mode ") {
			if mode != "100644" {
				return Err("New files with special permission/mode are not accepted in Git Mode.".to_string());
			}
		}

		if [
			"deleted file mode 120000",
			"new file mode 160000",
			"deleted file mode 160000",
		]
		.iter()
		.any(|prefix| line.starts_with(prefix)) ||
			(line.starts_with("index ") &&
				(line.ends_with(" 120000") || line.ends_with(" 160000")))
		{
			return Err("Symlink or submodule patches are not accepted in Git Mode.".to_string());
		}
	}

	Ok(())
}


struct PatchMetadata {
	rename_sources: HashMap<String, String>,
	deleted_paths: HashSet<String>,
}

fn path_key(path: &str) -> String {
	#[cfg(target_os = "windows")]
	{
		path.to_lowercase()
	}

	#[cfg(not(target_os = "windows"))]
	{
		path.to_string()
	}
}

fn normalize_declared_patch_path(
	value: &str,
	strip_git_prefix: bool,
) -> Result<String, String> {
	let path_value = value
		.split_once('\t')
		.map(|(path, _)| path)
		.unwrap_or(value);

	if path_value.is_empty() || path_value.starts_with('"') || path_value.contains('\\') {
		return Err("The patch uses a path format that is not accepted by safe Git Mode.".to_string());
	}

	let normalized = if strip_git_prefix && (path_value.starts_with("a/") || path_value.starts_with("b/")) {
		&path_value[2..]
	} else {
		path_value
	};
	let path = Path::new(normalized);

	if path.as_os_str().is_empty() {
		return Err("The patch contains an empty file path.".to_string());
	}

	for component in path.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("The patch contains an unsafe path: {normalized}."));
		}
	}

	Ok(path.to_string_lossy().replace('\\', "/"))
}

