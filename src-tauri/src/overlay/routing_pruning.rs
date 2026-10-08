fn prune_weak_candidates(
	root: &Path,
	candidates: Vec<CandidatePlan>,
	manifest: &OverlayManifest,
) -> Vec<CandidatePlan> {
	let strongest_context = candidates
		.iter()
		.filter(|candidate| !is_exact_root_candidate(candidate))
		.map(|candidate| candidate.candidate.source_context_matches)
		.max()
		.unwrap_or(0);
	let minimum_context = if strongest_context >= 3 {
		strongest_context.saturating_sub(1)
	} else {
		strongest_context
	};
	let has_non_root_evidence = candidates.iter().any(|candidate| {
		!is_exact_root_candidate(candidate) &&
			(
				candidate.is_named_destination ||
				candidate.candidate.matched_files > 0 ||
				candidate.candidate.matched_directories > 0 ||
				candidate.candidate.source_context_matches > 0
			)
	});

	candidates
		.into_iter()
		.filter(|candidate| {
			if is_exact_root_candidate(candidate) {
				if matches!(&manifest.kind, ManifestKind::Zip { .. }) {
					return has_strong_zip_root_evidence(
						root,
						candidate,
						manifest,
					);
				}

				return candidate.candidate.matched_files > 0 ||
					candidate.candidate.matched_directories > 0 ||
					!has_non_root_evidence;
			}

			if candidate.candidate.matched_files > 0 {
				return true;
			}

			// A ZIP wrapper stripped onto a project root can share generic folders
			// such as `src/` with many unrelated projects. Directory overlap by
			// itself is not enough to make that project a concrete routing choice.
			// Keep zero-file ZIP candidates only when discovery also found semantic
			// source context or an explicitly named destination.
			if matches!(&manifest.kind, ManifestKind::Zip { .. }) {
				return candidate.is_named_destination ||
					candidate.candidate.source_context_matches > 0;
			}

			if strongest_context >= 2 {
				return candidate.candidate.source_context_matches >= minimum_context.max(2);
			}

			candidate.is_named_destination ||
				candidate.candidate.source_context_matches > 0 ||
				candidate.candidate.matched_directories > 0
		})
		.collect()
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct CandidateSeed {
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	source_context_matches_override: Option<usize>,
	is_named_destination: bool,
	zip_named_prefix_depth: Option<usize>,
}

struct CandidateBuildResult {
	candidates: Vec<CandidatePlan>,
	discovered_seed_count: usize,
	validation_limit_exceeded: bool,
}

fn deduplicate_candidate_seeds(seeds: Vec<CandidateSeed>) -> Vec<CandidateSeed> {
	let mut unique = HashSet::<CandidateSeed>::new();
	unique.extend(seeds);
	let mut values = unique.into_iter().collect::<Vec<_>>();
	values.sort_by(|left, right| {
		left.destination_relative_path
			.cmp(&right.destination_relative_path)
			.then_with(|| left.source_prefix.cmp(&right.source_prefix))
			.then_with(|| {
				left.source_context_matches_override
					.cmp(&right.source_context_matches_override)
			})
			.then_with(|| left.is_named_destination.cmp(&right.is_named_destination))
			.then_with(|| left.zip_named_prefix_depth.cmp(&right.zip_named_prefix_depth))
	});
	values
}

fn seed_is_exact_root(seed: &CandidateSeed) -> bool {
	seed.destination_relative_path.as_os_str().is_empty() &&
		seed.source_prefix.as_os_str().is_empty()
}

fn candidate_from_seed(
	root: &Path,
	manifest: &OverlayManifest,
	project_ignore: &ProjectIgnore,
	seed: CandidateSeed,
) -> Option<CandidatePlan> {
	let zip_named_prefix_depth = seed.zip_named_prefix_depth;
	let candidate = build_candidate_plan(
		root,
		manifest,
		seed.destination_relative_path,
		seed.source_prefix,
		project_ignore,
		seed.source_context_matches_override,
		seed.is_named_destination,
	)?;

	if let Some(prefix_depth) = zip_named_prefix_depth {
		let has_enough_context = prefix_depth <= 1 ||
			candidate.candidate.source_context_matches >= 2 ||
			candidate.candidate.matched_files > 0 ||
			candidate.candidate.matched_directories >= 2;

		if !has_enough_context {
			return None;
		}
	}

	Some(candidate)
}

