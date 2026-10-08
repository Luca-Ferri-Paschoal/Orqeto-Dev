#[test]
fn br_route_002_taurus_p6431_one_existing_file_and_three_new_routes_to_root() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-P6_4_31-certified-reselection-pending-click-hotfix-incremental.zip");
    let root = temp.path.join("taurus-project");
    // The four actual paths in the reported P6.4.31 ZIP: 1 exact file,
    // 8 existing parent-directory matches, and no relocation ambiguity.
    let entries = [
        ("src/components/MapEditor.tsx", "new map editor"),
        ("src/lib/selection-engine/certifiedSupersessionWitness.ts", "new witness"),
        ("tests/selection/p6-4-31-certified-reselection-continuity.test.ts", "new test"),
        ("docs/P6_4_31_CERTIFIED_RESELECTION_CONTINUITY.md", "new docs"),
    ];
    write_test_zip(&archive, &entries);
    for (index, (path, contents)) in entries.iter().enumerate() {
        let destination = root.join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        if index == 0 {
            write_test_file(&destination, contents);
        }
    }
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert!(!prepared.ambiguity_limit_exceeded);
    assert_eq!(prepared.file_count, 4);
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates.len(), 1);
    assert_eq!(prepared.candidates[0].destination_relative_path, "./");
    assert_eq!(prepared.candidates[0].source_prefix, "");
    assert_eq!(prepared.candidates[0].matched_files, 1);
    assert_eq!(prepared.candidates[0].matched_directories, 8);
}

#[test]
fn br_route_002_single_file_does_not_override_missing_patch_parent_hierarchy() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("incoming.zip");
    let root = temp.path.join("unrelated-project");
    let entries = [
        ("src/components/MapEditor.tsx", "map"),
        ("src/lib/selection-engine/certifiedSupersessionWitness.ts", "witness"),
        ("tests/selection/p6-4-31-certified-reselection-continuity.test.ts", "test"),
        ("docs/P6_4_31_CERTIFIED_RESELECTION_CONTINUITY.md", "docs"),
    ];
    write_test_zip(&archive, &entries);
    write_test_file(&root.join(entries[0].0), "original");
    // Only generic src/, tests/, docs/ scaffolding exists. The distinctive
    // selection-engine branch is absent and must not be fabricated by Apply.
    for path in ["src/lib", "tests/selection", "docs"] {
        fs::create_dir_all(root.join(path)).unwrap();
    }
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
    assert!(prepared.candidates.is_empty());
    assert!(prepared.root_candidate.is_some());
}

#[test]
fn br_route_002_single_file_in_one_generic_tree_cannot_force_root() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("incoming.zip");
    let root = temp.path.join("unrelated-project");
    let entries = [
        ("src/components/MapEditor.tsx", "map"),
        ("src/components/MapPreview.tsx", "preview"),
        ("src/components/MapPalette.tsx", "palette"),
        ("src/components/MapOptions.tsx", "options"),
    ];
    write_test_zip(&archive, &entries);
    write_test_file(&root.join(entries[0].0), "original");
    let (canonical_root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let built = build_candidates(&canonical_root, &manifest).unwrap();
    let exact = built.candidates.iter().find(|plan| is_exact_root_candidate(plan)).unwrap();
    assert!(!has_coherent_new_file_zip_root_evidence(&canonical_root, exact, &manifest));
}

#[test]
fn br_route_002_one_of_six_generic_matches_still_requires_user_confirmation() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("incoming.zip");
    let root = temp.path.join("unrelated-project");
    let entries = [
        ("src/features/context/api.ts", "api"),
        ("src/features/context/types.ts", "types"),
        ("src/shared/components/Button/index.tsx", "button"),
        ("src/shared/components/Button/style.ts", "style"),
        ("scripts/check.mts", "check"),
        ("src-tauri/src/lib.rs", "lib"),
    ];
    write_test_zip(&archive, &entries);
    for (index, (path, content)) in entries.iter().enumerate() {
        let destination = root.join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        if index == 1 { write_test_file(&destination, content); }
    }
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
    assert!(prepared.candidates.is_empty());
}

