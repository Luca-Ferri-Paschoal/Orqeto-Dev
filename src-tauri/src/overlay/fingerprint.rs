fn reader_fingerprint<R: Read>(
	reader: &mut R,
	label: &str,
) -> Result<FileFingerprint, String> {
	let mut buffer = vec![0_u8; machine_resource_policy().stream_buffer_bytes];
	let mut size = 0_u64;
	let mut hasher = Sha256::new();

	loop {
		let read = reader
			.read(&mut buffer)
			.map_err(|error| format!("Could not verify {label}: {error}"))?;

		if read == 0 {
			break;
		}

		size = size
			.checked_add(read as u64)
			.ok_or_else(|| "The verified file size is invalid.".to_string())?;
		hasher.update(&buffer[..read]);
	}

	let digest = hasher.finalize();
	let mut hash = [0_u8; 32];
	hash.copy_from_slice(&digest);

	Ok(FileFingerprint { size, hash })
}

pub(crate) fn file_fingerprint(path: &Path) -> Result<FileFingerprint, String> {
	let mut file = File::open(path)
		.map_err(|error| format!("Could not verify {}: {error}", path.display()))?;

	reader_fingerprint(
		&mut file,
		&path.display().to_string(),
	)
}


fn hash_field(hasher: &mut Sha256, value: &[u8]) {
	hasher.update((value.len() as u64).to_le_bytes());
	hasher.update(value);
}

fn hash_path_field(hasher: &mut Sha256, path: &Path) {
	hash_field(
		hasher,
		path.to_string_lossy().replace('\\', "/").as_bytes(),
	);
}

fn hash_file_fingerprint(hasher: &mut Sha256, fingerprint: FileFingerprint) {
	hasher.update(fingerprint.size.to_le_bytes());
	hasher.update(fingerprint.hash);
}

fn manifest_source_fingerprint(manifest: &OverlayManifest) -> Result<String, String> {
	let mut hasher = Sha256::new();
	hash_field(&mut hasher, b"orqeto-overlay-source-v1");

	match &manifest.kind {
		ManifestKind::Directory { .. } => hash_field(&mut hasher, b"directory"),
		ManifestKind::File { .. } => hash_field(&mut hasher, b"file"),
		ManifestKind::Zip { .. } => hash_field(&mut hasher, b"zip"),
	}

	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => {
			for file in &manifest.files {
				hash_path_field(&mut hasher, &file.relative_path);
				let ManifestFileSource::Directory(source) = &file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				hash_file_fingerprint(&mut hasher, file_fingerprint(source)?);
			}
		}
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;

			for file in &manifest.files {
				hash_path_field(&mut hasher, &file.relative_path);
				let ManifestFileSource::Zip(index) = &file.source else {
					return Err("The ZIP source was interpreted with an invalid type.".to_string());
				};
				let mut source = archive
					.by_index(*index)
					.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;
				let label = format!("ZIP entry {}", file.relative_path.display());
				hash_file_fingerprint(
					&mut hasher,
					reader_fingerprint(&mut source, &label)?,
				);
			}
		}
	}

	let mut delete_paths = manifest.delete_paths.clone();
	delete_paths.sort();
	for path in delete_paths {
		hash_field(&mut hasher, b"delete-file");
		hash_path_field(&mut hasher, &path);
	}
	let mut delete_directories = manifest.delete_directories.clone();
	delete_directories.sort();
	for path in delete_directories {
		hash_field(&mut hasher, b"delete-directory");
		hash_path_field(&mut hasher, &path);
	}

	let mut permanent = manifest.permanent_delete_directories.clone();
	permanent.sort();
	for path in permanent {
		hash_field(&mut hasher, b"delete-permanent-directory");
		hash_path_field(&mut hasher, &path);
	}

	Ok(encode_hex(&hasher.finalize()))
}

fn hash_candidate(hasher: &mut Sha256, candidate: &OverlayDestinationCandidate) {
	hash_field(hasher, candidate.destination_relative_path.as_bytes());
	hash_field(hasher, candidate.source_prefix.as_bytes());
	hasher.update((candidate.matched_files as u64).to_le_bytes());
	hasher.update((candidate.matched_directories as u64).to_le_bytes());
	hasher.update((candidate.source_context_matches as u64).to_le_bytes());
}

fn overlay_routing_fingerprint(
	root: &Path,
	source_fingerprint: &str,
	candidates: &[OverlayDestinationCandidate],
	root_candidate: Option<&OverlayDestinationCandidate>,
	recommended_candidate_index: Option<usize>,
	candidate_count: usize,
	ambiguity_limit_exceeded: bool,
) -> Result<String, String> {
	let mut hasher = Sha256::new();
	hash_field(&mut hasher, b"orqeto-overlay-routing-v1");
	hash_path_field(&mut hasher, root);
	hash_field(&mut hasher, source_fingerprint.as_bytes());

	let ignore_path = root.join(".orqeto-devignore");
	match fs::read(&ignore_path) {
		Ok(content) => {
			hash_field(&mut hasher, b"ignore-present");
			hash_field(&mut hasher, &content);
		}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			hash_field(&mut hasher, b"ignore-absent");
		}
		Err(error) => {
			return Err(format!(
				"Could not verify .orqeto-devignore during routing: {error}",
			));
		}
	}

	hasher.update((candidate_count as u64).to_le_bytes());
	hasher.update([u8::from(ambiguity_limit_exceeded)]);
	match recommended_candidate_index {
		Some(index) => {
			hasher.update([1]);
			hasher.update((index as u64).to_le_bytes());
		}
		None => hasher.update([0]),
	}

	match root_candidate {
		Some(candidate) => {
			hasher.update([1]);
			hash_candidate(&mut hasher, candidate);
		}
		None => hasher.update([0]),
	}

	for candidate in candidates {
		hash_candidate(&mut hasher, candidate);
	}

	Ok(encode_hex(&hasher.finalize()))
}

fn planned_source_fingerprints(
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<Vec<FileFingerprint>, String> {
	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => planned_files
			.iter()
			.map(|planned| {
				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
				let ManifestFileSource::Directory(source) = &manifest_file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				file_fingerprint(source)
			})
			.collect(),
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;
			let mut fingerprints = Vec::with_capacity(planned_files.len());

			for planned in planned_files {
				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The ZIP source file is no longer available.".to_string())?;
				let ManifestFileSource::Zip(index) = &manifest_file.source else {
					return Err("The ZIP source was interpreted with an invalid type.".to_string());
				};
				let mut source = archive
					.by_index(*index)
					.map_err(|error| format!("Could not reread a ZIP entry: {error}"))?;
				fingerprints.push(reader_fingerprint(
					&mut source,
					&format!("ZIP entry {}", manifest_file.relative_path.display()),
				)?);
			}

			Ok(fingerprints)
		}
	}
}

