fn build_candidates(
	root: &Path,
	manifest: &OverlayManifest,
) -> Result<CandidateBuildResult, String> {
	let target_names = candidate_target_names(manifest);
	let target_file_name = match &manifest.kind {
		ManifestKind::File { source_name, .. } => Some(source_name.as_str()),
		_ => None,
	};
	let project_ignore = ProjectIgnore::load(root)?;
	let discovery = collect_project_routing_discovery(
		root,
		&target_names,
		target_file_name,
		&project_ignore,
	)?;
	let project_matches = &discovery.directory_matches;
	let mut seeds = Vec::new();
	seeds.push(CandidateSeed {
		destination_relative_path: PathBuf::new(),
		source_prefix: PathBuf::new(),
		source_context_matches_override: None,
		is_named_destination: false,
		zip_named_prefix_depth: None,
	});

	match &manifest.kind {
		ManifestKind::Directory {
			source_context,
			source_components,
			source_name,
			..
		} => {
			if let Some(destinations) = project_matches.get(&source_name.to_lowercase()) {
				for destination in destinations {
					seeds.push(CandidateSeed {
						destination_relative_path: destination.clone(),
						source_prefix: PathBuf::new(),
						source_context_matches_override: None,
						is_named_destination: true,
						zip_named_prefix_depth: None,
					});
				}
			}

			let source_end = source_context.len().saturating_sub(1);
			let source_start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for source_index in source_start..source_end {
				let ancestor_name = &source_context[source_index];
				let Some(destinations) = project_matches.get(ancestor_name) else {
					continue;
				};

				for destination in destinations {
					let project_context = path_segments(&root.join(destination));
					let context_matches = tail_match_count(
						&source_context[..=source_index],
						&project_context,
					);

					if context_matches < 2 {
						continue;
					}

					let mut derived_destination = destination.clone();
					for component in &source_components[source_index + 1..] {
						derived_destination.push(component);
					}
					seeds.push(CandidateSeed {
						destination_relative_path: derived_destination,
						source_prefix: PathBuf::new(),
						source_context_matches_override: Some(context_matches),
						is_named_destination: false,
						zip_named_prefix_depth: None,
					});
				}
			}
		}
		ManifestKind::File {
			source_context,
			source_components,
			..
		} => {
			for file_match in &discovery.file_matches {
				let destination = file_match
					.parent()
					.unwrap_or_else(|| Path::new(""))
					.to_path_buf();
				let project_context = path_segments(&root.join(&destination));
				let context_matches = tail_match_count(
					source_context,
					&project_context,
				);
				seeds.push(CandidateSeed {
					destination_relative_path: destination,
					source_prefix: PathBuf::new(),
					source_context_matches_override: Some(context_matches),
					is_named_destination: true,
					zip_named_prefix_depth: None,
				});
			}

			let source_start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);
			for source_index in source_start..source_context.len() {
				let ancestor_name = &source_context[source_index];
				let Some(destinations) = project_matches.get(ancestor_name) else {
					continue;
				};

				for destination in destinations {
					let project_context = path_segments(&root.join(destination));
					let context_matches = tail_match_count(
						&source_context[..=source_index],
						&project_context,
					);
					if context_matches < 2 {
						continue;
					}

					let mut derived_destination = destination.clone();
					for component in &source_components[source_index + 1..] {
						derived_destination.push(component);
					}
					seeds.push(CandidateSeed {
						destination_relative_path: derived_destination,
						source_prefix: PathBuf::new(),
						source_context_matches_override: Some(context_matches),
						is_named_destination: false,
						zip_named_prefix_depth: None,
					});
				}
			}
		}
		ManifestKind::Zip { .. } => {
			for prefix in &manifest.common_directory_prefixes {
				seeds.push(CandidateSeed {
					destination_relative_path: PathBuf::new(),
					source_prefix: prefix.clone(),
					source_context_matches_override: None,
					is_named_destination: false,
					zip_named_prefix_depth: None,
				});

				let prefix_components = normal_components(prefix);
				let prefix_context = prefix_components
					.iter()
					.map(|component| component.to_string_lossy().to_lowercase())
					.collect::<Vec<_>>();
				let prefix_depth = prefix_context.len();
				let Some(name) = prefix.file_name() else {
					continue;
				};
				let normalized_name = name.to_string_lossy().to_lowercase();

				if let Some(destinations) = project_matches.get(&normalized_name) {
					for destination in destinations {
						seeds.push(CandidateSeed {
							destination_relative_path: destination.clone(),
							source_prefix: prefix.clone(),
							source_context_matches_override: None,
							is_named_destination: true,
							zip_named_prefix_depth: Some(prefix_depth),
						});
					}
				}

				for source_index in 0..prefix_context.len() {
					let ancestor_name = &prefix_context[source_index];
					let Some(destinations) = project_matches.get(ancestor_name) else {
						continue;
					};

					for destination in destinations {
						let project_context = path_segments(&root.join(destination));
						let context_matches = tail_match_count(
							&prefix_context[..=source_index],
							&project_context,
						);
						if context_matches < 2 {
							continue;
						}

						let mut derived_destination = destination.clone();
						for component in &prefix_components[source_index + 1..] {
							derived_destination.push(component);
						}
						seeds.push(CandidateSeed {
							destination_relative_path: derived_destination,
							source_prefix: prefix.clone(),
							source_context_matches_override: Some(context_matches),
							is_named_destination: source_index + 1 == prefix_context.len(),
							zip_named_prefix_depth: None,
						});
					}
				}
			}
		}
	}

	let mut seeds = deduplicate_candidate_seeds(seeds);
	let discovered_seed_count = seeds.len();
	let validation_limit_exceeded = discovered_seed_count > MAX_ROUTING_CANDIDATE_VALIDATIONS;

	if validation_limit_exceeded {
		seeds.retain(seed_is_exact_root);
	}

	let candidates = seeds
		.into_iter()
		.filter_map(|seed| candidate_from_seed(
			root,
			manifest,
			&project_ignore,
			seed,
		))
		.collect::<Vec<_>>();

	Ok(CandidateBuildResult {
		candidates: deduplicate_candidates(candidates),
		discovered_seed_count,
		validation_limit_exceeded,
	})
}

