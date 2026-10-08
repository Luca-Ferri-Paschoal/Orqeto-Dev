fn build_candidate_plan(
	root: &Path,
	manifest: &OverlayManifest,
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	project_ignore: &ProjectIgnore,
	source_context_matches_override: Option<usize>,
	is_named_destination: bool,
) -> Option<CandidatePlan> {
	let mut mapping_key = Vec::with_capacity(manifest.files.len());
	let mut matched_files = 0_usize;
	let mut matched_directories = 0_usize;

	for file in &manifest.files {
		let stripped = strip_source_prefix(
			&file.relative_path,
			&source_prefix,
		)?;
		if stripped.as_os_str().is_empty() {
			return None;
		}
		let destination_relative = destination_relative_path.join(stripped);
		mapping_key.push(
			destination_relative
				.to_string_lossy()
				.replace('\\', "/")
				.to_lowercase(),
		);

		if validate_destination_entry(
			root,
			&destination_relative,
			false,
		)
		.is_err()
		{
			return None;
		}

		let destination = root.join(&destination_relative);

		if project_ignore.is_ignored(
			&destination,
			false,
		) {
			return None;
		}

		if destination.is_file() {
			matched_files += 1;
		}

		matched_directories += count_existing_directory_depth(
			root,
			&destination_relative_path,
			stripped,
			project_ignore,
		);
	}

	let destination_segments = path_segments(&root.join(&destination_relative_path));
	let source_context_matches = source_context_matches_override.unwrap_or_else(|| {
		match &manifest.kind {
			ManifestKind::Directory { source_context, .. } |
			ManifestKind::File { source_context, .. } => tail_match_count(
				source_context,
				&destination_segments,
			),
			ManifestKind::Zip { .. } => {
				let source_segments = path_segments(&source_prefix);
				tail_match_count(
					&source_segments,
					&destination_segments,
				)
			}
		}
	});
	let directory_score = matched_directories.min(24);
	let named_destination_score = if is_named_destination {
		20
	} else {
		0
	};
	let source_prefix_penalty = normal_components(&source_prefix).len() * ZIP_SOURCE_PREFIX_PENALTY_PER_SEGMENT;
	let score = (
		matched_files * 100 +
			directory_score * 8 +
			source_context_matches * 30 +
			named_destination_score
	)
	.saturating_sub(source_prefix_penalty);

	Some(CandidatePlan {
		candidate: OverlayDestinationCandidate {
			destination_relative_path: normalize_relative_display(&destination_relative_path),
			source_prefix: normalize_source_prefix(&source_prefix),
			matched_files,
			matched_directories,
			source_context_matches,
		},
		destination_relative_path,
		source_prefix,
		score,
		mapping_key,
		is_named_destination,
	})
}

fn candidate_target_names(manifest: &OverlayManifest) -> HashSet<String> {
	let mut names = HashSet::new();

	match &manifest.kind {
		ManifestKind::Directory {
			source_context,
			source_name,
			..
		} => {
			names.insert(source_name.to_lowercase());

			let start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for name in &source_context[start..] {
				names.insert(name.clone());
			}
		}
		ManifestKind::File { source_context, .. } => {
			let start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for name in &source_context[start..] {
				names.insert(name.clone());
			}
		}
		ManifestKind::Zip { .. } => {
			for prefix in &manifest.common_directory_prefixes {
				if let Some(name) = prefix.file_name() {
					names.insert(name.to_string_lossy().to_lowercase());
				}
			}
		}
	}

	names
}

