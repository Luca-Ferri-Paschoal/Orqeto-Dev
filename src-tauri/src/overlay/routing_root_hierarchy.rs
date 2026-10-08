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
    for file in &manifest.files {
        let Some(parent) = file.relative_path.parent() else {
            return false;
        };
        let components = normal_components(parent);
        if components.is_empty() {
            return false;
        }
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
        independent_branches.insert(branch);
    }
    // Independent parent branches corroborate the root-relative structure.
    // One generic src/ directory shared by unrelated projects does not.
    parent_paths.len() >= file_count.min(3) && independent_branches.len() >= 2
}

fn is_new_file_heavy_root_evidence(
    root: &Path,
    candidate: &CandidatePlan,
    manifest: &OverlayManifest,
) -> bool {
    has_coherent_new_file_zip_root_evidence(root, candidate, manifest) &&
        candidate.candidate.matched_files < minimum_zip_root_file_matches(manifest.files.len()) &&
        !has_structurally_anchored_zip_root_evidence(
            candidate,
            manifest.files.len(),
            expected_zip_root_directory_matches(manifest),
        )
}

fn has_competing_file_mappings(
    candidate: &CandidatePlan,
    candidates: &[CandidatePlan],
) -> bool {
    candidates.iter().any(|other| {
        other.mapping_key != candidate.mapping_key && other.candidate.matched_files > 0
    })
}
