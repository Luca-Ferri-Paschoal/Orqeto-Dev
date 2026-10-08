fn readers_are_equal<L: Read, R: Read>(
	left: &mut L,
	right: &mut R,
	left_label: &str,
	right_label: &str,
) -> Result<bool, String> {
	let buffer_bytes = machine_resource_policy().stream_buffer_bytes;
	let mut left = BufReader::with_capacity(
		buffer_bytes,
		left,
	);
	let mut right = BufReader::with_capacity(
		buffer_bytes,
		right,
	);

	loop {
		let (compared_bytes, left_finished, right_finished, equal) = {
			let left_buffer = left
				.fill_buf()
				.map_err(|error| format!("Could not verify {left_label}: {error}"))?;
			let right_buffer = right
				.fill_buf()
				.map_err(|error| format!("Could not verify {right_label}: {error}"))?;
			let compared_bytes = left_buffer.len().min(right_buffer.len());

			(
				compared_bytes,
				left_buffer.is_empty(),
				right_buffer.is_empty(),
				left_buffer[..compared_bytes] == right_buffer[..compared_bytes],
			)
		};

		if !equal {
			return Ok(false);
		}

		if left_finished || right_finished {
			return Ok(left_finished && right_finished);
		}

		left.consume(compared_bytes);
		right.consume(compared_bytes);
	}
}

fn files_are_equal(
	left_path: &Path,
	right_path: &Path,
) -> Result<bool, String> {
	let left_metadata = fs::metadata(left_path)
		.map_err(|error| format!("Could not verify {}: {error}", left_path.display()))?;
	let right_metadata = fs::metadata(right_path)
		.map_err(|error| format!("Could not verify {}: {error}", right_path.display()))?;

	if left_metadata.len() != right_metadata.len() {
		return Ok(false);
	}

	let mut left = File::open(left_path)
		.map_err(|error| format!("Could not verify {}: {error}", left_path.display()))?;
	let mut right = File::open(right_path)
		.map_err(|error| format!("Could not verify {}: {error}", right_path.display()))?;

	readers_are_equal(
		&mut left,
		&mut right,
		&left_path.display().to_string(),
		&right_path.display().to_string(),
	)
}

fn filter_unchanged_planned_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: Vec<PlannedFile>,
) -> Result<(Vec<PlannedFile>, Vec<PathBuf>), String> {
	let mut changed = Vec::with_capacity(planned_files.len());
	let mut unchanged_paths = Vec::new();

	match &manifest.kind {
		ManifestKind::Directory { .. } | ManifestKind::File { .. } => {
			for planned in planned_files {
				if !planned.was_replaced {
					changed.push(planned);
					continue;
				}

				let manifest_file = manifest
					.files
					.get(planned.source_index)
					.ok_or_else(|| "The patch source file is no longer available.".to_string())?;
				let ManifestFileSource::Directory(source) = &manifest_file.source else {
					return Err("The patch source was interpreted with an invalid type.".to_string());
				};
				let destination = root.join(&planned.destination_relative_path);

				if files_are_equal(
					source,
					&destination,
				)? {
					unchanged_paths.push(planned.destination_relative_path);
				} else {
					changed.push(planned);
				}
			}
		}
		ManifestKind::Zip { archive_path } => {
			let archive_file = File::open(archive_path)
				.map_err(|error| format!("Could not reopen {}: {error}", archive_path.display()))?;
			let mut archive = ZipArchive::new(archive_file)
				.map_err(|error| format!("Could not reopen the ZIP: {error}"))?;

			for planned in planned_files {
				if !planned.was_replaced {
					changed.push(planned);
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
				let destination = root.join(&planned.destination_relative_path);
				let destination_metadata = fs::metadata(&destination)
					.map_err(|error| format!("Could not verify {}: {error}", destination.display()))?;

				if source.size() != destination_metadata.len() {
					changed.push(planned);
					continue;
				}

				let mut destination_file = File::open(&destination)
					.map_err(|error| format!("Could not verify {}: {error}", destination.display()))?;
				let source_label = format!("ZIP entry {}", manifest_file.relative_path.display());

				if readers_are_equal(
					&mut source,
					&mut destination_file,
					&source_label,
					&destination.display().to_string(),
				)? {
					unchanged_paths.push(planned.destination_relative_path);
				} else {
					changed.push(planned);
				}
			}
		}
	}

	Ok((
		changed,
		unchanged_paths,
	))
}

