	#[test]
	fn rollback_preserves_unconfirmed_created_file_even_when_content_matches() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("created.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "same-content");
		let fingerprint = file_fingerprint(&destination).expect("fingerprint should be available");
		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root).expect("backup directory should be created");
		let snapshot = UndoSnapshot {
			root: fs::canonicalize(&project_root).expect("project root should canonicalize"),
			operation_id: next_operation_id("test"),
			backup_directories: vec![backup_directory],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("created.ts"),
				kind: UndoFileKind::Created,
				applied_fingerprint: Some(fingerprint),
				recovery_applied: false,
				recovery_allowed_states: vec![Some(fingerprint)],
			}],
			created_directories: Vec::new(),
			deleted_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: None,
			source_fingerprints: Vec::new(),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};

		assert!(rollback_snapshot(&snapshot).is_err());
		assert_eq!(
			fs::read_to_string(&destination).expect("external file should be preserved"),
			"same-content",
		);
		discard_snapshot(snapshot);
	}

	#[test]
	fn rollback_accepts_known_intermediate_undo_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "second");
		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root).expect("backup directory should be created");
		let backup = backup_directory.join("replaced/state.ts");
		write_test_file(&backup, "second");
		let first_fingerprint = {
			write_test_file(&destination, "first");
			file_fingerprint(&destination).expect("intermediate fingerprint should be available")
		};
		let original_fingerprint = {
			let original = test_directory.path.join("original.ts");
			write_test_file(&original, "original");
			file_fingerprint(&original).expect("final fingerprint should be available")
		};
		let snapshot = UndoSnapshot {
			root: fs::canonicalize(&project_root).expect("project root should canonicalize"),
			operation_id: next_operation_id("test"),
			backup_directories: vec![backup_directory],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("state.ts"),
				kind: UndoFileKind::Replaced {
					backup_path: backup,
					backup_blob_id: None,
				},
				applied_fingerprint: Some(original_fingerprint),
				recovery_applied: true,
				recovery_allowed_states: vec![Some(first_fingerprint), Some(original_fingerprint)],
			}],
			created_directories: Vec::new(),
			deleted_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: Some("undo-recovery-test".to_string()),
			source_fingerprints: Vec::new(),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};

		rollback_snapshot(&snapshot).expect("known intermediate state should be rolled back");
		assert_eq!(
			fs::read_to_string(&destination).expect("pre-undo state should be restored"),
			"second",
		);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_undo_001_created_modified_deleted_restore_exact_prior_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/old.ts"),
			"old",
		);
		write_test_file(
			&project_root.join("src/existing.ts"),
			"existing-before",
		);
		write_test_zip(
			&archive_path,
			&[
				(
					DELETE_MANIFEST_FILE_NAME,
					"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/old.ts\"]}",
				),
				("src/new.ts", "new"),
				("src/existing.ts", "existing-after"),
			],
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("zip overlay should be prepared");

		assert_eq!(prepared.file_count, 2);
		assert_eq!(prepared.delete_count, 1);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("zip overlay should be applied");

		assert_eq!(result.added_files, 1);
		assert_eq!(result.replaced_files, 1);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/old.ts").exists());
		assert_eq!(
			fs::read_to_string(project_root.join("src/new.ts"))
				.expect("new file should exist"),
			"new",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("src/existing.ts"))
				.expect("modified file should exist"),
			"existing-after",
		);
		assert!(!project_root.join(DELETE_MANIFEST_FILE_NAME).exists());

		let undo = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("overlay should be undoable");

		assert_eq!(undo.restored_files, 2);
		assert_eq!(undo.removed_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("src/old.ts"))
				.expect("deleted file should be restored"),
			"old",
		);
		assert!(!project_root.join("src/new.ts").exists());
		assert_eq!(
			fs::read_to_string(project_root.join("src/existing.ts"))
				.expect("modified file should be restored"),
			"existing-before",
		);
		discard_snapshot(undo.recovery);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_undo_002_user_edit_blocks_undo_without_overwrite() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("patch/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("state.ts"), "before");
		write_test_file(&source, "applied");

		let (_, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("overlay should apply");
		write_test_file(&project_root.join("state.ts"), "user-edit");

		let error = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.err()
		.expect("user edit must block undo");
		assert!(error.contains("It is not safe to undo"));
		assert!(error.contains("state.ts"));
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts")).expect("user edit should remain"),
			"user-edit",
		);
		discard_snapshot(snapshot);
	}

