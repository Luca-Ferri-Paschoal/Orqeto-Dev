	#[test]
	fn br_route_004_zip_archive_envelope_rejects_generic_directory_only_foreign_match() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory
			.path
			.join("taurus-territory-incremental-viewport-v6(1).zip");
		let foreign_root = test_directory.path.join("assignment-manager");
		let matching_root = test_directory.path.join("taurus-territory-sample");
		let wrapper = "taurus-territory-incremental-viewport-v6";
		let entries = [
			(
				"taurus-territory-incremental-viewport-v6/src/lib/osm.ts",
				"osm",
			),
			(
				"taurus-territory-incremental-viewport-v6/src/components/MapEditor.tsx",
				"map-editor",
			),
			(
				"taurus-territory-incremental-viewport-v6/README-PATCH.txt",
				"readme",
			),
		];

		write_test_zip(
			&archive_path,
			&entries,
		);

		fs::create_dir_all(foreign_root.join("src/lib"))
			.expect("foreign src/lib directory should be created");
		fs::create_dir_all(foreign_root.join("src/components"))
			.expect("foreign src/components directory should be created");

		let foreign = prepare_project_overlay_blocking(
			foreign_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("generic foreign directory overlap should remain only a root fallback");

		assert!(foreign.root_candidate.is_some());
		assert!(foreign.candidates.is_empty());
		assert_eq!(foreign.recommended_candidate_index, None);

		write_test_file(
			&matching_root.join("src/lib/osm.ts"),
			"osm-old",
		);
		write_test_file(
			&matching_root.join("src/components/MapEditor.tsx"),
			"map-editor-old",
		);
		write_test_file(
			&matching_root.join("README-PATCH.txt"),
			"readme-old",
		);

		let matching = prepare_project_overlay_blocking(
			matching_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("archive envelope should resolve to the matching project root");

		let recommended_index = matching
			.recommended_candidate_index
			.expect("matching project should have a recommended archive-envelope destination");
		let candidate = matching
			.candidates
			.get(recommended_index)
			.expect("recommended archive-envelope candidate should exist");

		assert_eq!(candidate.destination_relative_path, "./");
		assert_eq!(candidate.source_prefix, wrapper);
		assert_eq!(candidate.matched_files, 3);
	}

	#[test]
	fn br_route_002_strong_exact_root_beats_equal_source_prefix_relocation() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("card-flow-fix.zip");
		let project_root = test_directory.path.join("financial-project");
		let entries = [
			(
				"apps/api/src/modules/billing/tenant/checkout/cardFlow.test.ts",
				"new-card-flow",
			),
			(
				"apps/api/src/modules/billing/shared/durableAutomaticPaymentSafety.test.ts",
				"durable",
			),
			(
				"apps/api/src/modules/billing/engine/financialWriteAdmission.test.ts",
				"admission",
			),
			(
				"apps/api/src/infra/financial/payments/provider/asaas/provider.test.ts",
				"provider",
			),
			(
				"apps/api/src/infra/financial/payments/outboxSafety.test.ts",
				"outbox",
			),
			(
				"apps/api/src/infra/financial/asaas/config.ts",
				"config",
			),
		];

		write_test_zip(
			&archive_path,
			&entries,
		);

		// Five files already exist exactly where the ZIP declares them. The
		// sixth file is new but its parent hierarchy already belongs to the same
		// project. This is the common incremental-patch case that must preserve
		// the archive's ROOT-relative paths.
		for (index, (path, content)) in entries.iter().enumerate() {
			let exact_destination = project_root.join(path);

			if index != 0 {
				write_test_file(
					&exact_destination,
					content,
				);
			} else {
				fs::create_dir_all(
					exact_destination.parent().expect("new file should have a parent"),
				)
				.expect("new exact-root parent should be created");
			}

			// Also create an equally convincing relocated mapping obtained by
			// stripping `apps/api`. Equal file counts must not make the exact ROOT
			// mapping ambiguous inside this project.
			if index != 0 {
				let stripped = Path::new(path)
					.strip_prefix("apps/api")
					.expect("fixture should use the apps/api prefix");
				write_test_file(
					&project_root.join(stripped),
					content,
				);
			}
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("strong exact ROOT evidence should resolve the project");

		let root_candidate = prepared
			.root_candidate
			.as_ref()
			.expect("safe exact ROOT fallback should exist");

		assert_eq!(root_candidate.destination_relative_path, "./");
		assert_eq!(root_candidate.source_prefix, "");
		assert_eq!(root_candidate.matched_files, 5);
		assert_eq!(prepared.recommended_candidate_index, Some(0));
		assert_eq!(prepared.candidates[0].destination_relative_path, "./");
		assert_eq!(prepared.candidates[0].source_prefix, "");
		assert_eq!(prepared.candidates[0].matched_files, 5);
	}


	#[test]
	fn br_route_002_exact_root_match_survives_repeated_directory_seed_overflow() {
		let test_directory = TestDirectory::new();
		let archive_path = test_directory.path.join("person-dialog-fix.zip");
		let project_root = test_directory.path.join("assignment-manager");
		let relative_path = "src/features/congregation/components/PersonEditorDialog/style.ts";

		write_test_zip(
			&archive_path,
			&[(relative_path, "export const width = 640;\n")],
		);
		write_test_file(
			&project_root.join(relative_path),
			"export const width = 620;\n",
		);

		// Repeated generic directory names intentionally create more cheap
		// candidate seeds than the bounded validator will inspect. They must not
		// hide the independently proven exact ROOT-relative file match above.
		for index in 0..32 {
			fs::create_dir_all(project_root.join(format!(
				"decoy-{index}/src/features/congregation/components/PersonEditorDialog",
			)))
			.expect("decoy routing directories should be created");
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("exact root evidence should survive bounded candidate discovery");

		assert!(prepared.candidate_count > MAX_ROUTING_CANDIDATE_VALIDATIONS);
		assert!(!prepared.ambiguity_limit_exceeded);
		assert_eq!(prepared.recommended_candidate_index, Some(0));
		assert_eq!(prepared.candidates.len(), 1);
		assert_eq!(prepared.candidates[0].destination_relative_path, "./");
		assert_eq!(prepared.candidates[0].matched_files, 1);
	}



	struct FailingReader {
		first_chunk: bool,
	}

	impl std::io::Read for FailingReader {
		fn read(
			&mut self,
			buffer: &mut [u8],
		) -> std::io::Result<usize> {
			if self.first_chunk {
				self.first_chunk = false;
				let content = b"partial-new-content";
				let count = content.len().min(buffer.len());
				buffer[..count].copy_from_slice(&content[..count]);
				Ok(count)
			} else {
				Err(std::io::Error::other("injected temporary write failure"))
			}
		}
	}