fn deduplicate_candidates(candidates: Vec<CandidatePlan>) -> Vec<CandidatePlan> {
	let mut by_mapping = HashMap::<Vec<String>, CandidatePlan>::new();

	for candidate in candidates {
		match by_mapping.get(&candidate.mapping_key) {
			Some(existing) => {
				let existing_is_exact_root = existing.destination_relative_path.as_os_str().is_empty() &&
					existing.source_prefix.as_os_str().is_empty();
				let candidate_is_exact_root = candidate.destination_relative_path.as_os_str().is_empty() &&
					candidate.source_prefix.as_os_str().is_empty();
				let should_replace = if candidate_is_exact_root {
					!existing_is_exact_root
				} else if existing_is_exact_root {
					false
				} else {
					candidate.score > existing.score
				};

				if should_replace {
					by_mapping.insert(
						candidate.mapping_key.clone(),
						candidate,
					);
				}
			}
			None => {
				by_mapping.insert(
					candidate.mapping_key.clone(),
					candidate,
				);
			}
		}
	}

	let mut values = by_mapping.into_values().collect::<Vec<_>>();
	values.sort_by(|left, right| {
		right
			.score
			.cmp(&left.score)
			.then_with(|| right.candidate.matched_files.cmp(&left.candidate.matched_files))
			.then_with(|| {
				left
					.candidate
					.destination_relative_path
					.cmp(&right.candidate.destination_relative_path)
			})
	});
	values
}

fn is_exact_root_candidate(candidate: &CandidatePlan) -> bool {
	candidate.destination_relative_path.as_os_str().is_empty() &&
		candidate.source_prefix.as_os_str().is_empty()
}

fn minimum_zip_root_file_matches(file_count: usize) -> usize {
	// A multi-file root-relative ZIP can share generic trees such as `src/`
	// with unrelated projects. Require a majority of exact file-path matches,
	// and never let one coincidental file identify a multi-file project.
	match file_count {
		0 => 0,
		1 => 1,
		_ => ((file_count / 2) + 1).max(2),
	}
}

fn has_structurally_anchored_zip_root_evidence(
	candidate: &CandidatePlan,
	file_count: usize,
	required_directory_matches: usize,
) -> bool {
	let matched_files = candidate.candidate.matched_files;

	// Larger incremental ZIPs may add slightly more files than they replace.
	// Require substantial exact-file coverage plus existing parent hierarchy.
	let anchored_minimum = minimum_zip_root_file_matches(file_count)
		.saturating_sub(1)
		.max(3);

	// A small ROOT-relative incremental ZIP (4–6 files) may introduce four new
	// files while replacing just two. Two exact full-path matches and the
	// existing parent hierarchy are enough to anchor the mapping in the initiating
	// project without asking to choose ROOT again. A file directly under `docs/`
	// has only one parent level: never demand two matches from that file.
	// Keep single-file coincidences, directory-only matches, and larger archives
	// behind the existing conservative thresholds.
	let compact_incremental = (4..=6).contains(&file_count) && matched_files >= 2;

	(matched_files >= anchored_minimum || compact_incremental) &&
		// Do not let a flat ZIP with only coincidental filenames pass as an
		// anchored project: require at least one parent level per incoming file
		// on average, as well as all of the expected (up to two) parent matches.
		required_directory_matches >= file_count &&
		candidate.candidate.matched_directories >= required_directory_matches
}

fn expected_zip_root_directory_matches(manifest: &OverlayManifest) -> usize {
	manifest.files.iter().map(|file| {
		file.relative_path.parent().map_or(0, |parent| {
			parent.components().take(2).count()
		})
	}).sum()
}

fn has_strong_zip_root_evidence(
	root: &Path,
	candidate: &CandidatePlan,
	manifest: &OverlayManifest,
) -> bool {
	if !matches!(&manifest.kind, ManifestKind::Zip { .. }) ||
		!is_exact_root_candidate(candidate) ||
		manifest.files.is_empty()
	{
		return false;
	}

	let file_count = manifest.files.len();
	candidate.candidate.matched_files >= minimum_zip_root_file_matches(file_count) ||
		has_structurally_anchored_zip_root_evidence(
			candidate,
			file_count,
			expected_zip_root_directory_matches(manifest),
		) || has_coherent_new_file_zip_root_evidence(root, candidate, manifest)
}

fn strong_exact_zip_root_match_index(
	root: &Path,
	candidates: &[CandidatePlan],
	manifest: &OverlayManifest,
) -> Option<usize> {
	candidates.iter().position(|candidate| {
		has_strong_zip_root_evidence(root, candidate, manifest) &&
			!(is_new_file_heavy_root_evidence(root, candidate, manifest) &&
				has_competing_file_mappings(candidate, candidates))
	})
}
