fn prepare_overlay_manifest(
	root: &Path,
	manifest: &OverlayManifest,
) -> Result<PrepareProjectOverlayResult, String> {
	let source_fingerprint = manifest_source_fingerprint(manifest)?;

	if manifest.files.is_empty() {
		if manifest.delete_paths.is_empty() && manifest.delete_directories.is_empty() && manifest.permanent_delete_directories.is_empty() {
			return Err("No files were found to apply or delete.".to_string());
		}

		let root_candidate = OverlayDestinationCandidate {
			destination_relative_path: "./".to_string(),
			source_prefix: String::new(),
			matched_files: 0,
			matched_directories: 0,
			source_context_matches: 0,
		};
		let candidates = vec![root_candidate.clone()];
		let routing_fingerprint = overlay_routing_fingerprint(
			root,
			&source_fingerprint,
			&candidates,
			Some(&root_candidate),
			Some(0),
			1,
			false,
		)?;

		return Ok(PrepareProjectOverlayResult {
			file_count: 0,
			delete_count: manifest.delete_paths.len() + manifest.delete_directories.len() + manifest.permanent_delete_directories.len(),
			permanent_delete_paths: manifest.permanent_delete_directories.iter().map(|path| path.to_string_lossy().replace('\\', "/")).collect(),
			candidates,
			root_candidate: Some(root_candidate),
			recommended_candidate_index: Some(0),
			candidate_count: 1,
			ambiguity_limit: MAX_AMBIGUOUS_DESTINATIONS,
			ambiguity_limit_exceeded: false,
			source_fingerprint,
			routing_fingerprint,
		});
	}

	let candidate_build = build_candidates(
		root,
		manifest,
	)?;
	let root_candidate = candidate_build
		.candidates
		.iter()
		.find(|candidate| is_exact_root_candidate(candidate))
		.map(|candidate| candidate.candidate.clone());
	let mut candidates = prune_weak_candidates(
		root,
		candidate_build.candidates,
		manifest,
	);

	let mut recommended = if candidate_build.validation_limit_exceeded {
		// Candidate discovery may overflow because a project contains many
		// repeated generic directory names. That overflow must not hide an
		// independently proven strong exact ROOT mapping. The exact ROOT seed is
		// always validated, so majority exact-file coverage remains sufficient to
		// resolve this project even when weaker relocation seeds were not all
		// validated.
		strong_exact_zip_root_match_index(root, &candidates, manifest).filter(|index| {
			// When discovery was truncated, do not treat one existing file
			// as proof that no unseen relocation mapping exists.
			!is_new_file_heavy_root_evidence(root, &candidates[*index], manifest)
		})
	} else {
		recommended_candidate_index(
			root,
			&candidates,
			manifest,
		)
	};

	if let Some(index) = recommended {
		if index != 0 {
			candidates.swap(
				0,
				index,
			);
			recommended = Some(0);
		}
	}

	let candidate_count = if candidate_build.validation_limit_exceeded {
		candidate_build.discovered_seed_count.max(candidates.len())
	} else {
		candidates.len()
	};
	let unresolved_validation_overflow = candidate_build.validation_limit_exceeded &&
		recommended.is_none();
	let ambiguity_limit_exceeded = unresolved_validation_overflow ||
		(
			recommended.is_none() &&
				candidate_count > MAX_AMBIGUOUS_DESTINATIONS
		);
	let routing_candidates = candidates
		.iter()
		.map(|candidate| candidate.candidate.clone())
		.collect::<Vec<_>>();
	let serialized = if ambiguity_limit_exceeded {
		Vec::new()
	} else {
		routing_candidates
			.iter()
			.take(MAX_AMBIGUOUS_DESTINATIONS)
			.cloned()
			.collect::<Vec<_>>()
	};
	let recommended = recommended.filter(|index| *index < MAX_AMBIGUOUS_DESTINATIONS);
	let routing_fingerprint = overlay_routing_fingerprint(
		root,
		&source_fingerprint,
		&routing_candidates,
		root_candidate.as_ref(),
		recommended,
		candidate_count,
		ambiguity_limit_exceeded,
	)?;

	Ok(PrepareProjectOverlayResult {
		file_count: manifest.files.len(),
		delete_count: manifest.delete_paths.len() + manifest.delete_directories.len() + manifest.permanent_delete_directories.len(),
			permanent_delete_paths: manifest.permanent_delete_directories.iter().map(|path| path.to_string_lossy().replace('\\', "/")).collect(),
		candidates: serialized,
		root_candidate,
		recommended_candidate_index: recommended,
		candidate_count,
		ambiguity_limit: MAX_AMBIGUOUS_DESTINATIONS,
		ambiguity_limit_exceeded,
		source_fingerprint,
		routing_fingerprint,
	})
}

fn prepare_project_overlay_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<PrepareProjectOverlayResult, String> {
	let (root, manifest) = build_manifest(
		&root_folder,
		&paths,
	)?;
	prepare_overlay_manifest(
		&root,
		&manifest,
	)
}

