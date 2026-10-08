	#[test]
	fn identical_file_overlay_is_reported_as_unchanged_without_backup() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_file = test_directory.path.join("patch/state.ts");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("state.ts"),
			"same content",
		);
		write_test_file(
			&source_file,
			"same content",
		);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_file.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("identical overlay should be accepted as a no-op");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(result.unchanged_files, 1);
		assert!(snapshot.backup_directories.is_empty());
		assert!(snapshot.files.is_empty());
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("project file should remain available"),
			"same content",
		);

		discard_snapshot(snapshot);
	}

	#[test]
	fn br_file_005_reapplying_same_zip_reports_every_file_unchanged() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("repeat.zip");
		let large_content = "same ZIP bytes across many decompressor reads\n".repeat(4096);

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_zip(
			&archive_path,
			&[
				("src/a.ts", "export const a = 1\n"),
				("src/nested/b.ts", "export const b = 2\n"),
				("src/large.txt", large_content.as_str()),
			],
		);

		let (first, first_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("first ZIP application should succeed");
		assert_eq!(first.added_files, 3);
		assert_eq!(first.replaced_files, 0);
		assert_eq!(first.unchanged_files, 0);

		let (second, second_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("reapplying the same ZIP should succeed as a no-op");

		assert_eq!(second.added_files, 0);
		assert_eq!(second.replaced_files, 0);
		assert_eq!(second.deleted_files, 0);
		assert_eq!(second.unchanged_files, 3);
		assert!(second_snapshot.files.is_empty());
		assert!(second_snapshot.backup_directories.is_empty());

		discard_snapshot(first_snapshot);
		discard_snapshot(second_snapshot);
	}

	#[test]
	fn zip_overlay_skips_identical_files_and_undoes_only_real_changes() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/same.ts"),
			"same",
		);
		write_test_file(
			&project_root.join("src/change.ts"),
			"before",
		);
		write_test_zip(
			&archive_path,
			&[
				("src/same.ts", "same"),
				("src/change.ts", "after"),
			],
		);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("mixed zip overlay should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 1);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(result.unchanged_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("unchanged file should remain available"),
			"same",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("src/change.ts"))
				.expect("changed file should be written"),
			"after",
		);

		let undo = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("mixed zip overlay should be undoable");

		assert_eq!(undo.restored_files, 1);
		assert_eq!(undo.removed_files, 0);
		assert_eq!(
			fs::read_to_string(project_root.join("src/change.ts"))
				.expect("changed file should be restored"),
			"before",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("unchanged file should stay untouched"),
			"same",
		);
		discard_snapshot(undo.recovery);

		discard_snapshot(snapshot);
	}

	#[test]
	fn undo_history_respects_configured_limit_and_merges_one_drop() {
		let test_directory = TestDirectory::new();
		let root = test_directory.path.join("project");
		fs::create_dir_all(&root).expect("project root should be created");
		let mut history = Vec::new();

		for index in 0..=MAX_UNDO_HISTORY_ENTRIES {
			record_undo_snapshot(
				&mut history,
				UndoSnapshot {
					root: root.clone(),
					operation_id: format!("test-history-{index}"),
					backup_directories: Vec::new(),
					files: Vec::new(),
					created_directories: Vec::new(),
					deleted_directories: Vec::new(),
					applied_at_unix_ms: index as u64,
					source_kind: UndoSourceKind::Files,
					source_label: None,
					source_fingerprints: Vec::new(),
					added_lines: None,
					deleted_lines: None,
					recovery_after_state_known: true,
				},
				false,
				10,
			);
		}

		assert_eq!(history.len(), 10);
		assert_eq!(history[0].applied_at_unix_ms, 91);

		record_undo_snapshot(
			&mut history,
			UndoSnapshot {
				root: root.clone(),
				operation_id: "test-history-append".to_string(),
				backup_directories: Vec::new(),
				files: Vec::new(),
				created_directories: Vec::new(),
				deleted_directories: Vec::new(),
				applied_at_unix_ms: 99,
				source_kind: UndoSourceKind::Files,
				source_label: None,
				source_fingerprints: Vec::new(),
				added_lines: None,
				deleted_lines: None,
				recovery_after_state_known: true,
			},
			true,
			10,
		);

		assert_eq!(history.len(), 10);
		let latest = history.last().expect("latest history entry should exist");
		assert_eq!(latest.applied_at_unix_ms, 99);
		assert_eq!(latest.operation_id, "test-history-append");

		for snapshot in history {
			discard_snapshot(snapshot);
		}
	}

