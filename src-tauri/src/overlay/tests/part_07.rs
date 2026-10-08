	#[test]
	fn standalone_delete_manifest_is_applied_as_delete_only_item() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let manifest_path = test_directory.path.join(DELETE_MANIFEST_FILE_NAME);

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/obsolete.ts"),
			"obsolete",
		);
		write_test_file(
			&manifest_path,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/obsolete.ts\"]}",
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
		)
		.expect("standalone delete manifest should be prepared");

		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 1);
		assert_eq!(prepared.recommended_candidate_index, Some(0));

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("standalone delete manifest should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/obsolete.ts").exists());

		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_manifest_rejects_missing_project_file() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("invalid-delete.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_zip(
			&archive_path,
			&[(
				DELETE_MANIFEST_FILE_NAME,
				"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/missing.ts\"]}",
			)],
		);

		let error = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.err()
		.expect("missing deletion target should be rejected");

		assert!(error.contains("does not exist in the project"));
	}

	#[test]
	fn files_overlay_refuses_to_write_paths_ignored_by_orqeto_devignore() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("patch");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join(".orqeto-devignore"),
			"ignored/\n",
		);
		write_test_file(
			&source_root.join("ignored/secret.ts"),
			"new content",
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("ignored source should be inspected without creating a destination");

		assert!(prepared.root_candidate.is_none());
		assert!(prepared.candidates.is_empty());

		let error = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.err()
		.expect("ignored destination should be rejected during final planning");

		assert!(error.contains(".orqeto-devignore"));
		assert!(!project_root.join("ignored/secret.ts").exists());
	}

	#[test]
	fn delete_manifest_refuses_paths_ignored_by_orqeto_devignore() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join(".orqeto-devignore"),
			"private/\n",
		);
		write_test_file(
			&project_root.join("private/secret.ts"),
			"keep me",
		);

		let canonical_project_root = fs::canonicalize(&project_root)
			.expect("project root should be canonicalized");
		let error = parse_delete_manifest_content(
			&canonical_project_root,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"private/secret.ts\"]}",
		)
		.err()
		.expect("ignored deletion target should be rejected");

		assert!(error.contains(".orqeto-devignore"));
		assert!(project_root.join("private/secret.ts").is_file());
	}

	#[test]
	fn delete_manifest_rejects_invalid_format_and_traversal() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");

		fs::create_dir_all(&project_root).expect("project root should be created");

		let invalid_format = parse_delete_manifest_content(
			&project_root,
			"{\"format\":\"other\",\"version\":1,\"delete\":[]}",
		)
		.err()
		.expect("wrong manifest format should be rejected");
		assert!(invalid_format.contains("format identifier"));

		let traversal = parse_delete_manifest_content(
			&project_root,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"../outside.ts\"]}",
		)
		.err()
		.expect("path traversal should be rejected");
		assert!(traversal.contains("outside the expected format"));
	}

	#[test]
	fn delete_manifest_rejects_apply_delete_conflict() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("conflict.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/same.ts"),
			"old",
		);
		write_test_zip(
			&archive_path,
			&[
				(
					DELETE_MANIFEST_FILE_NAME,
					"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/same.ts\"]}",
				),
				("src/same.ts", "new"),
			],
		);

		let error = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.err()
		.expect("same file cannot be applied and deleted");

		assert!(error.contains("apply and delete the same file"));
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("project file should be untouched"),
			"old",
		);
	}

	#[test]
	fn br_file_006_delete_manifest_folder_is_recursive_and_undo_restores_tree() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let manifest_path = test_directory.path.join(DELETE_MANIFEST_FILE_NAME);
		write_test_file(&project_root.join("src/legacy/nested/file.ts"), "before");
		fs::create_dir_all(project_root.join("src/legacy/empty"))
			.expect("empty folder should be created");
		write_test_file(
			&manifest_path,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/legacy\"]}",
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
		)
		.expect("folder deletion should be prepared");
		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 4);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("folder deletion should apply");
		assert_eq!(result.deleted_files, 1);
		assert_eq!(result.deleted_directories, 3);
		assert!(!project_root.join("src/legacy").exists());

		let execution = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("Undo should restore deleted folder tree");
		assert_eq!(execution.restored_files, 1);
		assert_eq!(fs::read_to_string(project_root.join("src/legacy/nested/file.ts")).unwrap(), "before");
		assert!(project_root.join("src/legacy/empty").is_dir());
		discard_snapshot(execution.recovery);
		discard_snapshot(snapshot);
	}

	#[test]
	fn br_scan_001_unreadable_routing_branch_fails_closed() {
		let test_directory = TestDirectory::new();
		let missing = test_directory.path.join("missing-routing-branch");
		let error = read_routing_directory(&missing)
			.err()
			.expect("an unreadable routing branch must fail closed");

		assert!(error.to_ascii_lowercase().contains("routing was rejected"));
		assert!(error.contains("could not be completed"));
	}

	#[test]
	fn br_scan_002_directory_source_traversal_is_iterative_for_deep_trees() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("incoming");
		fs::create_dir_all(&project_root).expect("project root should be created");
		fs::create_dir_all(&source_root).expect("source root should be created");

		let mut current = source_root.clone();
		for _ in 0..64 {
			current.push("d");
			fs::create_dir(&current).expect("deep source directory should be created");
		}
		write_test_file(
			&current.join("deep.ts"),
			"deep",
		);

		let manifest = build_directory_manifest(
			&fs::canonicalize(&project_root).expect("project root should canonicalize"),
			&source_root,
		)
		.expect("deep source should be traversed iteratively");
		assert_eq!(manifest.files.len(), 1);
		assert!(manifest.files[0].relative_path.ends_with("deep.ts"));
	}