#[test]
fn br_route_002_single_file_root_with_competing_mapping_requires_resolution() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-incremental.zip");
    let root = temp.path.join("taurus-project");
    let entries = [
        ("src/components/MapEditor.tsx", "map"),
        ("src/lib/selection-engine/witness.ts", "witness"),
        ("tests/selection/witness.test.ts", "test"),
        ("docs/WITNESS.md", "docs"),
    ];
    write_test_zip(&archive, &entries);
    for (index, (path, content)) in entries.iter().enumerate() {
        let destination = root.join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        if index == 0 { write_test_file(&destination, content); }
    }
    let (root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let mut candidates = build_candidates(&root, &manifest).unwrap().candidates;
    let rooted = candidates.iter().find(|candidate| is_exact_root_candidate(candidate))
        .expect("ROOT must be a routing candidate").clone();
    assert!(is_new_file_heavy_root_evidence(&root, &rooted, &manifest));
    let mut relocated = rooted.clone();
    relocated.destination_relative_path = PathBuf::from("relocated");
    relocated.candidate.destination_relative_path = "relocated".to_string();
    relocated.mapping_key = rooted.mapping_key.iter().map(|key| format!("relocated/{key}")).collect();
    relocated.score = rooted.score + 1;
    candidates = vec![relocated, rooted];
    assert_eq!(recommended_candidate_index(&root, &candidates, &manifest), None);
}

#[test]
fn br_route_002_two_file_incremental_one_exact_and_two_existing_branches() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-hotfix.zip");
    let root = temp.path.join("taurus-project");
    let entries = [
        ("src/components/MapEditor.tsx", "update"),
        ("src/lib/selection-engine/newWitness.ts", "create"),
    ];
    write_test_zip(&archive, &entries);
    write_test_file(&root.join(entries[0].0), "old");
    fs::create_dir_all(root.join("src/lib/selection-engine")).unwrap();
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates[0].matched_files, 1);
    assert_eq!(prepared.candidates[0].matched_directories, 5);
}

#[test]
fn br_route_002_p6435_all_new_files_in_complete_root_hierarchy_apply_without_modal() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-P6_4_35-field-replay-diagnostics-NOT-APP-PATCH.zip");
    let root = temp.path.join("taurus-project");
    // Same paths and parent depths as the reported real ZIP. Both files are new,
    // so evidence is 0 exact files + 4 existing parent directories.
    let entries = [
        ("docs/P6_4_35_FIELD_REPLAY_HANDOFF.md", "handoff"),
        ("tests/selection/fixtures/p6435-field-road-closures.json", "{}"),
    ];
    write_test_zip(&archive, &entries);
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::create_dir_all(root.join("tests/selection/fixtures")).unwrap();

    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.file_count, 2);
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates.len(), 1);
    assert_eq!(prepared.candidates[0].destination_relative_path, "./");
    assert_eq!(prepared.candidates[0].source_prefix, "");
    assert_eq!(prepared.candidates[0].matched_files, 0);
    assert_eq!(prepared.candidates[0].matched_directories, 4);
}

#[test]
fn br_route_002_all_new_files_missing_parent_branch_still_require_confirmation() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-new-files.zip");
    let root = temp.path.join("taurus-project");
    write_test_zip(&archive, &[
        ("docs/P6_4_35_FIELD_REPLAY_HANDOFF.md", "handoff"),
        ("tests/selection/fixtures/p6435-field-road-closures.json", "{}"),
    ]);
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::create_dir_all(root.join("tests/selection")).unwrap(); // Missing fixtures/
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
    assert!(prepared.root_candidate.is_some());
}

#[test]
fn br_route_002_all_new_files_generic_shallow_directories_do_not_force_root() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("unrelated-new-files.zip");
    let root = temp.path.join("unrelated-project");
    write_test_zip(&archive, &[
        ("docs/new.md", "docs"),
        ("tests/new.json", "{}"),
    ]);
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::create_dir_all(root.join("tests")).unwrap();
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
}

#[test]
fn br_route_002_all_new_files_with_competing_mapping_keep_manual_resolution() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-new-files.zip");
    let root = temp.path.join("taurus-project");
    write_test_zip(&archive, &[
        ("docs/P6_4_35_FIELD_REPLAY_HANDOFF.md", "handoff"),
        ("tests/selection/fixtures/p6435-field-road-closures.json", "{}"),
    ]);
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::create_dir_all(root.join("tests/selection/fixtures")).unwrap();
    let (root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let mut candidates = build_candidates(&root, &manifest).unwrap().candidates;
    let rooted = candidates.iter().find(|candidate| is_exact_root_candidate(candidate))
        .unwrap().clone();
    assert!(has_complete_new_zip_root_directory_evidence(&root, &rooted, &manifest));
    let mut relocated = rooted.clone();
    relocated.destination_relative_path = PathBuf::from("other-subproject");
    relocated.candidate.destination_relative_path = "other-subproject".to_string();
    relocated.mapping_key = rooted.mapping_key.iter().map(|key| format!("other-subproject/{key}")).collect();
    relocated.score = rooted.score + 1;
    candidates = vec![relocated, rooted];
    assert_eq!(recommended_candidate_index(&root, &candidates, &manifest), None);
}
