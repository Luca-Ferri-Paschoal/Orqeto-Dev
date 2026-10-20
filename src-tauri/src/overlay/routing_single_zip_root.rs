// A single newly named file can be rooted by its full existing parent chain,
// even when its generic basename occurs in many unrelated directories.
// Unlike basename routing, this proof retains the declared ZIP path verbatim.
fn deep_single_zip_root_hierarchy_evidence(
    root: &Path,
    manifest: &OverlayManifest,
    project_ignore: &ProjectIgnore,
    discovery: &ProjectRoutingDiscovery,
) -> Option<bool> {
    if !matches!(&manifest.kind, ManifestKind::Zip { .. }) ||
        manifest.files.len() != 1 ||
        !manifest.delete_paths.is_empty() ||
        !manifest.delete_directories.is_empty() ||
        !manifest.permanent_delete_directories.is_empty()
    {
        return None;
    }

    let relative = &manifest.files[0].relative_path;
    // This fallback is exclusively for new files. An existing exact ROOT
    // path has stronger file evidence, which must not be vetoed by repeated
    // directory names elsewhere in the project.
    if root.join(relative).is_file() {
        return None;
    }
    let Some(parent) = relative.parent() else {
        return None;
    };
    let components = normal_components(parent);
    // Four existing levels plus an optional new terminal folder distinguish a
    // declared project hierarchy from a generic `src/` or `migrations/` match.
    if components.len() < 5 {
        return None;
    }
    let matched = count_existing_directory_depth(
        root,
        Path::new(""),
        relative,
        project_ignore,
    );
    if matched < 4 || components.len().saturating_sub(matched) > 1 {
        return None;
    }
    let mut anchor = PathBuf::new();
    for component in components.iter().take(matched) {
        anchor.push(component);
    }
    let Some(name) = anchor.file_name() else {
        return None;
    };
    let name = name.to_string_lossy().to_lowercase();
    // The discovery already covers every unignored directory with this name.
    // If another subtree reproduces the entire anchor as a suffix, rooting
    // could target either copy of the same project: keep the manual/limit gate.
    let anchor_segments = normal_components(&anchor).iter()
        .map(|segment| segment.to_string_lossy().to_lowercase())
        .collect::<Vec<_>>();
    Some(!discovery.directory_matches.get(&name).is_some_and(|matches| {
        matches.iter().any(|directory| {
            let segments = normal_components(directory).iter()
                .map(|segment| segment.to_string_lossy().to_lowercase())
                .collect::<Vec<_>>();
            segments != anchor_segments && segments.ends_with(&anchor_segments)
        })
    }))
}
