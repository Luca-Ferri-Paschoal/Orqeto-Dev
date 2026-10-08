	#[test]
	fn br_file_002_source_change_before_freeze_is_rejected_before_project_mutation() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "previewed");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		write_test_file(&source, "changed-before-apply");

		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("changed source should still freeze");
		let error = match validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		) {
			Ok(_) => panic!("changed source must invalidate preview"),
			Err(error) => error,
		};

		assert!(error.contains("application source changed"));
		assert!(!project_root.join("state.ts").exists());
	}

	#[test]
	fn br_file_003_routing_change_before_apply_is_rejected_before_mutation() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		write_test_file(&project_root.join("src/state.ts"), "old-src");
		write_test_file(&source, "incoming");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let chosen = preview
			.candidates
			.first()
			.or(preview.root_candidate.as_ref())
			.expect("a safe candidate should exist")
			.clone();

		write_test_file(&project_root.join("other/state.ts"), "old-other");

		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		let error = match validate_frozen_overlay_for_apply(
			&frozen,
			&chosen.destination_relative_path,
			&chosen.source_prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		) {
			Ok(_) => panic!("changed routing evidence must invalidate preview"),
			Err(error) => error,
		};

		assert!(error.to_ascii_lowercase().contains("project or routing rules changed"));
		assert_eq!(
			fs::read_to_string(project_root.join("src/state.ts"))
				.expect("existing destination should remain readable"),
			"old-src",
		);
		assert_eq!(
			fs::read_to_string(project_root.join("other/state.ts"))
				.expect("new route evidence should remain readable"),
			"old-other",
		);
	}

	#[test]
	fn br_file_004_unchanged_only_frozen_apply_creates_no_mutation_snapshot() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		write_test_file(&project_root.join("state.ts"), "same");
		write_test_file(&source, "same");

		let preview = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("preview should be prepared");
		let (destination, prefix) = root_choice(&preview);
		let frozen = freeze_overlay_input(
			&project_root.to_string_lossy(),
			&[source.to_string_lossy().into_owned()],
		)
		.expect("source should freeze");
		validate_frozen_overlay_for_apply(
			&frozen,
			&destination,
			&prefix,
			&preview.source_fingerprint,
			&preview.routing_fingerprint,
		)
		.expect("frozen input should remain valid");

		let (result, snapshot) = apply_overlay_manifest_blocking(
			frozen.root.clone(),
			&frozen.manifest,
			destination,
			prefix,
		)
		.expect("unchanged apply should succeed as a no-op");

		assert_eq!(result.unchanged_files, 1);
		assert_eq!(result.added_files + result.replaced_files + result.deleted_files, 0);
		assert!(snapshot.files.is_empty());
		assert!(snapshot.backup_directories.is_empty());
	}

	#[test]
	fn br_stage_001_files_apply_staging_is_fresh_unpredictable_and_non_reparse() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		fs::create_dir_all(&project_root).expect("project root should be created");
		let project_root = fs::canonicalize(project_root).expect("project root should canonicalize");
		let first = create_files_apply_staging_directory(&project_root)
			.expect("first staging directory should be created");
		let second = create_files_apply_staging_directory(&project_root)
			.expect("second staging directory should be created");

		assert_ne!(first, second);
		for path in [&first, &second] {
			let metadata = fs::symlink_metadata(path)
				.expect("staging directory should remain inspectable");
			assert!(metadata.is_dir());
			assert!(!safe_fs::metadata_is_link_or_reparse(&metadata));
		}

		storage::remove_managed_directory(&first).expect("first staging should be removed");
		storage::remove_managed_directory(&second).expect("second staging should be removed");
	}

	#[test]
	fn long_directory_overlay_keeps_every_nested_file() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory
			.path
			.join("patch")
			.join("apis")
			.join("api")
			.join("source");
		let project_destination = project_root
			.join("apps")
			.join("api")
			.join("source");

		fs::create_dir_all(project_destination.join("modules/flow"))
			.expect("project destination should be created");
		write_test_file(
			&source_root.join("main.ts"),
			"main",
		);
		for (name, content) in [
			("factory.ts", "factory"),
			("module.ts", "module"),
			("service.ts", "service"),
			("types.ts", "types"),
		] {
			write_test_file(
				&source_root.join("modules/flow").join(name),
				content,
			);
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("overlay should be prepared");

		assert_eq!(prepared.file_count, 5);
		let recommended_index = prepared
			.recommended_candidate_index
			.expect("long source path should resolve to the existing project branch");
		let candidate = prepared
			.candidates
			.get(recommended_index)
			.expect("recommended candidate should exist")
			.clone();
		assert_eq!(candidate.destination_relative_path, "./apps/api/source");

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
			candidate.destination_relative_path,
			candidate.source_prefix,
		)
		.expect("overlay should be applied");

		assert_eq!(result.added_files, 5);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(
			fs::read_to_string(project_destination.join("main.ts"))
				.expect("main file should exist"),
			"main",
		);
		for (name, content) in [
			("factory.ts", "factory"),
			("module.ts", "module"),
			("service.ts", "service"),
			("types.ts", "types"),
		] {
			assert_eq!(
				fs::read_to_string(project_destination.join("modules/flow").join(name))
					.expect("nested file should exist"),
				content,
			);
		}

		discard_snapshot(snapshot);
	}

