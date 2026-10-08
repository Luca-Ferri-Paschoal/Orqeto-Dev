// An explicit approval is valid only for the exact preflight state. The UI
// receives paths, counts and actions, never credential bytes or excerpts.
fn source_cannot_be_approved(manifest: &OverlayManifest, source_index: usize) -> Result<bool, String> {
    let source = manifest.files.get(source_index)
        .ok_or_else(|| "The source file is no longer available.".to_string())?;
    match (&manifest.kind, &source.source) {
        (ManifestKind::Zip { archive_path }, ManifestFileSource::Zip(index)) => {
            let file = File::open(archive_path).map_err(|error| error.to_string())?;
            let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
            let mut item = archive.by_index(*index).map_err(|error| error.to_string())?;
            if item.size() > crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES { return Ok(true); }
            let mut content = String::new();
            if item.read_to_string(&mut content).is_err() { return Ok(true); }
            Ok(content.contains("[REDACTED]"))
        }
        (_, ManifestFileSource::Directory(path)) => {
            let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
            if metadata.len() > crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES { return Ok(true); }
            let mut content = String::new();
            if File::open(path).map_err(|error| error.to_string())?
                .read_to_string(&mut content).is_err() { return Ok(true); }
            Ok(content.contains("[REDACTED]"))
        }
        _ => Err("The source file type changed during review.".to_string()),
    }
}

fn secret_review_plan(
    root: &Path,
    manifest: &OverlayManifest,
    files: &[PlannedFile],
    deletes: &[PathBuf],
) -> Result<SecretReviewResult, String> {
    let counts = source_secret_counts(manifest, files)?;
    let mut review = Vec::new();
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, b"orqeto-secret-review-v1");
    for planned in files {
        let source_detections = counts.get(&planned.source_index).copied().unwrap_or(0);
        let destination = root.join(&planned.destination_relative_path);
        let destination_detections = if planned.was_replaced {
            scan_regular_file_for_secrets(&planned.destination_relative_path, &destination)?
        } else { 0 };
        if source_detections == 0 && destination_detections == 0 { continue; }
        let approvable = !source_cannot_be_approved(manifest, planned.source_index)? &&
            (!planned.was_replaced || fs::metadata(&destination).map_err(|error| error.to_string())?.len() <= crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES);
        let path = planned.destination_relative_path.to_string_lossy().replace('\\', "/");
        hash_field(&mut hasher, path.as_bytes());
        hash_field(&mut hasher, b"write");
        hasher.update((source_detections as u64).to_le_bytes());
        hasher.update((destination_detections as u64).to_le_bytes());
        hasher.update([u8::from(approvable)]);
        if planned.was_replaced {
            let size = fs::metadata(&destination).map_err(|error| error.to_string())?.len();
            if size <= crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES {
                hash_file_fingerprint(&mut hasher, file_fingerprint(&destination)?);
            } else {
                hasher.update(size.to_le_bytes());
            }
        }
        review.push(SecretReviewFile {
            path,
            operation: if planned.was_replaced { "replace" } else { "create" }.to_string(),
            source_detections,
            destination_detections,
            approvable,
        });
    }
    for path in deletes {
        let destination = root.join(path);
        let destination_detections = scan_regular_file_for_secrets(path, &destination)?;
        if destination_detections == 0 { continue; }
        let approvable = fs::metadata(&destination).map_err(|error| error.to_string())?.len() <= crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES;
        let display = path.to_string_lossy().replace('\\', "/");
        hash_field(&mut hasher, display.as_bytes());
        hash_field(&mut hasher, b"delete");
        hasher.update((destination_detections as u64).to_le_bytes());
        hasher.update([u8::from(approvable)]);
        let size = fs::metadata(&destination).map_err(|error| error.to_string())?.len();
        if size <= crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES {
            hash_file_fingerprint(&mut hasher, file_fingerprint(&destination)?);
        } else {
            hasher.update(size.to_le_bytes());
        }
        review.push(SecretReviewFile {
            path: display,
            operation: "delete".to_string(),
            source_detections: 0,
            destination_detections,
            approvable,
        });
    }
    Ok(SecretReviewResult { files: review, fingerprint: encode_hex(&hasher.finalize()) })
}

struct SecretProtectionPlan {
	planned_files: Vec<PlannedFile>,
	delete_paths: Vec<PathBuf>,
	delete_directories: Vec<PathBuf>,
	protected_files: usize,
	secret_count: usize,
}

