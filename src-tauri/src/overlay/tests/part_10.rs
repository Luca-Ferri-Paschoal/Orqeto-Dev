	#[test]
	fn br_adv_003_fault_injection_boundaries_fail_closed() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		let destination = project_root.join("state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "before");
		write_test_file(&source, "after");

		{
			let _failure = fail_next_persistence(PersistenceFailurePoint::Snapshot);
			let error = apply_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				vec![source.to_string_lossy().into_owned()],
				"./".to_string(),
				String::new(),
			)
			.err()
			.expect("snapshot persistence failure should abort Apply");
			assert!(error.contains("safety snapshot"));
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		{
			let _failure = fail_next_persistence(PersistenceFailurePoint::Journal);
			let error = apply_project_overlay_blocking(
				project_root.to_string_lossy().into_owned(),
				vec![source.to_string_lossy().into_owned()],
				"./".to_string(),
				String::new(),
			)
			.err()
			.expect("journal persistence failure should abort Apply");
			assert!(error.contains("recovery journal"));
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		{
			let mut reader = FailingReader { first_chunk: true };
			let error = safe_fs::atomic_write_from_reader(
				&destination,
				&mut reader,
			)
			.err()
			.expect("temporary write failure should abort atomic replacement");
			assert_eq!(error.kind(), std::io::ErrorKind::Other);
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		{
			let mut reader = &b"commit-new-content"[..];
			let error = safe_fs::atomic_write_from_reader_checked(
				&destination,
				&mut reader,
				|| Err(std::io::Error::other("injected commit failure")),
			)
			.err()
			.expect("commit failure should abort atomic replacement");
			assert_eq!(error.kind(), std::io::ErrorKind::Other);
			assert_eq!(fs::read_to_string(&destination).unwrap(), "before");
		}

		let canonical_root = fs::canonicalize(&project_root).expect("root should canonicalize");
		let backup_directory = create_backup_directory(&canonical_root)
			.expect("recovery snapshot should be created");
		let backup = storage::store_stable_backup(
			&destination,
			&backup_directory,
		)
		.expect("pre-operation state should be backed up");
		let expected_after_source = test_directory.path.join("expected-after.ts");
		write_test_file(&expected_after_source, "known-after");
		let expected_after = file_fingerprint(&expected_after_source)
			.expect("known after-state should be fingerprinted");
		let snapshot = UndoSnapshot {
			root: canonical_root,
			operation_id: next_operation_id("adversarial-recovery"),
			backup_directories: vec![backup_directory.clone()],
			files: vec![UndoFile {
				destination_relative_path: PathBuf::from("state.ts"),
				kind: UndoFileKind::Replaced {
					backup_path: backup.path,
					backup_blob_id: Some(backup.blob_id),
				},
				applied_fingerprint: Some(expected_after),
				recovery_applied: true,
				recovery_allowed_states: vec![Some(expected_after)],
			}],
			created_directories: Vec::new(),
			deleted_directories: Vec::new(),
			applied_at_unix_ms: current_unix_ms(),
			source_kind: UndoSourceKind::Files,
			source_label: Some("adversarial-unknown-state".to_string()),
			source_fingerprints: Vec::new(),
			added_lines: None,
			deleted_lines: None,
			recovery_after_state_known: true,
		};
		write_recovery_journal(&snapshot).expect("recovery journal should be durable");
		write_test_file(&destination, "external-unknown-state");
		let recovery_error = restore_recovery_directory(&backup_directory)
			.err()
			.expect("unknown recovery state must fail closed");
		assert!(!recovery_error.is_empty());
		assert_eq!(fs::read_to_string(&destination).unwrap(), "external-unknown-state");
		assert!(backup_directory.is_dir());
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_adv_004_zip_and_delete_manifest_path_corpus() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("src/unicode/Δ.ts"), "unicode");
		let canonical_project_root = fs::canonicalize(&project_root)
			.expect("project root should be canonicalized");

		assert_eq!(
			normalize_zip_entry_path(Path::new("src/unicode/Δ.ts"))
				.expect("safe Unicode ZIP path should be accepted"),
			PathBuf::from("src/unicode/Δ.ts"),
		);
		for unsafe_path in ["../escape.ts", "a/../../escape.ts", "/absolute.ts"] {
			assert!(
				normalize_zip_entry_path(Path::new(unsafe_path)).is_err(),
				"unsafe ZIP path {unsafe_path} should be rejected",
			);
		}

		for unsafe_delete in [
			"../outside.ts",
			"./src/unicode/Δ.ts",
			"/absolute.ts",
			"src\\unicode\\Δ.ts",
			"src//unicode/Δ.ts",
		] {
			let content = format!(
				"{{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[{}]}}",
				serde_json::to_string(unsafe_delete).unwrap(),
			);
			assert!(
				parse_delete_manifest_content(&canonical_project_root, &content).is_err(),
				"unsafe delete path {unsafe_delete} should be rejected",
			);
		}

		let safe_delete = "{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/unicode/Δ.ts\"]}";
		let parsed = parse_delete_manifest_content(&canonical_project_root, safe_delete)
			.expect("safe Unicode delete path should be accepted");
		assert_eq!(parsed.files, vec![PathBuf::from("src/unicode/Δ.ts")]);
		assert!(parsed.directories.is_empty());

		assert!(safe_fs::validate_project_relative_path(
			&canonical_project_root,
			Path::new("src/unicode/Δ.ts"),
		).is_ok());
		for unsafe_relative in ["../escape.ts", "/absolute.ts"] {
			assert!(safe_fs::validate_project_relative_path(
				&canonical_project_root,
				Path::new(unsafe_relative),
			).is_err());
		}

		#[cfg(target_os = "windows")]
		for unsafe_windows in [
			"CON",
			"nul.txt",
			"COM1.log",
			"file.txt:stream",
			"trailing.",
			"trailing ",
		] {
			assert!(safe_fs::validate_project_relative_path(
				&canonical_project_root,
				Path::new(unsafe_windows),
			).is_err());
		}
	}

	#[test]
	fn folder_only_delete_keeps_recovery_and_undo_for_an_empty_tree() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let manifest_path = test_directory.path.join(DELETE_MANIFEST_FILE_NAME);
		fs::create_dir_all(project_root.join("empty-tree/nested"))
			.expect("empty folder tree should be created");
		write_test_file(
			&manifest_path,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"empty-tree\"]}",
		);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("empty folder deletion should apply");
		assert_eq!(result.deleted_files, 0);
		assert_eq!(result.deleted_directories, 2);
		assert!(snapshot.files.is_empty());
		assert!(snapshot_primary_directory(&snapshot).unwrap().join(RECOVERY_FILE_NAME).is_file());
		assert!(!project_root.join("empty-tree").exists());
		assert!(snapshot_matches_current_applied_state(&snapshot).unwrap());
		fs::create_dir(project_root.join("empty-tree")).expect("folder recreation should succeed");
		assert!(!snapshot_matches_current_applied_state(&snapshot).unwrap());
		fs::remove_dir(project_root.join("empty-tree")).expect("recreated folder should be removed");

		let execution = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("Undo should restore an empty deleted folder tree");
		assert!(project_root.join("empty-tree/nested").is_dir());
		discard_snapshot(execution.recovery);
		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_manifest_limit_errors_explain_folder_compaction() {
		let count_error = delete_manifest_path_count_error(MAX_DELETE_MANIFEST_PATHS + 1);
		assert!(count_error.contains("Folder paths are supported"));
		assert!(count_error.contains(&(MAX_DELETE_MANIFEST_PATHS + 1).to_string()));
		let size_error = delete_manifest_size_error(MAX_DELETE_MANIFEST_BYTES + 1);
		assert!(size_error.contains("Folder paths are supported"));
		assert!(size_error.contains(&(MAX_DELETE_MANIFEST_BYTES + 1).to_string()));
	}

	#[test]
	fn delete_manifest_folder_rejects_ignored_descendant() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		write_test_file(&project_root.join("legacy/public.ts"), "public");
		write_test_file(&project_root.join("legacy/private/secret.ts"), "secret");
		write_test_file(&project_root.join(".orqeto-devignore"), "legacy/private/\n");
		let canonical_root = fs::canonicalize(&project_root).expect("project root should canonicalize");

		let error = parse_delete_manifest_content(
			&canonical_root,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"legacy\"]}",
		)
		.err()
		.expect("ignored descendant must protect the folder deletion");
		assert!(error.contains(".orqeto-devignore"));
		assert!(project_root.join("legacy/public.ts").is_file());
		assert!(project_root.join("legacy/private/secret.ts").is_file());
	}

	#[test]
	fn br_adv_002_ignore_change_between_preview_and_apply_is_rejected() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "incoming");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		write_test_file(&project_root.join(".orqeto-devignore"), "state.ts\n");
		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		let error = validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		)
		.err()
		.expect("ignore change should invalidate the routed preview");
		assert!(error.to_ascii_lowercase().contains("project or routing rules changed"));
		assert!(!project_root.join("state.ts").exists());
	}

