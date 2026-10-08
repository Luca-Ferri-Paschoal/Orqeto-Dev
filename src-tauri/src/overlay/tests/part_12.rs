    #[test]
    fn br_perm_001_generated_directory_is_deleted_without_undo_storage() {
        let temp = TestDirectory::new();
        let root = temp.path.join("project");
        write_test_file(&root.join("src-tauri/src/lib.rs"), "source code");
        write_test_file(&root.join("src-tauri/target/debug/cache.bin"), "generated");
        let root = fs::canonicalize(root).expect("project root");
        let manifest = r#"{"format":"orqeto-dev-delete","version":1,"delete":[],"deletePermanent":["src-tauri/target"]}"#;
        let parsed = parse_delete_manifest_content(&root, manifest).expect("safe manifest");
        assert!(parsed.files.is_empty());
        assert!(parsed.directories.is_empty());
        assert_eq!(parsed.permanent_directories, vec![PathBuf::from("src-tauri/target")]);
        let result = delete_generated_directories_blocking(
            &root, &["src-tauri/target".to_string()],
        ).expect("generated output should be deleted without a snapshot");
        assert_eq!(result.deleted_files, 1);
        assert!(!root.join("src-tauri/target").exists());
        assert!(root.join("src-tauri/src/lib.rs").is_file());
    }

    #[test]
    fn br_perm_001_rejects_source_or_overlapping_or_secret_deletions() {
        let temp = TestDirectory::new();
        let root = temp.path.join("project");
        write_test_file(&root.join("src-tauri/src/lib.rs"), "source");
        write_test_file(&root.join("src-tauri/target/debug/.env"), "TOKEN=sensitive");
        let root = fs::canonicalize(root).expect("project root");
        for path in ["src-tauri", "src-tauri/src", "../target", "src-tauri/target/.."] {
            assert!(validate_permanent_directory_path(&root, path).is_err(), "{path}");
        }
        let secret_error = delete_generated_directories_blocking(
            &root, &["src-tauri/target".to_string()],
        ).err().expect("secret-bearing tree must fail before mutation");
        assert!(secret_error.contains("sensitive"));
        assert!(root.join("src-tauri/target/debug/.env").is_file());
        let overlapping = r#"{"format":"orqeto-dev-delete","version":1,"delete":["src-tauri"],"deletePermanent":["src-tauri/target"]}"#;
        assert!(parse_delete_manifest_content(&root, overlapping).is_err());
    }
