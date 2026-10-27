#[test]
fn br_route_002_conversational_docs_new_subtree_uses_unique_root_with_many_candidates() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("orqeto-inteligencia-conversacional-documentacao-roadmap.zip");
    let files = [
        ("docs/automation/README.md", "# Automation"),
        ("docs/automation/inteligencia-conversacional/README.md", "# Overview"),
        ("docs/automation/inteligencia-conversacional/arquitetura-e-contratos.md", "# Architecture"),
        ("docs/automation/inteligencia-conversacional/decisoes.md", "# Decisions"),
        ("docs/automation/inteligencia-conversacional/handoff.md", "# Handoff"),
        ("docs/automation/inteligencia-conversacional/modelo-evidencia.md", "# Evidence"),
        ("docs/automation/inteligencia-conversacional/regras-de-negocio.md", "# Rules"),
        ("docs/automation/inteligencia-conversacional/roadmap.md", "# Roadmap"),
    ];
    write_test_zip(&archive, &files);
    write_test_file(&root.join("docs/automation/contracts.md"), "# Existing documentation");
    write_test_file(&root.join("docs/automation/persistence.md"), "# Existing contracts");
    for index in 0..20 {
        write_test_file(
            &root.join(format!("apps/module_{index}/automation/example.md")),
            "# Unrelated module",
        );
    }

    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    // Discovery produces many raw prefix seeds, but only one certified
    // destination is presented as a plausible route.
    assert_eq!(prepared.candidate_count, 1);
    assert!(!prepared.ambiguity_limit_exceeded);
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates[0].destination_relative_path, "./");
    assert_eq!(prepared.candidates[0].source_prefix, "");
    assert_eq!(prepared.candidates[0].matched_files, 0);

    let (validated_root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let planned = planned_files(&validated_root, &manifest, Path::new(""), Path::new("")).unwrap();
    assert_eq!(planned.len(), 8);
    assert!(planned.iter().any(|file| file.destination_relative_path ==
        PathBuf::from("docs/automation/inteligencia-conversacional/roadmap.md")));
}

#[test]
fn br_route_002_conversational_docs_duplicate_full_anchor_requires_user_choice() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("docs.zip");
    write_test_zip(&archive, &[
        ("docs/automation/README.md", "# Docs"),
        ("docs/automation/inteligencia-conversacional/README.md", "# New"),
        ("docs/automation/inteligencia-conversacional/decisoes.md", "# New"),
        ("docs/automation/inteligencia-conversacional/roadmap.md", "# New"),
    ]);
    write_test_file(&root.join("docs/automation/contracts.md"), "# Existing");
    write_test_file(&root.join("nested/docs/automation/contracts.md"), "# Duplicate");

    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
}

#[test]
fn br_route_002_conversational_docs_incomplete_anchor_has_no_root_certificate() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("docs.zip");
    write_test_zip(&archive, &[
        ("docs/automation/README.md", "# Docs"),
        ("docs/automation/inteligencia-conversacional/README.md", "# New"),
        ("docs/automation/inteligencia-conversacional/decisoes.md", "# New"),
        ("docs/automation/inteligencia-conversacional/roadmap.md", "# New"),
    ]);
    fs::create_dir_all(root.join("docs")).unwrap();
    let (validated, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let ignore = ProjectIgnore::load(&validated).unwrap();
    let discovery = collect_project_routing_discovery(
        &validated,
        &candidate_target_names(&manifest),
        None,
        &ignore,
    ).unwrap();
    assert_eq!(coherent_new_zip_subtree_root_evidence(&validated, &manifest, &ignore, &discovery), None);
}

#[test]
fn br_route_002_conversational_docs_empty_scaffold_is_not_root_evidence() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("docs.zip");
    write_test_zip(&archive, &[
        ("docs/automation/README.md", "# Docs"),
        ("docs/automation/inteligencia-conversacional/README.md", "# New"),
        ("docs/automation/inteligencia-conversacional/decisoes.md", "# New"),
        ("docs/automation/inteligencia-conversacional/roadmap.md", "# New"),
    ]);
    fs::create_dir_all(root.join("docs/automation")).unwrap();
    let (validated, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let ignore = ProjectIgnore::load(&validated).unwrap();
    let discovery = collect_project_routing_discovery(
        &validated,
        &candidate_target_names(&manifest),
        None,
        &ignore,
    ).unwrap();
    assert_eq!(coherent_new_zip_subtree_root_evidence(&validated, &manifest, &ignore, &discovery), None);
}

