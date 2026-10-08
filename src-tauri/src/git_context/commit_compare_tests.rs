#[cfg(test)]
mod commit_compare_tests {
	use super::*;

	struct GitFixture(PathBuf);

	impl Drop for GitFixture {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.0);
		}
	}

	fn git(root: &Path, args: &[&str]) -> String {
		let executable = git_candidates().into_iter().next().expect("Git is required for commit comparison tests");
		let output = Command::new(executable)
			.current_dir(root)
			.args(args)
			.output()
			.expect("Git fixture command should start");
		assert!(output.status.success(), "Git fixture: {}", output_text(&output.stderr));
		output_text(&output.stdout)
	}

	fn fixture() -> (GitFixture, String, String) {
		let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
		let root = std::env::temp_dir().join(format!("orqeto-git-compare-{}-{nonce}", std::process::id()));
		fs::create_dir(&root).unwrap();
		let owned = GitFixture(root.clone());
		git(&root, &["init", "-q"]);
		fs::write(root.join("sample.txt"), b"first\n").unwrap();
		git(&root, &["add", "sample.txt"]);
		git(&root, &["-c", "user.name=Alice", "-c", "user.email=alice@example.invalid", "commit", "-q", "-m", "Initial"]);
		let initial = git(&root, &["rev-parse", "HEAD"]);
		fs::write(root.join("sample.txt"), b"first\nsecond\n").unwrap();
		git(&root, &["add", "sample.txt"]);
		git(&root, &["-c", "user.name=Bob", "-c", "user.email=bob@example.invalid", "commit", "-q", "-m", "Add second line"]);
		let final_commit = git(&root, &["rev-parse", "HEAD"]);
		(owned, initial, final_commit)
	}

	#[test]
	fn commit_comparison_parsing_rejects_malformed_inputs() {
		assert!(!valid_commit_hash("HEAD"));
		assert!(!valid_commit_hash("-c"));
		assert!(!valid_commit_hash(&"g".repeat(40)));
		assert!(valid_commit_hash(&"a".repeat(40)));
		assert!(valid_commit_hash(&"a".repeat(64)));
		assert!(parse_git_commit_summaries("invalid\0title\0name\0date\0\u{001e}").is_err());
		assert_eq!(commit_diff_statistics("4\t2\tsrc/main.rs\n-\t-\timage.png").unwrap(), (2, 4, 2));
		assert!(commit_diff_statistics("broken data").is_err());
	}

	#[test]
	fn commit_comparison_lists_and_diffs_without_modifying_worktree() {
		if git_candidates().is_empty() { return; }
		let (fixture, initial, final_commit) = fixture();
		let root = fixture.0.to_string_lossy().to_string();
		let page = commit_history_blocking(root.clone(), 0).unwrap();
		assert_eq!(page.commits.len(), 2);
		assert!(!page.has_more);
		assert_eq!(page.commits[0].hash, final_commit);
		assert_eq!(page.commits[0].author, "Bob");
		assert!(!page.commits[0].authored_at.is_empty());
		let forward = compare_commits_blocking(root.clone(), initial.clone(), final_commit.clone()).unwrap();
		assert_eq!((forward.file_count, forward.added_lines, forward.deleted_lines), (1, 1, 0));
		assert!(forward.diff.contains("+second"));
		assert_eq!(forward.initial.subject, "Initial");
		assert_eq!(forward.final_commit.subject, "Add second line");
		let backward = compare_commits_blocking(root.clone(), final_commit, initial).unwrap();
		assert_eq!((backward.file_count, backward.added_lines, backward.deleted_lines), (1, 0, 1));
		assert!(backward.diff.contains("-second"));
		assert_eq!(fs::read(fixture.0.join("sample.txt")).unwrap(), b"first\nsecond\n");
		git(&fixture.0, &["checkout", "-q", "-b", "alternative", &backward.final_commit.hash]);
		fs::write(fixture.0.join("sample.txt"), b"first\nalternative\n").unwrap();
		git(&fixture.0, &["add", "sample.txt"]);
		git(&fixture.0, &["-c", "user.name=Alice", "-c", "user.email=alice@example.invalid", "commit", "-q", "-m", "Alternative"]);
		let alternative = git(&fixture.0, &["rev-parse", "HEAD"]);
		let across_branches = compare_commits_blocking(root.clone(), forward.final_commit.hash, alternative).unwrap();
		assert_eq!((across_branches.file_count, across_branches.added_lines, across_branches.deleted_lines), (1, 1, 1));
		assert!(across_branches.diff.contains("+alternative"));
		assert!(commit_history_blocking(root.clone(), 1).is_err());
		assert!(compare_commits_blocking(root, "HEAD".to_string(), backward.final_commit.hash).is_err());
	}
}
