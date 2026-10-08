	use super::*;
	use std::io::Write as _;
	use zip::{write::SimpleFileOptions, ZipWriter};

	struct TestDirectory {
		path: PathBuf,
	}

	impl TestDirectory {
		fn new() -> Self {
			let identifier = SystemTime::now()
				.duration_since(UNIX_EPOCH)
				.expect("test clock should be valid")
				.as_nanos();
			let path = std::env::temp_dir().join(format!(
				"orqeto-dev-overlay-test-{}-{identifier}",
				std::process::id(),
			));

			fs::create_dir_all(&path).expect("test directory should be created");
			Self { path }
		}
	}

	impl Drop for TestDirectory {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.path);
		}
	}

	struct ChunkedReader<'a> {
		content: &'a [u8],
		offset: usize,
		max_chunk: usize,
	}

	impl std::io::Read for ChunkedReader<'_> {
		fn read(
			&mut self,
			buffer: &mut [u8],
		) -> std::io::Result<usize> {
			if self.offset >= self.content.len() {
				return Ok(0);
			}

			let count = buffer
				.len()
				.min(self.max_chunk)
				.min(self.content.len() - self.offset);
			buffer[..count].copy_from_slice(&self.content[self.offset..self.offset + count]);
			self.offset += count;
			Ok(count)
		}
	}

	fn write_test_file(
		path: &Path,
		content: &str,
	) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).expect("test parent directory should be created");
		}

		fs::write(
			path,
			content,
		)
		.expect("test file should be written");
	}

	fn write_test_zip(
		path: &Path,
		entries: &[(&str, &str)],
	) {
		let file = File::create(path).expect("test zip should be created");
		let mut archive = ZipWriter::new(file);

		for (name, content) in entries {
			archive
				.start_file(
					*name,
					SimpleFileOptions::default(),
				)
				.expect("test zip entry should be started");
			archive
				.write_all(content.as_bytes())
				.expect("test zip entry should be written");
		}

		archive.finish().expect("test zip should be finalized");
	}

	#[test]
	fn project_access_coordinator_blocks_overlapping_reads_and_writes() {
		let test_directory = TestDirectory::new();
		let root = test_directory.path.join("project");
		let child = root.join("packages/app");
		fs::create_dir_all(&child).expect("overlapping test roots should be created");
		let state = OverlayUndoState::new();

		let read = state
			.begin_project_read(&root.to_string_lossy())
			.expect("read should start");
		assert!(state.begin_project_mutation(&child.to_string_lossy()).is_err());
		drop(read);

		let write = state
			.begin_project_mutation(&child.to_string_lossy())
			.expect("write should start after the reader is released");
		assert!(state.begin_project_read(&root.to_string_lossy()).is_err());
		drop(write);
		assert!(state.begin_project_read(&root.to_string_lossy()).is_ok());
	}

	#[test]
	fn identical_streams_with_different_read_chunk_boundaries_are_unchanged() {
		let content = b"same ZIP entry bytes repeated across uneven reader chunks".repeat(4096);
		let mut zip_like_reader = ChunkedReader {
			content: &content,
			offset: 0,
			max_chunk: 137,
		};
		let mut file_like_reader = ChunkedReader {
			content: &content,
			offset: 0,
			max_chunk: 8192,
		};

		assert!(readers_are_equal(
			&mut zip_like_reader,
			&mut file_like_reader,
			"ZIP entry",
			"project file",
		)
		.expect("equal streams should be compared independently of read chunk size"));
	}

	#[test]
	fn overlay_fingerprints_change_when_source_or_routing_evidence_changes() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "one");

		let first = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("first overlay plan should be prepared");

		write_test_file(&source, "two");
		let changed_source = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("changed source should still be analyzable");
		assert_ne!(first.source_fingerprint, changed_source.source_fingerprint);

		write_test_file(&project_root.join(".orqeto-devignore"), "# routing state changed\n");
		let changed_routing = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source.to_string_lossy().into_owned()],
		)
		.expect("changed routing evidence should still be analyzable");
		assert_eq!(changed_source.source_fingerprint, changed_routing.source_fingerprint);
		assert_ne!(changed_source.routing_fingerprint, changed_routing.routing_fingerprint);
	}


	fn root_choice(plan: &PrepareProjectOverlayResult) -> (String, String) {
		let candidate = plan
			.root_candidate
			.as_ref()
			.expect("root candidate should be available");
		(
			candidate.destination_relative_path.clone(),
			candidate.source_prefix.clone(),
		)
	}

	#[test]
	fn br_file_001_frozen_apply_uses_exact_frozen_bytes_after_original_source_changes() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source = test_directory.path.join("incoming/state.ts");
		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(&source, "version-one");

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
		.expect("frozen input should match preview");

		write_test_file(&source, "version-two-after-freeze");

		let (result, snapshot) = apply_overlay_manifest_blocking(
			frozen.root.clone(),
			&frozen.manifest,
			destination,
			prefix,
		)
		.expect("frozen overlay should apply");

		assert_eq!(result.added_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("applied destination should be readable"),
			"version-one",
		);
		discard_snapshot(snapshot);
	}

