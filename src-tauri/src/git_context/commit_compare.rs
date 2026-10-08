const COMMIT_HISTORY_PAGE_SIZE: usize = 100;
const MAX_COMMIT_HISTORY_OFFSET: usize = 1_000_000;
const MAX_COMMIT_COMPARISON_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
	hash: String,
	short_hash: String,
	subject: String,
	author: String,
	authored_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitHistoryPage {
	commits: Vec<GitCommitSummary>,
	has_more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitComparisonData {
	repository_name: String,
	initial: GitCommitSummary,
	final_commit: GitCommitSummary,
	file_count: usize,
	added_lines: usize,
	deleted_lines: usize,
	diff: String,
}

fn valid_commit_hash(hash: &str) -> bool {
	matches!(hash.len(), 40 | 64) && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_git_commit_summaries(output: &str) -> Result<Vec<GitCommitSummary>, String> {
	let mut commits = Vec::new();
	for record in output.split('\u{001e}') {
		let record = record.trim_matches(|character| character == '\r' || character == '\n');
		if record.is_empty() {
			continue;
		}
		let fields = record.split('\0').collect::<Vec<_>>();
		if fields.len() != 5 || !fields[4].is_empty() || !valid_commit_hash(fields[0]) {
			return Err("Git returned an invalid commit history record.".to_string());
		}
		commits.push(GitCommitSummary {
			hash: fields[0].to_string(),
			short_hash: fields[0][..8].to_string(),
			subject: crate::context_redaction::redact_unstructured_text(fields[1].to_string()),
			author: crate::context_redaction::redact_unstructured_text(fields[2].to_string()),
			authored_at: fields[3].to_string(),
		});
	}
	Ok(commits)
}

fn commit_history_blocking(root_folder: String, offset: usize) -> Result<GitCommitHistoryPage, String> {
	if offset > MAX_COMMIT_HISTORY_OFFSET || offset % COMMIT_HISTORY_PAGE_SIZE != 0 {
		return Err("Invalid commit history page.".to_string());
	}
	let root = canonicalize_existing(Path::new(&root_folder))?;
	if !is_git_repository_blocking(&root_folder)? {
		return Err("The selected folder does not belong to a Git repository.".to_string());
	}
	let skip = format!("--skip={offset}");
	let limit = format!("--max-count={}", COMMIT_HISTORY_PAGE_SIZE + 1);
	let output = run_git(&root, &[
		"log", "--all", "--date-order", "--no-notes", &skip, &limit,
		"--format=%H%x00%s%x00%an%x00%aI%x00%x1e",
	])?;
	let mut commits = parse_git_commit_summaries(&output)?;
	let has_more = commits.len() > COMMIT_HISTORY_PAGE_SIZE && offset < MAX_COMMIT_HISTORY_OFFSET;
	commits.truncate(COMMIT_HISTORY_PAGE_SIZE);
	Ok(GitCommitHistoryPage { commits, has_more })
}

fn commit_summary(root: &Path, hash: &str) -> Result<GitCommitSummary, String> {
	if !valid_commit_hash(hash) {
		return Err("Select a valid full Git commit hash.".to_string());
	}
	let output = run_git(root, &[
		"show", "--no-patch", "--no-notes",
		"--format=%H%x00%s%x00%an%x00%aI%x00%x1e", hash,
	])?;
	let mut summaries = parse_git_commit_summaries(&output)?;
	if summaries.len() != 1 || summaries[0].hash != hash {
		return Err("The selected commit is unavailable or is not a commit object.".to_string());
	}
	Ok(summaries.remove(0))
}

fn commit_diff_statistics(output: &str) -> Result<(usize, usize, usize), String> {
	let (mut files, mut added, mut deleted) = (0_usize, 0_usize, 0_usize);
	for line in output.lines() {
		let mut fields = line.splitn(3, '\t');
		let (Some(add), Some(del), Some(_name)) = (fields.next(), fields.next(), fields.next()) else {
			return Err("Git returned invalid comparison statistics.".to_string());
		};
		let parse = |value: &str| -> Result<usize, String> {
			if value == "-" { Ok(0) } else {
				value.parse::<usize>().map_err(|_| "Git returned invalid line counts.".to_string())
			}
		};
		files = files.checked_add(1).ok_or("The comparison has too many files.")?;
		added = added.checked_add(parse(add)?).ok_or("The comparison has too many additions.")?;
		deleted = deleted.checked_add(parse(del)?).ok_or("The comparison has too many deletions.")?;
		if files > MAX_GIT_CONTEXT_FILES {
			return Err("The commit comparison exceeds the changed-file limit.".to_string());
		}
	}
	Ok((files, added, deleted))
}

fn compare_commits_blocking(root_folder: String, from: String, to: String) -> Result<GitCommitComparisonData, String> {
	let root = canonicalize_existing(Path::new(&root_folder))?;
	if !is_git_repository_blocking(&root_folder)? {
		return Err("The selected folder does not belong to a Git repository.".to_string());
	}
	let initial = commit_summary(&root, &from)?;
	let final_commit = commit_summary(&root, &to)?;
	let args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color",
		"--find-renames", "--submodule=short", from.as_str(), to.as_str(), "--", "."];
	let diff = run_git(&root, &args)?;
	if diff.len() > MAX_COMMIT_COMPARISON_BYTES {
		return Err("The comparison exceeds 8 MiB. Select a smaller commit range; no incomplete diff was exported.".to_string());
	}
	let stats = run_git(&root, &[
		"diff", "--numstat", "--no-ext-diff", "--no-textconv", "--no-color",
		"--find-renames", from.as_str(), to.as_str(), "--", ".",
	])?;
	let (file_count, added_lines, deleted_lines) = commit_diff_statistics(&stats)?;
	Ok(GitCommitComparisonData {
		repository_name: repository_name(&root),
		initial, final_commit, file_count, added_lines, deleted_lines,
		diff: crate::context_redaction::redact_git_diff(diff),
	})
}

#[tauri::command]
pub async fn list_git_commits(
	root_folder: String,
	offset: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<GitCommitHistoryPage, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || commit_history_blocking(root_folder, offset))
		.await.map_err(|error| format!("Commit history loading was interrupted: {error}"))?
}

#[tauri::command]
pub async fn compare_git_commits(
	root_folder: String,
	from: String,
	to: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<GitCommitComparisonData, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || compare_commits_blocking(root_folder, from, to))
		.await.map_err(|error| format!("Commit comparison was interrupted: {error}"))?
}
