	#[test]
	fn br_undo_003_concurrent_edit_before_restore_commit_is_preserved() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("state.ts");
		let backup = test_directory.path.join("backup.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "applied");
		write_test_file(&backup, "before");
		let expected_destination = file_fingerprint(&destination)
			.expect("applied state should be fingerprinted");

		let result = safe_fs::atomic_copy_checked(
			&backup,
			&destination,
			|| {
				write_test_file(&destination, "user-edit");
				revalidate_destination_before_commit(
					&project_root,
					Path::new("state.ts"),
					Some(expected_destination),
				)
			},
		);

		assert!(result.is_err());
		assert_eq!(
			fs::read_to_string(&destination).expect("external edit should remain readable"),
			"user-edit",
		);
	}

	#[test]
	fn br_recovery_003_apply_failure_after_first_mutation_restores_pre_apply_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("a.ts"), "a-before");
		write_test_file(&project_root.join("b.ts"), "b-before");
		write_test_zip(&archive_path, &[("a.ts", "a-after"), ("b.ts", "b-after")]);

		let error = {
			let _failure = fail_after_successful_mutations(0);
			apply_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				vec![archive_path.to_string_lossy().into_owned()],
				"./".to_string(),
				String::new(),
			)
			.err()
			.expect("injected failure should abort Apply")
		};
		assert!(error.contains("Injected test failure"));
		assert_eq!(fs::read_to_string(project_root.join("a.ts")).unwrap(), "a-before");
		assert_eq!(fs::read_to_string(project_root.join("b.ts")).unwrap(), "b-before");
	}

	#[test]
	fn br_recovery_004_undo_failure_rolls_back_then_allows_exact_retry() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("a.ts"), "a-before");
		write_test_file(&project_root.join("b.ts"), "b-before");
		write_test_zip(&archive_path, &[("a.ts", "a-after"), ("b.ts", "b-after")]);
		let (_, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("overlay should apply");

		let error = {
			let _failure = fail_after_successful_mutations(0);
			undo_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				&snapshot,
			)
			.err()
			.expect("injected Undo failure should be rolled back")
		};
		assert!(error.contains("Injected test failure"));
		assert_eq!(fs::read_to_string(project_root.join("a.ts")).unwrap(), "a-after");
		assert_eq!(fs::read_to_string(project_root.join("b.ts")).unwrap(), "b-after");

		let retry = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("Undo should remain recoverable after injected failure");
		assert_eq!(fs::read_to_string(project_root.join("a.ts")).unwrap(), "a-before");
		assert_eq!(fs::read_to_string(project_root.join("b.ts")).unwrap(), "b-before");
		discard_snapshot(retry.recovery);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_recovery_006_exact_after_state_recovers_when_applied_flag_was_not_persisted() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let destination = project_root.join("state.ts");
		let expected_after_source = test_directory.path.join("expected-after.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "before");
		write_test_file(&expected_after_source, "after");

		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root)
			.expect("recovery snapshot directory should be created");
		let backup = storage::store_stable_backup(
			&destination,
			&backup_directory,
		)
		.expect("pre-apply state should be preserved");
		let expected_after = file_fingerprint(&expected_after_source)
			.expect("expected after-state should be fingerprinted");
		let snapshot = UndoSnapshot {
			root: canonical_root,
			operation_id: next_operation_id("test"),
			backup_directories: vec![backup_directory.clone()],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("state.ts"),
				kind: UndoFileKind::Replaced {
					backup_path: backup.path,
					backup_blob_id: Some(backup.blob_id),
				},
				applied_fingerprint: Some(expected_after),
				recovery_applied: false,
				recovery_allowed_states: Vec::new(),
			}],
			created_directories: Vec::new(),
			deleted_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: Some("recovery-unconfirmed-commit-test".to_string()),
			source_fingerprints: Vec::new(),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};
		write_recovery_journal(&snapshot).expect("pending journal should be durable before mutation");

		// Simulate a process crash after the atomic destination commit but before
		// mark_recovery_file_applied could persist `applied = true` in the journal.
		write_test_file(&destination, "after");
		restore_recovery_directory(&backup_directory)
			.expect("exact known Orqeto after-state should be recoverable");
		assert_eq!(
			fs::read_to_string(&destination).expect("pre-apply bytes should be restored"),
			"before",
		);

		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_only_zip_is_valid() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("delete-only.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/obsolete.ts"),
			"obsolete",
		);
		write_test_zip(
			&archive_path,
			&[(
				DELETE_MANIFEST_FILE_NAME,
				"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/obsolete.ts\"]}",
			)],
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("delete-only overlay should be prepared");

		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 1);
		assert_eq!(prepared.recommended_candidate_index, Some(0));

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("delete-only overlay should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/obsolete.ts").exists());

		discard_snapshot(snapshot);
	}

