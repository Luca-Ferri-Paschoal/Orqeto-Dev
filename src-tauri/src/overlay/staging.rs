fn create_files_apply_staging_directory(root: &Path) -> Result<PathBuf, String> {
	storage::create_files_apply_staging_directory(root)
}

fn manifest_source_bytes(manifest: &OverlayManifest) -> Result<u64, String> {
	match &manifest.kind {
		ManifestKind::Directory { .. } => {
			let mut total = 0_u64;
			for file in &manifest.files {
				let ManifestFileSource::Directory(source) = &file.source else {
					return Err("The folder source was interpreted with an invalid type.".to_string());
				};
				let metadata = fs::metadata(source)
					.map_err(|error| format!("Could not estimate staging for {}: {error}", source.display()))?;
				total = total
					.checked_add(metadata.len())
					.ok_or_else(|| "Staging size exceeded the numeric limit.".to_string())?;
			}
			Ok(total)
		}
		ManifestKind::File { source_file, .. } => fs::metadata(source_file)
			.map(|metadata| metadata.len())
			.map_err(|error| format!("Could not estimate staging for {}: {error}", source_file.display())),
		ManifestKind::Zip { archive_path } => fs::metadata(archive_path)
			.map(|metadata| metadata.len())
			.map_err(|error| format!("Could not estimate staging for {}: {error}", archive_path.display())),
	}
}

fn freeze_stable_file(
	source: &Path,
	destination: &Path,
) -> Result<FileFingerprint, String> {
	let before = file_fingerprint(source)?;
	safe_fs::atomic_copy_create_new(source, destination)
		.map_err(|error| format!("Could not freeze {}: {error}", source.display()))?;
	let frozen = file_fingerprint(destination)?;
	let after = file_fingerprint(source)?;
	if before != after || before != frozen {
		return Err(format!(
			"{} changed while the source was being frozen. The application was cancelled before changing the project.",
			source.display(),
		));
	}
	Ok(frozen)
}

fn add_frozen_bytes(
	total: &mut u64,
	fingerprint: FileFingerprint,
	reserved_bytes: u64,
) -> Result<(), String> {
	*total = total
		.checked_add(fingerprint.size)
		.ok_or_else(|| "The application staging size is invalid.".to_string())?;
	if *total > reserved_bytes {
		return Err(
			"The source grew beyond reserved storage while being frozen. The application was cancelled before changing the project.".to_string(),
		);
	}
	Ok(())
}

fn freeze_overlay_input(
	root_folder: &str,
	paths: &[String],
) -> Result<FrozenOverlayInput, String> {
	let (root, mut manifest) = build_manifest(
		root_folder,
		paths,
	)?;
	let expected_staging_bytes = manifest_source_bytes(&manifest)?;
	let staging_reservation_bytes = storage::staging_reservation_bytes(
		expected_staging_bytes,
		manifest.files.len(),
	)?;
	let _storage_reservation = storage::reserve(
		&root,
		staging_reservation_bytes,
	)?;
	let staging_directory = create_files_apply_staging_directory(&root)?;
	let result = (|| {
		let mut frozen_bytes = 0_u64;
		match &mut manifest.kind {
			ManifestKind::Directory {
				source_root,
				..
			} => {
				let files_root = safe_fs::create_descendant_directories_no_reparse(
					&staging_directory,
					Path::new("files"),
				)
				.map_err(|error| format!("Could not prepare staging for the applied folder: {error}"))?;
				*source_root = files_root.clone();

				for (index, file) in manifest.files.iter_mut().enumerate() {
					let ManifestFileSource::Directory(source) = &file.source else {
						return Err("The folder source was interpreted with an invalid type.".to_string());
					};
					let source = source.clone();
					let destination = files_root.join(format!("{index:016x}.bin"));
					let fingerprint = freeze_stable_file(
						&source,
						&destination,
					)?;
					add_frozen_bytes(
						&mut frozen_bytes,
						fingerprint,
						expected_staging_bytes,
					)?;
					file.source = ManifestFileSource::Directory(destination);
				}
			}
			ManifestKind::File {
				source_file,
				..
			} => {
				let original = source_file.clone();
				let frozen_file = staging_directory.join("source-file.bin");
				let fingerprint = freeze_stable_file(
					&original,
					&frozen_file,
				)?;
				add_frozen_bytes(
					&mut frozen_bytes,
					fingerprint,
					expected_staging_bytes,
				)?;
				*source_file = frozen_file.clone();
				for file in &mut manifest.files {
					let ManifestFileSource::Directory(_) = &file.source else {
						return Err("The file source was interpreted with an invalid type.".to_string());
					};
					file.source = ManifestFileSource::Directory(frozen_file.clone());
				}
			}
			ManifestKind::Zip { archive_path } => {
				let original = archive_path.clone();
				let frozen_archive = staging_directory.join("source.zip");
				let fingerprint = freeze_stable_file(
					&original,
					&frozen_archive,
				)?;
				add_frozen_bytes(
					&mut frozen_bytes,
					fingerprint,
					expected_staging_bytes,
				)?;
				*archive_path = frozen_archive;
			}
		}

		Ok(FrozenOverlayInput {
			root,
			manifest,
			staging_directory: staging_directory.clone(),
		})
	})();

	if result.is_err() {
		let _ = storage::remove_managed_directory(&staging_directory);
	}

	result
}

