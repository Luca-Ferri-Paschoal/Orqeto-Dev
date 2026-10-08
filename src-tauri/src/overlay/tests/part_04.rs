	#[test]
	fn br_storage_003_merged_files_undo_drops_unneeded_intermediate_backup_blob() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let first_patch = test_directory.path.join("first/state.ts");
		let second_patch = test_directory.path.join("second/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		let fixture_identity = test_directory.path.to_string_lossy();
		let original_content = format!("original-{fixture_identity}");
		let first_content = format!("first-{fixture_identity}");
		let second_content = format!("second-{fixture_identity}");
		write_test_file(&project_root.join("state.ts"), &original_content);
		write_test_file(&first_patch, &first_content);
		write_test_file(&second_patch, &second_content);

		let (_, first_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![first_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("first overlay should be applied");
		let (_, second_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![second_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("second overlay should be applied");

		let first_blob_id = match &first_snapshot.files[0].kind {
			UndoFileKind::Replaced { backup_blob_id: Some(blob_id), .. } => blob_id.clone(),
			_ => panic!("first replacement should use a content-addressed backup"),
		};
		let second_blob_id = match &second_snapshot.files[0].kind {
			UndoFileKind::Replaced { backup_blob_id: Some(blob_id), .. } => blob_id.clone(),
			_ => panic!("second replacement should use a content-addressed backup"),
		};
		assert_ne!(first_blob_id, second_blob_id);
		clear_recovery_journal(&first_snapshot).expect("first snapshot should commit");
		clear_recovery_journal(&second_snapshot).expect("second snapshot should commit");

		let mut merged = merge_undo_snapshots(first_snapshot, second_snapshot);
		compact_committed_snapshot_storage(&mut merged);
		assert_eq!(merged.backup_directories.len(), 2);
		let merged_blob_references = merged
			.backup_directories
			.iter()
			.map(|directory| storage::snapshot_blob_references(directory))
			.collect::<Result<Vec<_>, _>>()
			.expect("merged snapshot references should remain readable");
		assert!(merged_blob_references.iter().any(|references| references.contains(&first_blob_id)));
		assert!(merged_blob_references.iter().all(|references| !references.contains(&second_blob_id)));
		assert!(storage::blob_path(&first_blob_id).is_ok());

		let execution = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&merged,
		)
		.expect("merged Undo should still restore the original state");
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts")).expect("state should be restored"),
			original_content,
		);
		discard_snapshot(execution.recovery);
		discard_snapshot(merged);
	}

	#[test]
	fn br_history_007_persistent_application_history_round_trips_active_undo_metadata() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("patch/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&project_root.join("state.ts"), "before");
		write_test_file(&source, "after");

		let (_, mut snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("overlay should apply before history persistence is tested");
		snapshot.source_label = Some("persistent-history.zip".to_string());
		snapshot.source_fingerprints = vec!["source-fingerprint".to_string()];
		let history_directory = snapshot
			.backup_directories
			.first()
			.expect("a replacement should retain a managed Undo directory")
			.clone();

		commit_application_snapshot(&snapshot)
			.expect("completed application history should become durable");
		assert_eq!(
			storage::storage_class(&history_directory)
				.expect("history storage class should remain readable"),
			storage::StorageClass::ActiveUndo,
		);
		let loaded = load_persisted_undo_snapshot(&history_directory)
			.expect("persistent history metadata should be readable")
			.expect("persistent history metadata should exist");

		assert_eq!(loaded.operation_id, snapshot.operation_id);
		assert_eq!(loaded.root, snapshot.root);
		assert_eq!(loaded.files.len(), 1);
		assert_eq!(loaded.source_label.as_deref(), Some("persistent-history.zip"));
		assert_eq!(loaded.source_fingerprints, vec!["source-fingerprint".to_string()]);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_history_007_history_persistence_failure_keeps_recovery_uncommitted() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("patch/state.ts");
		let destination = project_root.join("state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&destination, "before");
		write_test_file(&source, "after");

		let (_, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("overlay should apply before history persistence is tested");
		let history_directory = snapshot
			.backup_directories
			.first()
			.expect("a replacement should retain a managed Undo directory")
			.clone();

		let error = {
			let _failure = fail_next_persistence(PersistenceFailurePoint::History);
			commit_application_snapshot(&snapshot)
				.err()
				.expect("history persistence failure should abort the commit")
		};
		assert!(error.contains("application history"));
		let journal = read_recovery_journal(&history_directory)
			.expect("the original recovery journal should remain readable");
		assert!(!journal.committed);
		assert!(!persisted_undo_history_path(&history_directory).exists());

		let _ = rollback_operation(&snapshot, error);
		assert_eq!(
			fs::read_to_string(&destination).expect("the rolled-back destination should remain readable"),
			"before",
		);
		assert!(!history_directory.exists());
	}

	#[test]
	fn br_recovery_002_multi_undo_restores_sequential_replacements_to_original_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let first_patch = test_directory.path.join("first/state.ts");
		let second_patch = test_directory.path.join("second/state.ts");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("state.ts"),
			"original",
		);
		write_test_file(
			&first_patch,
			"first",
		);
		write_test_file(
			&second_patch,
			"second",
		);

		let (_, first_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![first_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("first overlay should be applied");
		let (_, second_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![second_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("second overlay should be applied");
		let snapshots = vec![first_snapshot, second_snapshot];

		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("latest file should exist"),
			"second",
		);

		let execution = undo_project_overlays_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshots,
		)
		.expect("multi undo should complete atomically");

		assert_eq!(execution.restored_files, 2);
		assert_eq!(execution.removed_files, 0);
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("original file should be restored"),
			"original",
		);
		discard_snapshot(execution.recovery);

		for snapshot in snapshots {
			discard_snapshot(snapshot);
		}
	}