fn scan_text_reader_for_secrets<R: Read>(
	relative_path: &Path,
	reader: &mut R,
	size: u64,
) -> Result<usize, String> {
	let display_path = relative_path.to_string_lossy().replace('\\', "/");
	if size > crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES {
		return Ok(usize::from(
			crate::context_redaction::secret_scan_fails_closed_for_path(&display_path),
		));
	}

	let mut content = String::with_capacity(size as usize);
	match reader.read_to_string(&mut content) {
		Ok(_) => Ok(crate::context_redaction::secret_exposure_count(
			&display_path,
			&content,
		)),
		Err(_) if crate::context_redaction::secret_scan_fails_closed_for_path(&display_path) => Ok(1),
		Err(_) => Ok(0),
	}
}

fn scan_regular_file_for_secrets(
	relative_path: &Path,
	absolute_path: &Path,
) -> Result<usize, String> {
	let metadata = fs::metadata(absolute_path)
		.map_err(|error| format!("Could not inspect protected content at {}: {error}", absolute_path.display()))?;
	if !metadata.is_file() {
		return Ok(0);
	}
	let mut file = File::open(absolute_path)
		.map_err(|error| format!("Could not inspect protected content at {}: {error}", absolute_path.display()))?;
	scan_text_reader_for_secrets(
		relative_path,
		&mut file,
		metadata.len(),
	)
}

fn source_secret_counts(
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<HashMap<usize, usize>, String> {
	let mut counts = HashMap::new();
	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => {
			for planned in planned_files {
				if counts.contains_key(&planned.source_index) {
					continue;
				}
				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
				let ManifestFileSource::Directory(source) = &manifest_file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				let count = scan_regular_file_for_secrets(
					&planned.destination_relative_path,
					source,
				)?;
				counts.insert(planned.source_index, count);
			}
		}
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;
			for planned in planned_files {
				if counts.contains_key(&planned.source_index) {
					continue;
				}
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
				let source_size = source.size();
				let count = scan_text_reader_for_secrets(
					&planned.destination_relative_path,
					&mut source,
					source_size,
				)?;
				counts.insert(planned.source_index, count);
			}
		}
	}
	Ok(counts)
}

fn directory_contains_path(
	directory: &Path,
	path: &Path,
) -> bool {
	path == directory || path.starts_with(directory)
}

fn protect_secret_bearing_changes(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: Vec<PlannedFile>,
	delete_paths: Vec<PathBuf>,
	delete_directories: Vec<PathBuf>,
    approved_paths: &HashSet<PathBuf>,
) -> Result<SecretProtectionPlan, String> {
	let source_counts = source_secret_counts(
		manifest,
		&planned_files,
	)?;
	let mut protected_paths = HashSet::new();
	let mut secret_count = 0_usize;
	let mut safe_files = Vec::with_capacity(planned_files.len());

	for planned in planned_files {
		let source_count = source_counts
			.get(&planned.source_index)
			.copied()
			.unwrap_or(0);
		let destination_count = if planned.was_replaced {
			scan_regular_file_for_secrets(
				&planned.destination_relative_path,
				&root.join(&planned.destination_relative_path),
			)?
		} else {
			0
		};
		let detected = source_count.saturating_add(destination_count);
		if detected > 0 && !approved_paths.contains(&planned.destination_relative_path) {
			secret_count = secret_count.saturating_add(detected);
			protected_paths.insert(planned.destination_relative_path.clone());
			continue;
		}
		safe_files.push(planned);
	}

	let mut safe_deletes = Vec::with_capacity(delete_paths.len());
	for delete_path in delete_paths {
		let detected = scan_regular_file_for_secrets(
			&delete_path,
			&root.join(&delete_path),
		)?;
		if detected > 0 && !approved_paths.contains(&delete_path) {
			secret_count = secret_count.saturating_add(detected);
			protected_paths.insert(delete_path);
			continue;
		}
		safe_deletes.push(delete_path);
	}

	let safe_directories = delete_directories
		.into_iter()
		.filter(|directory| !protected_paths
			.iter()
			.any(|path| directory_contains_path(directory, path)))
		.collect::<Vec<_>>();

	Ok(SecretProtectionPlan {
		planned_files: safe_files,
		delete_paths: safe_deletes,
		delete_directories: safe_directories,
		protected_files: protected_paths.len(),
		secret_count,
	})
}
