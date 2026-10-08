#[test]
fn br_route_002_p6437_two_exact_files_and_root_metadata_apply_without_modal() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("taurus-P6_4_37-one-ended-road-positive-perimeter-proof-incremental.zip");
    let root = temp.path.join("taurus-project");
    // Exact entry paths from the reported P6.4.37 ZIP: seven files, two
    // existing source files, ten existing parent-directory components, and
    // two extra root-level informational files with no parent directory.
    let entries = [
        ("src/components/MapEditor.tsx", "updated map"),
        ("src/workers/singleFaceSelection.worker.ts", "updated worker"),
        ("src/lib/selection-engine/singleEndedInteriorRoadProof.ts", "new proof"),
        ("tests/selection/p6-4-37-single-ended-road-proof.test.ts", "new test"),
        ("docs/P6_4_37_SINGLE_ENDED_ROAD_PROOF.md", "new docs"),
        ("README_APLICACAO.txt", "how to apply"),
        ("SHA256SUMS.txt", "checksums"),
    ];
    write_test_zip(&archive, &entries);
    for (index, (path, content)) in entries.iter().enumerate() {
        if index < 5 {
            fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
        }
        if index < 2 {
            write_test_file(&root.join(path), content);
        }
    }
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.file_count, 7);
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates.len(), 1);
    assert_eq!(prepared.candidates[0].destination_relative_path, "./");
    assert_eq!(prepared.candidates[0].source_prefix, "");
    assert_eq!(prepared.candidates[0].matched_files, 2);
    assert_eq!(prepared.candidates[0].matched_directories, 10);
}

#[test]
fn br_route_002_p6437_missing_nested_parent_still_requires_confirmation() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("mixed-incremental.zip");
    let root = temp.path.join("project");
    let entries = [
        ("src/components/MapEditor.tsx", "updated map"),
        ("src/workers/singleFaceSelection.worker.ts", "updated worker"),
        ("src/lib/selection-engine/singleEndedInteriorRoadProof.ts", "new proof"),
        ("tests/selection/p6-4-37-single-ended-road-proof.test.ts", "new test"),
        ("docs/P6_4_37_SINGLE_ENDED_ROAD_PROOF.md", "new docs"),
        ("README_APLICACAO.txt", "how to apply"),
        ("SHA256SUMS.txt", "checksums"),
    ];
    write_test_zip(&archive, &entries);
    write_test_file(&root.join(entries[0].0), "old map");
    write_test_file(&root.join(entries[1].0), "old worker");
    // The distinctive selection-engine directory is missing; matching src/
    // and the two exact files must not fabricate it.
    fs::create_dir_all(root.join("src/lib")).unwrap();
    fs::create_dir_all(root.join("tests/selection")).unwrap();
    fs::create_dir_all(root.join("docs")).unwrap();
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
    assert!(prepared.root_candidate.is_some());
}

#[test]
fn br_route_002_root_metadata_and_single_nested_anchor_are_insufficient() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("foreign.zip");
    let root = temp.path.join("unrelated-project");
    let entries = [
        ("src/components/MapEditor.tsx", "new map"),
        ("src/lib/selection-engine/newProof.ts", "new proof"),
        ("tests/selection/new-test.ts", "new test"),
        ("docs/new-doc.md", "new docs"),
        ("README_APLICACAO.txt", "readme"),
    ];
    write_test_zip(&archive, &entries);
    for (path, _) in entries.iter().take(4) {
        fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
    }
    write_test_file(&root.join(entries[0].0), "old map");
    write_test_file(&root.join(entries[4].0), "unrelated readme");
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
    assert!(prepared.root_candidate.is_some());
}

#[test]
fn br_route_002_p6437_competing_existing_file_mapping_requires_review() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("mixed-incremental.zip");
    let root = temp.path.join("project");
    let entries = [
        ("src/components/MapEditor.tsx", "updated map"),
        ("src/workers/singleFaceSelection.worker.ts", "updated worker"),
        ("src/lib/selection-engine/singleEndedInteriorRoadProof.ts", "new proof"),
        ("tests/selection/p6-4-37-single-ended-road-proof.test.ts", "new test"),
        ("docs/P6_4_37_SINGLE_ENDED_ROAD_PROOF.md", "new docs"),
        ("README_APLICACAO.txt", "readme"),
        ("SHA256SUMS.txt", "checksums"),
    ];
    write_test_zip(&archive, &entries);
    for (index, (path, _)) in entries.iter().enumerate().take(5) {
        fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
        if index < 2 {
            write_test_file(&root.join(path), "old content");
        }
    }
    let (root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let built = build_candidates(&root, &manifest).unwrap();
    let rooted = built.candidates.iter().find(|candidate| is_exact_root_candidate(candidate))
        .unwrap().clone();
    assert!(has_coherent_new_file_zip_root_evidence(&root, &rooted, &manifest));
    let mut relocated = rooted.clone();
    relocated.destination_relative_path = PathBuf::from("other-project");
    relocated.candidate.destination_relative_path = "other-project".to_string();
    relocated.mapping_key = rooted.mapping_key.iter().map(|key| format!("other-project/{key}")).collect();
    relocated.candidate.matched_files = 2;
    assert_eq!(recommended_candidate_index(&root, &[rooted, relocated], &manifest), None);
}


#[test]
fn br_route_002_compact_zip_with_root_readme_still_respects_competing_file_mapping() {
    let temp = TestDirectory::new();
    let archive = temp.path.join("compact.zip");
    let root = temp.path.join("project");
    let entries = [
        ("src/components/MapEditor.tsx", "new map"),
        ("src/workers/singleFaceSelection.worker.ts", "new worker"),
        ("src/lib/selection-engine/newProof.ts", "new proof"),
        ("docs/new-doc.md", "new docs"),
        ("README_APLICACAO.txt", "instructions"),
    ];
    write_test_zip(&archive, &entries);
    for (index, (path, _)) in entries.iter().enumerate().take(4) {
        fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
        if index < 2 {
            write_test_file(&root.join(path), "old content");
        }
    }
    let (root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let built = build_candidates(&root, &manifest).unwrap();
    let rooted = built.candidates.iter().find(|candidate| is_exact_root_candidate(candidate))
        .unwrap().clone();
    assert!(has_structurally_anchored_zip_root_evidence(
        &rooted, manifest.files.len(), expected_zip_root_directory_matches(&manifest),
    ));
    assert!(is_new_file_heavy_root_evidence(&root, &rooted, &manifest));
    let mut relocated = rooted.clone();
    relocated.mapping_key = rooted.mapping_key.iter().map(|key| format!("other/{key}")).collect();
    relocated.destination_relative_path = PathBuf::from("other");
    relocated.candidate.destination_relative_path = "other".to_string();
    assert_eq!(recommended_candidate_index(&root, &[rooted, relocated], &manifest), None);
}
