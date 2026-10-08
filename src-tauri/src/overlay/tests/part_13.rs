#[test]
fn br_secret_review_001_selective_approval_preserves_others() {
    let test = TestDirectory::new();
    let root_path = test.path.join("project");
    fs::create_dir_all(&root_path).unwrap();
    let zip = test.path.join("incoming.zip");
    write_test_zip(&zip, &[
        (".env.local", "API_KEY=real-development-key\n"),
        ("safe.ts", "export const ok = true\n"),
    ]);
    let (root, manifest) = build_manifest(
        &root_path.to_string_lossy(), &[zip.to_string_lossy().into_owned()],
    ).unwrap();
    let planned = planned_files(&root, &manifest, Path::new(""), Path::new("")).unwrap();
    let preview = secret_review_plan(&root, &manifest, &planned, &[]).unwrap();
    assert_eq!(preview.files.len(), 1);
    assert_eq!(preview.files[0].path, ".env.local");
    assert!(preview.files[0].approvable);
    let (partial, snapshot) = apply_overlay_manifest_blocking(
        root.clone(), &manifest, String::new(), String::new(),
    ).unwrap();
    assert_eq!(partial.protected_secret_files, 1);
    assert!(root.join("safe.ts").exists());
    assert!(!root.join(".env.local").exists());
    discard_snapshot(snapshot);
    let (authorized, snapshot) = apply_overlay_manifest_blocking_with_review(
        root.clone(), &manifest, String::new(), String::new(),
        &[".env.local".to_string()], Some(&preview.fingerprint),
    ).unwrap();
    assert_eq!(authorized.protected_secret_files, 0);
    assert_eq!(fs::read_to_string(root.join(".env.local")).unwrap(), "API_KEY=real-development-key\n");
    discard_snapshot(snapshot);
}

#[test]
fn br_secret_review_002_redacted_payload_is_never_approvable() {
    let test = TestDirectory::new();
    let root_path = test.path.join("project");
    fs::create_dir_all(&root_path).unwrap();
    let zip = test.path.join("incoming.zip");
    write_test_zip(&zip, &[(".env", "TOKEN=[REDACTED]\n")]);
    let (root, manifest) = build_manifest(
        &root_path.to_string_lossy(), &[zip.to_string_lossy().into_owned()],
    ).unwrap();
    let planned = planned_files(&root, &manifest, Path::new(""), Path::new("")).unwrap();
    let preview = secret_review_plan(&root, &manifest, &planned, &[]).unwrap();
    assert_eq!(preview.files.len(), 1);
    assert!(!preview.files[0].approvable);
    let error = match apply_overlay_manifest_blocking_with_review(
        root.clone(), &manifest, String::new(), String::new(),
        &[".env".to_string()], Some(&preview.fingerprint),
    ) {
        Ok(_) => panic!("redacted patch must not be approvable"),
        Err(error) => error,
    };
    assert!(error.contains("non-approvable"));
    assert!(!root.join(".env").exists());
}

#[test]
fn br_secret_review_003_changed_destination_invalidates_approval() {
    let test = TestDirectory::new();
    let root_path = test.path.join("project");
    let existing = root_path.join(".env.local");
    write_test_file(&existing, "TOKEN=old-secret\n");
    let zip = test.path.join("incoming.zip");
    write_test_zip(&zip, &[(".env.local", "TOKEN=next-secret\n")]);
    let (root, manifest) = build_manifest(
        &root_path.to_string_lossy(), &[zip.to_string_lossy().into_owned()],
    ).unwrap();
    let planned = planned_files(&root, &manifest, Path::new(""), Path::new("")).unwrap();
    let preview = secret_review_plan(&root, &manifest, &planned, &[]).unwrap();
    write_test_file(&existing, "TOKEN=changed-by-user\n");
    let error = match apply_overlay_manifest_blocking_with_review(
        root.clone(), &manifest, String::new(), String::new(),
        &[".env.local".to_string()], Some(&preview.fingerprint),
    ) {
        Ok(_) => panic!("a changed sensitive destination must reject stale authorization"),
        Err(error) => error,
    };
    assert!(error.contains("changed after review"));
    assert_eq!(fs::read_to_string(&existing).unwrap(), "TOKEN=changed-by-user\n");
}
