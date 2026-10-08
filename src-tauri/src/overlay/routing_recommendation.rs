fn recommended_candidate_index(
	root: &Path,
	candidates: &[CandidatePlan],
	manifest: &OverlayManifest,
) -> Option<usize> {
	// New-file-only ROOT confidence is directory-based. Any distinct valid
	// mapping means the user must decide, even if ROOT has more directory hits.
	if candidates.iter().any(|candidate| {
		has_complete_new_zip_root_directory_evidence(root, candidate, manifest) &&
			has_competing_routing_mappings(candidate, candidates)
	}) {
		return None;
	}

	// A ZIP produced for Orqeto declares ROOT-relative paths. Once the exact
	// ROOT mapping has strong real file evidence, preserve those declared paths
	// instead of letting an equally plausible source-prefix relocation turn the
	// same project into an unnecessary destination decision. Routing considers
	// only the explicitly selected project; weaker new-file-heavy root evidence
	// must not override a competing file mapping.
	if let Some(index) = strong_exact_zip_root_match_index(
		root,
		candidates,
		manifest,
	) {
		return Some(index);
	}

	// A weakly anchored ROOT may be valid, but if another actual file mapping
	// exists then choosing either one would be a real ambiguity.
	if let Some(root_candidate) = candidates.iter().find(|candidate| {
		is_exact_root_candidate(candidate) &&
			is_new_file_heavy_root_evidence(root, candidate, manifest)
	}) {
		if has_competing_file_mappings(root_candidate, candidates) {
			return None;
		}
	}

	let top = candidates.first()?;
	let second = candidates.get(1);
	let has_evidence = top.candidate.matched_files > 0 ||
		top.candidate.matched_directories > 0 ||
		top.candidate.source_context_matches > 0 ||
		top.is_named_destination;

	if !has_evidence {
		return None;
	}

	let Some(second_candidate) = second else {
		return Some(0);
	};

	if top.candidate.source_context_matches >= 3 &&
		top.candidate.source_context_matches > second_candidate.candidate.source_context_matches
	{
		return Some(0);
	}

	if top.candidate.matched_files >= 2 &&
		top.candidate.matched_files > second_candidate.candidate.matched_files
	{
		return Some(0);
	}

	if top.is_named_destination &&
		!second_candidate.is_named_destination &&
		top.candidate.matched_files >= second_candidate.candidate.matched_files &&
		top.candidate.matched_directories >= second_candidate.candidate.matched_directories
	{
		return Some(0);
	}

	if top.score >= second_candidate.score.saturating_add(40) &&
		(
			top.candidate.matched_files > 0 ||
			top.candidate.source_context_matches >= 2
		)
	{
		return Some(0);
	}

	None
}

