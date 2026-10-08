#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::atomic::{AtomicU64, Ordering};

	static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

	struct TestDirectory {
		path: PathBuf,
	}

	impl TestDirectory {
		fn new(label: &str) -> Self {
			let nonce = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
			let path = std::env::temp_dir().join(format!(
				"orqeto-storage-test-{label}-{}-{nonce}",
				std::process::id(),
			));
			fs::create_dir_all(&path).expect("test directory should be created");
			Self { path }
		}
	}

	impl Drop for TestDirectory {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.path);
		}
	}

	#[cfg(windows)]
	#[test]
	fn marker_retry_only_accepts_transient_windows_sharing_violations() {
		assert!(is_transient_windows_marker_error(&std::io::Error::from_raw_os_error(32)));
		assert!(is_transient_windows_marker_error(&std::io::Error::from_raw_os_error(33)));
		assert!(!is_transient_windows_marker_error(&std::io::Error::from_raw_os_error(5)));
	}

	#[test]
	fn br_storage_001_quota_boundaries_and_physical_space_fail_before_reservation() {
		let limits = StorageLimits {
			project_hard_bytes: 100,
			global_hard_bytes: 200,
			soft_numerator: 8,
			soft_denominator: 10,
			free_space_margin_bytes: 10,
		};
		let mut usage = StorageUsage::default();
		usage.global_bytes = 50;
		usage.projects.insert("p".to_string(), 40);
		check_capacity(
			limits,
			&usage,
			0,
			0,
			"p",
			60,
			100,
		)
		.expect("exact project quota should be accepted");
		assert!(check_capacity(
			limits,
			&usage,
			0,
			0,
			"p",
			61,
			100,
		)
		.is_err());
		let mut global_boundary_usage = StorageUsage::default();
		global_boundary_usage.global_bytes = 140;
		check_capacity(
			limits,
			&global_boundary_usage,
			0,
			0,
			"global-boundary",
			60,
			1_000,
		)
		.expect("exact global quota should be accepted");
		assert!(check_capacity(
			limits,
			&global_boundary_usage,
			0,
			0,
			"global-boundary",
			61,
			1_000,
		)
		.is_err());
		assert!(check_capacity(
			limits,
			&usage,
			0,
			0,
			"p",
			60,
			69,
		)
		.is_err());
		assert!(check_capacity(
			limits,
			&StorageUsage::default(),
			40,
			0,
			"p",
			50,
			99,
		)
		.is_err());
		assert_eq!(
			staging_reservation_bytes(50, 2).expect("staging reservation should be bounded"),
			50 + STAGING_METADATA_ALLOWANCE_BYTES + 2 * STAGING_METADATA_ALLOWANCE_PER_FILE_BYTES,
		);
		assert!(!exceeds_soft_threshold(
			limits,
			&usage,
			0,
			0,
			"p",
			39,
		));
		assert!(exceeds_soft_threshold(
			limits,
			&usage,
			0,
			0,
			"p",
			41,
		));
		let mut global_soft_usage = StorageUsage::default();
		global_soft_usage.global_bytes = 150;
		assert!(!exceeds_soft_threshold(
			limits,
			&global_soft_usage,
			0,
			0,
			"global-soft",
			10,
		));
		assert!(exceeds_soft_threshold(
			limits,
			&global_soft_usage,
			0,
			0,
			"global-soft",
			11,
		));
	}

	#[test]
	fn usage_measurement_treats_a_concurrently_removed_entry_as_absent() {
		let test = TestDirectory::new("usage-race");
		let transient = test.path.join("recovery.json");
		fs::write(&transient, "temporary journal").expect("transient journal should be written");
		let stale_entry_path = fs::read_dir(&test.path)
			.expect("test directory should be readable")
			.next()
			.expect("transient journal should be listed")
			.expect("directory entry should be readable")
			.path();
		fs::remove_file(&transient).expect("transient journal should be removed");

		assert!(usage_metadata_no_follow(&stale_entry_path)
			.expect("a vanished usage entry should not fail measurement")
			.is_none());
		assert_eq!(
			directory_size_no_follow(&test.path).expect("the remaining directory should still be measurable"),
			0,
		);
	}

	#[test]
	fn br_gc_001_gc_priority_never_selects_active_or_recovery_critical_data() {
		assert_eq!(StorageClass::RebuildableCache.gc_rank(), Some(0));
		assert_eq!(StorageClass::CompletedStaging.gc_rank(), Some(1));
		assert_eq!(StorageClass::OrdinaryHistory.gc_rank(), Some(2));
		assert_eq!(StorageClass::ActiveUndo.gc_rank(), None);
		assert_eq!(StorageClass::ActiveStaging.gc_rank(), None);
		assert_eq!(StorageClass::RecoveryCritical.gc_rank(), None);
	}

	#[test]
	fn br_storage_002_shared_blob_reference_is_content_addressed_and_stable() {
		let test = TestDirectory::new("blob");
		let source = test.path.join("source.txt");
		fs::write(&source, "same bytes").expect("source should be written");
		let root = fs::canonicalize(&test.path).expect("root should canonicalize");
		let first_snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let second_snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let first = store_stable_backup(&source, &first_snapshot).expect("first backup should be stored");
		let second = store_stable_backup(&source, &second_snapshot).expect("second backup should be stored");
		assert_eq!(first.blob_id, second.blob_id);
		assert_eq!(first.path, second.path);
		assert!(first.path.is_file());
		remove_managed_directory(&first_snapshot).expect("first snapshot should be removed");
		garbage_collect().expect("gc should preserve referenced shared blob");
		assert!(second.path.is_file());
		remove_managed_directory(&second_snapshot).expect("second snapshot should be removed");
		garbage_collect().expect("gc should collect unreferenced blob");
		assert!(!second.path.exists());
	}

	#[test]
	fn br_gc_003_active_descendant_protects_its_managed_ancestor() {
		let process_directory = PathBuf::from("native-drop/process-1");
		let active_drop = process_directory.join("drop-1");
		let mut active = HashSet::new();
		active.insert(active_drop.clone());

		assert!(is_runtime_active(&active, &process_directory));
		assert!(is_runtime_active(&active, &active_drop));
		assert!(is_runtime_active(&active, &active_drop.join("nested")));
		assert!(!is_runtime_active(&active, Path::new("native-drop/process-2")));
	}

	#[test]
	fn br_recovery_005_blob_identity_validation_rejects_tampered_content() {
		let test = TestDirectory::new("blob-tamper");
		let source = test.path.join("source.txt");
		fs::write(
			&source,
			format!("unique recovery bytes for {}", test.path.display()),
		)
		.expect("source should be written");
		let root = fs::canonicalize(&test.path).expect("root should canonicalize");
		let snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let backup = store_stable_backup(&source, &snapshot).expect("backup should be stored");

		fs::write(&backup.path, "tampered bytes").expect("test should tamper with the stored blob");
		assert!(blob_path(&backup.blob_id).is_err());

		remove_managed_directory(&snapshot).expect("snapshot should be removed");
		garbage_collect().expect("gc should collect the unreferenced tampered blob");
	}

	#[test]
	fn br_recovery_001_gc_preserves_recovery_critical_snapshot_and_referenced_blob() {
		let test = TestDirectory::new("recovery-critical");
		let source = test.path.join("source.txt");
		fs::write(&source, "recovery bytes").expect("source should be written");
		let root = fs::canonicalize(&test.path).expect("root should canonicalize");
		let snapshot = create_snapshot_directory(&root).expect("snapshot should be created");
		let backup = store_stable_backup(&source, &snapshot).expect("backup should be stored");

		garbage_collect().expect("gc should preserve recovery-critical data");
		assert!(snapshot.is_dir());
		assert!(backup.path.is_file());

		remove_managed_directory(&snapshot).expect("snapshot should be removed");
		garbage_collect().expect("gc should collect the unreferenced blob");
	}

	#[cfg(unix)]
	#[test]
	fn br_gc_002_cleanup_refuses_symlink_escape() {
		use std::os::unix::fs::symlink;
		let test = TestDirectory::new("escape");
		let base = test.path.join("base");
		let candidate = base.join("candidate");
		let outside = test.path.join("outside");
		fs::create_dir_all(&candidate).expect("candidate should exist");
		fs::create_dir_all(&outside).expect("outside should exist");
		fs::write(outside.join("keep.txt"), "keep").expect("outside file should exist");
		symlink(&outside, candidate.join("escape")).expect("symlink should be created");
		assert!(safe_remove_managed_tree(&base, &candidate).is_err());
		assert!(outside.join("keep.txt").is_file());
	}


	#[cfg(target_os = "windows")]
	#[test]
	fn br_gc_002_cleanup_refuses_symlink_escape_windows() {
		let test = TestDirectory::new("escape-windows");
		let base = test.path.join("base");
		let candidate = base.join("candidate");
		let outside = test.path.join("outside");
		fs::create_dir_all(&candidate).expect("candidate should exist");
		fs::create_dir_all(&outside).expect("outside should exist");
		fs::write(outside.join("keep.txt"), "keep").expect("outside file should exist");
		let link = candidate.join("escape");
		let status = std::process::Command::new("cmd")
			.args(["/C", "mklink", "/J"])
			.arg(&link)
			.arg(&outside)
			.status()
			.expect("junction command should run");
		if !status.success() {
			return;
		}
		assert!(safe_remove_managed_tree(&base, &candidate).is_err());
		assert!(outside.join("keep.txt").is_file());
	}
}
