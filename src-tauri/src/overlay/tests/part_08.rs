	#[test]
	fn br_route_001_repeated_basename_discovery_caps_expensive_candidate_validation() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory.path.join("incoming/src");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&source_root.join("main.ts"),
			"export const value = 1\n",
		);

		for index in 0..64 {
			fs::create_dir_all(project_root.join(format!("candidate-{index}/src")))
				.expect("repeated basename candidate should be created");
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("routing analysis should complete without candidate-by-file explosion");

		assert!(prepared.ambiguity_limit_exceeded);
		assert!(prepared.candidate_count > MAX_ROUTING_CANDIDATE_VALIDATIONS);
		assert!(prepared.candidates.is_empty());
		assert_eq!(prepared.recommended_candidate_index, None);
	}

	#[test]
	fn br_route_002_root_relative_zip_requires_strong_exact_file_evidence() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("incoming.zip");
		let foreign_root = test_directory.path.join("foreign-project");
		let matching_root = test_directory.path.join("matching-project");
		let entries = [
			("src/features/context/api.ts", "api"),
			("src/features/context/types.ts", "types"),
			("src/shared/components/Button/index.tsx", "button"),
			("src/shared/components/Button/style.ts", "style"),
			("scripts/check.mts", "check"),
			("src-tauri/src/lib.rs", "lib"),
		];

		write_test_zip(
			&archive_path,
			&entries,
		);

		for (path, _) in entries {
			let destination = foreign_root.join(path);
			fs::create_dir_all(destination.parent().expect("entry should have a parent"))
				.expect("foreign project directories should be created");
		}
		write_test_file(
			&foreign_root.join("src/features/context/types.ts"),
			"foreign",
		);

		let foreign = prepare_project_overlay_blocking(
			foreign_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("weak foreign-project overlap should remain a safe root fallback");
		assert!(foreign.root_candidate.is_some());
		assert!(foreign.candidates.is_empty());
		assert_eq!(foreign.recommended_candidate_index, None);

		for (index, (path, content)) in entries.iter().enumerate() {
			let destination = matching_root.join(path);
			if index < 4 {
				write_test_file(
					&destination,
					content,
				);
			} else {
				fs::create_dir_all(destination.parent().expect("entry should have a parent"))
					.expect("matching project directories should be created");
			}
		}

		let matching = prepare_project_overlay_blocking(
			matching_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("strong exact-path coverage should resolve to the matching root");
		assert_eq!(matching.recommended_candidate_index, Some(0));
		assert_eq!(matching.candidates.len(), 1);
		assert_eq!(matching.candidates[0].destination_relative_path, "./");
		assert_eq!(matching.candidates[0].matched_files, 4);
	}


	#[test]
	fn br_route_002_new_file_heavy_incremental_zip_uses_anchored_exact_root() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("stage08-incremental.zip");
		let project_root = test_directory.path.join("assignment-manager");
		let entries = [
			("src/features/accessControl/pairing/words.en-US.ts", "en"),
			("src/features/accessControl/pairing/vocabulary.ts", "vocab"),
			("src/features/accessControl/pairing/words.pt-BR.ts", "pt"),
			("src/shared/components/Button/index.tsx", "button"),
			("src/shared/components/SearchableSelect/search.ts", "search"),
			("src/shared/components/SearchableSelect/style.ts", "style"),
			("src/shared/components/SearchableSelect/index.tsx", "select"),
			("docs/REALTIME_QUERY_PAIRING_ROADMAP.md", "roadmap"),
			("docs/TESTING.md", "testing"),
			("docs/P2P_DEVICE_LINKING.md", "linking"),
			("tests/app/pairingVocabulary.test.ts", "pairing-test"),
			("tests/app/searchableSelect.component.test.tsx", "component-test"),
			("tests/app/searchableSelect.test.ts", "search-test"),
		];

		write_test_zip(
			&archive_path,
			&entries,
		);

		// Six files already exist at their exact declared paths while seven are new.
		// The parent hierarchy for all thirteen paths already belongs to this project,
		// reproducing an incremental patch where 6/13 exact-file coverage is below a
		// strict majority but the destination is still structurally well anchored.
		for (index, (path, content)) in entries.iter().enumerate() {
			let destination = project_root.join(path);
			fs::create_dir_all(destination.parent().expect("entry should have a parent"))
				.expect("project parent hierarchy should be created");

			if index < 6 {
				write_test_file(
					&destination,
					content,
				);
			}
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("anchored incremental ZIP should resolve to exact ROOT");

		let recommended_index = prepared
			.recommended_candidate_index
			.expect("exact ROOT should be recommended without destination confirmation");
		let candidate = prepared
			.candidates
			.get(recommended_index)
			.expect("recommended exact ROOT candidate should exist");

		assert_eq!(candidate.destination_relative_path, "./");
		assert_eq!(candidate.source_prefix, "");
		assert_eq!(candidate.matched_files, 6);
		assert!(candidate.matched_files * 2 <= prepared.file_count);
		assert_eq!(
			candidate.matched_files + 1,
			minimum_zip_root_file_matches(prepared.file_count),
		);
		assert!(candidate.matched_directories >= prepared.file_count * 2);
	}

	#[test]
	fn br_route_002_directory_overlap_cannot_rescue_too_few_exact_files() {
		let candidate = CandidatePlan {
			candidate: OverlayDestinationCandidate {
				destination_relative_path: "./".to_string(),
				source_prefix: String::new(),
				matched_files: 5,
				matched_directories: 80,
				source_context_matches: 0,
			},
			destination_relative_path: PathBuf::new(),
			source_prefix: PathBuf::new(),
			score: 0,
			mapping_key: Vec::new(),
			is_named_destination: false,
		};

		assert!(!has_structurally_anchored_zip_root_evidence(
			&candidate,
			13,
		));
	}

	#[test]
	fn br_route_002_small_incremental_zip_with_two_exact_files_applies_at_root() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("small-incremental.zip");
		let project_root = test_directory.path.join("taurus-project");
		// Mirrors a real 6-file ROOT-relative ZIP with two existing files and
		// fifteen levels of existing parent-directory matches across its paths.
		let entries = [
			("src/components/MapEditor.tsx", "map"),
			("src/lib/selection-engine/sessionBlockVisualCache.ts", "cache"),
			("src/lib/selection-engine/selectedBlockSessionPaint.ts", "paint"),
			("tests/selection/p6-4-23-pinned-selection-and-background-cache.test.ts", "test"),
			("tests/selection/fixtures/real/p6-4-23-roaming-p6422-field-observation.json", "fixture"),
			("docs/P6_4_23_PINNED_SELECTION_IDLE_CACHE.md", "docs"),
		];
		write_test_zip(&archive_path, &entries);

		for (index, (path, content)) in entries.iter().enumerate() {
			let destination = project_root.join(path);
			fs::create_dir_all(destination.parent().expect("file has a parent"))
				.expect("project parent hierarchy should exist");
			if index < 2 {
				write_test_file(&destination, content);
			}
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("small incremental ZIP should prepare successfully");

		assert!(!prepared.ambiguity_limit_exceeded);
		assert_eq!(prepared.file_count, 6);
		assert_eq!(prepared.recommended_candidate_index, Some(0));
		let recommended = &prepared.candidates[0];
		assert_eq!(recommended.destination_relative_path, "./");
		assert_eq!(recommended.source_prefix, "");
		assert_eq!(recommended.matched_files, 2);
		assert_eq!(recommended.matched_directories, 15);
	}

	#[test]
	fn br_route_002_small_incremental_requires_two_exact_files_and_real_hierarchy() {
		let mut candidate = CandidatePlan {
			candidate: OverlayDestinationCandidate {
				destination_relative_path: "./".to_string(),
				source_prefix: String::new(),
				matched_files: 1,
				matched_directories: 99,
				source_context_matches: 0,
			},
			destination_relative_path: PathBuf::new(),
			source_prefix: PathBuf::new(),
			score: 0,
			mapping_key: Vec::new(),
			is_named_destination: false,
		};

		// Many common folders cannot compensate for a single exact file match.
		assert!(!has_structurally_anchored_zip_root_evidence(&candidate, 6));
		// Two exact files without deep shared parent paths are not enough either.
		candidate.candidate.matched_files = 2;
		candidate.candidate.matched_directories = 11;
		assert!(!has_structurally_anchored_zip_root_evidence(&candidate, 6));
		candidate.candidate.matched_directories = 12;
		assert!(has_structurally_anchored_zip_root_evidence(&candidate, 6));
		// Larger ZIPs still use the stronger original coverage threshold.
		candidate.candidate.matched_directories = 99;
		assert!(!has_structurally_anchored_zip_root_evidence(&candidate, 13));
	}
