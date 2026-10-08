fn has_root_level_zip_entries(manifest: &OverlayManifest) -> bool {
    manifest.files.iter().any(|file| {
        file.relative_path.parent().is_some_and(|parent| normal_components(parent).is_empty())
    })
}

// File counts alone are not a reliable signal for incremental archives: a
// patch with one existing file and three new siblings can still describe a
// complete, unambiguous project-root mapping.
fn has_coherent_new_file_zip_root_evidence(
    root: &Path,
    candidate: &CandidatePlan,
    manifest: &OverlayManifest,
) -> bool {
    if !matches!(&manifest.kind, ManifestKind::Zip { .. }) || !is_exact_root_candidate(candidate) {
        return false;
    }
    let file_count = manifest.files.len();
    let matched_files = candidate.candidate.matched_files;
    // One accidental shared filename is not enough for a large/foreign ZIP.
    // For new-file-heavy increments, require meaningful exact-file coverage,
    // not a fixed minimum of two existing files.
    if file_count < 2 || matched_files == 0 || matched_files.saturating_mul(4) < file_count {
        return false;
    }
    let Ok(ignore) = ProjectIgnore::load(root) else {
        return false;
    };
    let mut parent_paths = HashSet::new();
    let mut independent_branches = HashSet::new();
    let mut matched_nested_branches = HashSet::new();
    let mut nested_files = 0_usize;
    let mut root_level_files = 0_usize;
    for file in &manifest.files {
        let Some(parent) = file.relative_path.parent() else {
            return false;
        };
        let components = normal_components(parent);
        // ZIPs may include root-level README/checksum files alongside the
        // actual project patch. They have no parent directory to inspect,
        // so they cannot invalidate complete hierarchy evidence from the
        // nested files (nor contribute any positive directory evidence).
        if components.is_empty() {
            root_level_files += 1;
            continue;
        }
        nested_files += 1;
        let expected_depth = components.len();
        // Require *every* intended parent path, not a pooled count that could
        // hide a missing directory behind other deeper paths.
        if count_existing_directory_depth(root, Path::new(""), &file.relative_path, &ignore) != expected_depth {
            return false;
        }
        parent_paths.insert(parent.to_path_buf());
        // The first two levels distinguish independent modules under src/;
        // one-level roots such as docs/ remain valid branches.
        let branch = components.iter().take(2)
            .map(|component| component.to_string_lossy().to_lowercase())
            .collect::<Vec<_>>().join("/");
        if root.join(&file.relative_path).is_file() {
            matched_nested_branches.insert(branch.clone());
        }
        independent_branches.insert(branch);
    }
    // Root-level attachments have no placement evidence. If they are present,
    // demand two distinct exact-file anchors in separate project branches,
    // not two coincidental filenames or one shared README at the ZIP root.
    if root_level_files > 0 && (matched_files < 2 || matched_nested_branches.len() < 2) {
        return false;
    }
    // Every nested file must have its full existing parent chain; independent
    // branches corroborate the original root-relative hierarchy.
    parent_paths.len() >= nested_files.min(3) && independent_branches.len() >= 2
}

// A patch whose two payload files are both NEW can still be unambiguously
// rooted: every declared parent directory is already present in the selected
// project, in separate branches, with at least one deeper (3+ levels) branch.
// Generic top-level scaffolding alone (e.g. docs/ + tests/) is not enough.
// Never infer a destructive destination from directory-only evidence.
fn has_complete_new_zip_root_directory_evidence(
    root: &Path,
    candidate: &CandidatePlan,
    manifest: &OverlayManifest,
) -> bool {
    if !matches!(&manifest.kind, ManifestKind::Zip { .. }) ||
        !is_exact_root_candidate(candidate) ||
        candidate.candidate.matched_files != 0 ||
        manifest.files.len() < 2 ||
        !manifest.delete_paths.is_empty() ||
        !manifest.delete_directories.is_empty() ||
        !manifest.permanent_delete_directories.is_empty()
    {
        return false;
    }
    let Ok(ignore) = ProjectIgnore::load(root) else {
        return false;
    };
    let mut parents = HashSet::new();
    let mut branches = HashSet::new();
    let mut has_deep_branch = false;
    for file in &manifest.files {
        let Some(parent) = file.relative_path.parent() else {
            return false;
        };
        let components = normal_components(parent);
        if components.is_empty() ||
            count_existing_directory_depth(root, Path::new(""), &file.relative_path, &ignore) != components.len()
        {
            return false;
        }
        parents.insert(parent.to_path_buf());
        has_deep_branch |= components.len() >= 3;
        branches.insert(components.iter().take(2)
            .map(|component| component.to_string_lossy().to_lowercase())
            .collect::<Vec<_>>().join("/"));
    }
    parents.len() >= 2 && branches.len() >= 2 && has_deep_branch
}

fn has_competing_routing_mappings(
    candidate: &CandidatePlan,
    candidates: &[CandidatePlan],
) -> bool {
    candidates.iter().any(|other| other.mapping_key != candidate.mapping_key)
}

fn is_new_file_heavy_root_evidence(
    root: &Path,
    candidate: &CandidatePlan,
    manifest: &OverlayManifest,
) -> bool {
    has_complete_new_zip_root_directory_evidence(root, candidate, manifest) ||
        (has_coherent_new_file_zip_root_evidence(root, candidate, manifest) &&
            candidate.candidate.matched_files < minimum_zip_root_file_matches(manifest.files.len()) &&
            (!has_structurally_anchored_zip_root_evidence(
                candidate,
                manifest.files.len(),
                expected_zip_root_directory_matches(manifest),
            ) || has_root_level_zip_entries(manifest)))
}

fn has_competing_file_mappings(
    candidate: &CandidatePlan,
    candidates: &[CandidatePlan],
) -> bool {
    candidates.iter().any(|other| {
        other.mapping_key != candidate.mapping_key && other.candidate.matched_files > 0
    })
}