#[test]
fn br_route_002_context_inspector_incremental_zip_ignores_repeated_folder_seeds() {
    let temp = TestDirectory::new();
    let root = temp.path.join("orqeto-dev");
    let archive = temp.path.join("ORQETO-DEV-fix-context-size-inspector-architecture.zip");
    let parent = "src/features/context/components/ProjectWorkspacePane/sections";
    let existing = format!("{parent}/ContextSizeInspector.tsx");
    let added_one = format!("{parent}/ContextSizeIntro.tsx");
    let added_two = format!("{parent}/ContextSizeFileList.tsx");
    write_test_zip(&archive, &[
        (existing.as_str(), "existing inspector replacement"),
        (added_one.as_str(), "new header"),
        (added_two.as_str(), "new file list"),
    ]);
    write_test_file(&root.join(&existing), "previous inspector");
    for index in 0..32 {
        write_test_file(
            &root.join(format!("tools/tool_{index}/sections/decoy.ts")),
            "unrelated",
        );
    }

    let (validated, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let built = build_candidates(&validated, &manifest).unwrap();
    assert!(built.discovered_seed_count > MAX_AMBIGUOUS_DESTINATIONS);
    assert!(built.validation_limit_exceeded);
    assert_eq!(built.multi_file_root_hierarchy, Some(true));

    let prepared = prepare_overlay_manifest(&validated, &manifest).unwrap();
    assert_eq!(prepared.file_count, 3);
    assert_eq!(prepared.candidate_count, 1);
    assert!(!prepared.ambiguity_limit_exceeded);
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates.len(), 1);
    assert_eq!(prepared.candidates[0].destination_relative_path, "./");
    assert_eq!(prepared.candidates[0].source_prefix, "");
    assert_eq!(prepared.candidates[0].matched_files, 1);
    let planned = planned_files(&validated, &manifest, Path::new(""), Path::new("")).unwrap();
    assert_eq!(planned.len(), 3);
    assert!(planned.iter().any(|file| file.destination_relative_path == PathBuf::from(&added_two)));
}

#[test]
fn br_route_002_context_inspector_duplicate_anchor_filename_requires_review() {
    let temp = TestDirectory::new();
    let root = temp.path.join("orqeto-dev");
    let archive = temp.path.join("incoming.zip");
    let parent = "src/features/context/components/ProjectWorkspacePane/sections";
    let existing = format!("{parent}/ContextSizeInspector.tsx");
    let added_one = format!("{parent}/ContextSizeIntro.tsx");
    let added_two = format!("{parent}/ContextSizeFileList.tsx");
    write_test_zip(&archive, &[
        (existing.as_str(), "change"),
        (added_one.as_str(), "new"),
        (added_two.as_str(), "new"),
    ]);
    write_test_file(&root.join(&existing), "old");
    write_test_file(&root.join("other/ContextSizeInspector.tsx"), "unrelated same basename");
    for index in 0..24 {
        write_test_file(&root.join(format!("tools/tool_{index}/sections/decoy.ts")), "decoy");
    }
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
    assert!(prepared.ambiguity_limit_exceeded);
}

#[test]
fn br_route_002_context_inspector_shallow_or_incomplete_anchors_are_not_certified() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("shallow.zip");
    write_test_zip(&archive, &[
        ("src/components/Editor.tsx", "update"),
        ("src/components/New.tsx", "new"),
    ]);
    write_test_file(&root.join("src/components/Editor.tsx"), "old");
    let (validated, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let built = build_candidates(&validated, &manifest).unwrap();
    assert_eq!(built.multi_file_root_hierarchy, None);

    // Even a deep anchor cannot certify a ZIP with a missing sibling branch.
    let deep_archive = temp.path.join("incomplete.zip");
    write_test_zip(&deep_archive, &[
        ("src/features/context/components/sections/Existing.tsx", "update"),
        ("src/features/context/components/other/New.tsx", "new"),
    ]);
    write_test_file(&root.join("src/features/context/components/sections/Existing.tsx"), "old");
    let (_, deep_manifest) = build_manifest(
        &root.to_string_lossy(),
        &[deep_archive.to_string_lossy().into_owned()],
    ).unwrap();
    let deep_built = build_candidates(&validated, &deep_manifest).unwrap();
    assert_eq!(deep_built.multi_file_root_hierarchy, None);
}
