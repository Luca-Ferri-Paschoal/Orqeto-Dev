// A multi-file ZIP can introduce a new documentation subtree without any
// previously matching filenames. Preserve the declared paths only when the
// new files have one unique, established project parent.
fn coherent_new_zip_subtree_root_evidence(
    root: &Path,
    manifest: &OverlayManifest,
    project_ignore: &ProjectIgnore,
    discovery: &ProjectRoutingDiscovery,
) -> Option<bool> {
    if !matches!(&manifest.kind, ManifestKind::Zip { .. }) ||
        manifest.files.len() < 4 ||
        !manifest.delete_paths.is_empty() ||
        !manifest.delete_directories.is_empty() ||
        !manifest.permanent_delete_directories.is_empty()
    {
        return None;
    }

    // The shortest fully existing parent is the only possible anchor. Require
    // two or more levels; generic top-level names are not sufficient evidence.
    let mut anchor_depth = usize::MAX;
    for file in &manifest.files {
        let parent = file.relative_path.parent()?;
        let parent_depth = normal_components(parent).len();
        if parent_depth < 2 {
            return None;
        }
        let matched_depth = count_existing_directory_depth(
            root,
            Path::new(""),
            &file.relative_path,
            project_ignore,
        );
        if matched_depth < 2 || parent_depth.saturating_sub(matched_depth) > 1 {
            return None;
        }
        anchor_depth = anchor_depth.min(matched_depth);
    }

    let first_parent = manifest.files.first()?.relative_path.parent()?;
    let mut anchor = PathBuf::new();
    for component in normal_components(first_parent).iter().take(anchor_depth) {
        anchor.push(component);
    }
    if normal_components(&anchor).len() != anchor_depth {
        return None;
    }

    let mut root_files = 0_usize;
    let mut new_subtree_files = 0_usize;
    let mut new_branch = None::<PathBuf>;
    for file in &manifest.files {
        let parent = file.relative_path.parent()?;
        let parent_parts = normal_components(parent);
        if !parent.starts_with(&anchor) || parent_parts.len() > anchor_depth + 1 {
            return None;
        }
        if parent_parts.len() == anchor_depth {
            root_files += 1;
            continue;
        }
        let branch = parent.to_path_buf();
        match fs::symlink_metadata(root.join(&branch)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            _ => return None,
        }
        if new_branch.as_ref().is_some_and(|previous| previous != &branch) {
            return None;
        }
        new_branch = Some(branch);
        new_subtree_files += 1;
    }
    if root_files == 0 || new_subtree_files < 3 || new_branch.is_none() {
        return None;
    }

    // A preexisting sibling file distinguishes a real project namespace from
    // an empty, generic directory scaffold. Do not follow links as evidence.
    let Ok(entries) = fs::read_dir(root.join(&anchor)) else {
        return None;
    };
    let mut has_existing_sibling = false;
    for entry in entries {
        let Ok(entry) = entry else {
            return None;
        };
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            return None;
        };
        if metadata.is_file() && !safe_fs::metadata_is_link_or_reparse(&metadata) &&
            !project_ignore.is_ignored(&entry.path(), false) {
            has_existing_sibling = true;
            break;
        }
    }
    if !has_existing_sibling {
        return None;
    }

    let anchor_segments = normal_components(&anchor).iter()
        .map(|part| part.to_string_lossy().to_lowercase())
        .collect::<Vec<_>>();
    let name = anchor_segments.last()?;
    // A second copy of the complete anchor hierarchy is a genuine ambiguous
    // destination, even if its new child directory does not yet exist.
    Some(!discovery.directory_matches.get(name).is_some_and(|matches| {
        matches.iter().any(|directory| {
            let segments = normal_components(directory).iter()
                .map(|part| part.to_string_lossy().to_lowercase())
                .collect::<Vec<_>>();
            segments != anchor_segments && segments.ends_with(&anchor_segments)
        })
    }))
}

// An incremental ZIP can update one deeply nested file and introduce a few
// siblings. The exact, unique existing filename plus the entire established
// parent chain certifies ROOT; repeated names of intermediate directories do
// not constitute alternative file destinations.
fn unique_existing_zip_anchor_root_evidence(
    root: &Path,
    manifest: &OverlayManifest,
    project_ignore: &ProjectIgnore,
    discovery: &ProjectRoutingDiscovery,
) -> Option<bool> {
    if !matches!(&manifest.kind, ManifestKind::Zip { .. }) ||
        !(2..=4).contains(&manifest.files.len()) ||
        !manifest.delete_paths.is_empty() ||
        !manifest.delete_directories.is_empty() ||
        !manifest.permanent_delete_directories.is_empty()
    {
        return None;
    }

    let mut common_parent = None::<&Path>;
    let mut existing_file = None::<&Path>;
    let mut new_files = 0_usize;
    for file in &manifest.files {
        let parent = file.relative_path.parent()?;
        let depth = normal_components(parent).len();
        // Generic src/components or docs/ folders cannot certify ownership.
        if depth < 4 || common_parent.is_some_and(|previous| previous != parent) ||
            count_existing_directory_depth(root, Path::new(""), &file.relative_path, project_ignore) != depth
        {
            return None;
        }
        common_parent = Some(parent);
        let destination = root.join(&file.relative_path);
        match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_file() &&
                !safe_fs::metadata_is_link_or_reparse(&metadata) &&
                !project_ignore.is_ignored(&destination, false) => {
                    if existing_file.replace(file.relative_path.as_path()).is_some() {
                        return None;
                    }
                },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => new_files += 1,
            _ => return None,
        }
    }
    let existing_file = existing_file?;
    if new_files == 0 {
        return None;
    }

    // Discovery excludes ignored entries and reparse points. Another file
    // with the exact same basename remains a real uncertainty, even when
    // a deep path looks promising. Never infer unique file identity from
    // many coincidental directory matches.
    Some(discovery.file_matches.len() == 1 && discovery.file_matches[0].as_path() == existing_file)
}
