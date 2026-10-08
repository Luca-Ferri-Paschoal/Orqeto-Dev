	#[test]
	fn secret_bearing_files_are_skipped_while_safe_files_apply() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("incoming");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source_root.join("safe.ts"), "export const safe = true\n");
		write_test_file(&source_root.join(".env"), "API_TOKEN=super-secret\n");

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("safe files should still apply");
		assert_eq!(result.added_files, 1);
		assert_eq!(result.protected_secret_files, 1);
		assert!(result.detected_secrets >= 1);
		assert!(project_root.join("safe.ts").is_file());
		assert!(!project_root.join(".env").exists());
		discard_snapshot(snapshot);
	}

	#[test]
	fn existing_secret_file_is_not_overwritten() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("config.json");
		write_test_file(&project_root.join("config.json"), "{\"apiKey\":\"real-secret\"}\n");
		write_test_file(&source, "{\"name\":\"replacement\"}\n");

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("protected replacement should become a safe no-op");
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.protected_secret_files, 1);
		assert!(fs::read_to_string(project_root.join("config.json")).unwrap().contains("real-secret"));
		discard_snapshot(snapshot);
	}

	#[test]
	fn folder_delete_keeps_secret_files_and_removes_safe_siblings() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let manifest = test_directory.path.join(DELETE_MANIFEST_FILE_NAME);
		write_test_file(&project_root.join("legacy/.env"), "TOKEN=keep-me\n");
		write_test_file(&project_root.join("legacy/old.ts"), "obsolete\n");
		write_test_file(
			&manifest,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"legacy\"]}",
		);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("safe siblings should delete without deleting secret files");
		assert_eq!(result.deleted_files, 1);
		assert_eq!(result.protected_secret_files, 1);
		assert!(project_root.join("legacy/.env").is_file());
		assert!(!project_root.join("legacy/old.ts").exists());
		assert!(project_root.join("legacy").is_dir());
		discard_snapshot(snapshot);
	}
