#[test]
fn br_route_002_arq17_single_new_migration_preserves_declared_root_despite_repeated_names() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("orqeto-arq17-booking-binding-check-2026-10-20.zip");
    let target = "apps/api/prisma/migrations/20261020143000_arq17_booking_operation_binding_check/migration.sql";
    write_test_zip(&archive, &[(target, "-- new migration")]);
    for index in 0..25 {
        write_test_file(
            &root.join(format!(
                "apps/api/prisma/migrations/202610{:02}01100000_old_migration_{index}/migration.sql",
                index,
            )),
            "-- previous migration",
        );
    }
    // Repeated generic directory names elsewhere in a monorepo must not
    // outweigh the complete apps/api/prisma/migrations root hierarchy.
    for index in 0..25 {
        write_test_file(
            &root.join(format!(
                "services/service_{index}/api/prisma/migrations/20261001100000_other/migration.sql",
            )),
            "-- separate service migration",
        );
    }

    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert!(prepared.candidate_count > MAX_AMBIGUOUS_DESTINATIONS);
    assert!(!prepared.ambiguity_limit_exceeded);
    assert_eq!(prepared.recommended_candidate_index, Some(0));
    assert_eq!(prepared.candidates.len(), 1);
    assert_eq!(prepared.candidates[0].destination_relative_path, "./");
    assert_eq!(prepared.candidates[0].source_prefix, "");
    assert_eq!(prepared.candidates[0].matched_files, 0);

    let (validated_root, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let planned = planned_files(&validated_root, &manifest, Path::new(""), Path::new("")).unwrap();
    assert_eq!(planned.len(), 1);
    assert_eq!(planned[0].destination_relative_path, PathBuf::from(target));
}

#[test]
fn br_route_002_arq17_single_new_migration_rejects_missing_project_hierarchy() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("patch.zip");
    write_test_zip(&archive, &[(
        "apps/api/prisma/migrations/20261020143000_arq17_booking_operation_binding_check/migration.sql",
        "-- migration",
    )]);
    fs::create_dir_all(root.join("apps/api")).unwrap();
    let (validated, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let ignore = ProjectIgnore::load(&validated).unwrap();
    let names = candidate_target_names(&manifest);
    let discovery = collect_project_routing_discovery(&validated, &names, None, &ignore).unwrap();
    assert_eq!(deep_single_zip_root_hierarchy_evidence(&validated, &manifest, &ignore, &discovery), None);
}

#[test]
fn br_route_002_arq17_duplicate_complete_migration_hierarchy_still_requires_review() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("patch.zip");
    write_test_zip(&archive, &[(
        "apps/api/prisma/migrations/20261020143000_arq17_booking_operation_binding_check/migration.sql",
        "-- migration",
    )]);
    fs::create_dir_all(root.join("apps/api/prisma/migrations")).unwrap();
    fs::create_dir_all(root.join("nested/apps/api/prisma/migrations")).unwrap();
    let prepared = prepare_project_overlay_blocking(
        root.to_string_lossy().into_owned(),
        vec![archive.to_string_lossy().into_owned()],
    ).unwrap();
    assert_eq!(prepared.recommended_candidate_index, None);
}

#[test]
fn br_route_002_single_new_shallow_zip_has_no_deep_root_certificate() {
    let temp = TestDirectory::new();
    let root = temp.path.join("project");
    let archive = temp.path.join("patch.zip");
    write_test_zip(&archive, &[("prisma/migrations/new/migration.sql", "-- migration")]);
    fs::create_dir_all(root.join("prisma/migrations")).unwrap();
    for index in 0..20 {
        write_test_file(
            &root.join(format!("nested/{index}/migrations/old/migration.sql")),
            "-- migration",
        );
    }
    let (validated, manifest) = build_manifest(
        &root.to_string_lossy(),
        &[archive.to_string_lossy().into_owned()],
    ).unwrap();
    let ignore = ProjectIgnore::load(&validated).unwrap();
    let names = candidate_target_names(&manifest);
    let discovery = collect_project_routing_discovery(&validated, &names, None, &ignore).unwrap();
    assert_eq!(deep_single_zip_root_hierarchy_evidence(&validated, &manifest, &ignore, &discovery), None);
}
