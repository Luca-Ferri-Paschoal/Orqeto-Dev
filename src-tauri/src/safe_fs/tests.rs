#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn relative_path_validation_rejects_parent_components() {
		let root = std::env::temp_dir();
		assert!(validate_project_relative_path(&root, Path::new("../escape.txt")).is_err());
	}

	#[test]
	fn relative_path_validation_accepts_normal_nested_paths() {
		let root = std::env::temp_dir();
		assert!(validate_project_relative_path(&root, Path::new("src/components/App.tsx")).is_ok());
	}

	#[cfg(unix)]
	#[test]
	fn relative_path_validation_rejects_intermediate_symlinks() {
		use std::os::unix::fs::symlink;

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		let outside = base.join("outside");
		fs::create_dir_all(&root).expect("root should be created");
		fs::create_dir_all(&outside).expect("outside should be created");
		symlink(&outside, root.join("linked")).expect("test symlink should be created");

		assert!(validate_project_relative_path(&root, Path::new("linked/file.txt")).is_err());
		fs::remove_dir_all(base).expect("test directory should be removed");
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn windows_component_validation_rejects_aliases_and_ads() {
		for value in [
			"CON",
			"nul.txt",
			"COM1.log",
			"LPT9",
			"COM¹.txt",
			"LPT³.log",
			"file.txt:stream",
			"trailing.",
			"trailing ",
		] {
			assert!(
				validate_windows_component(std::ffi::OsStr::new(value)).is_err(),
				"{value} should be rejected on Windows",
			);
		}
	}
	#[test]
	fn br_fs_001_checked_atomic_replace_preserves_concurrent_destination_change() {
		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-checked-test-{}-{nonce}",
			std::process::id(),
		));
		fs::create_dir_all(&base).expect("test directory should be created");
		let source = base.join("source.txt");
		let destination = base.join("destination.txt");
		fs::write(&source, b"new").expect("source should be written");
		fs::write(&destination, b"old").expect("destination should be written");

		let result = atomic_copy_preserve_destination_checked(
			&source,
			&destination,
			|| {
				fs::write(&destination, b"external")?;
				let current = fs::read(&destination)?;
				if current != b"old" {
					return Err(io::Error::other(
						"destination changed before commit",
					));
				}
				Ok(())
			},
		);

		assert!(result.is_err());
		assert_eq!(
			fs::read(&destination).expect("destination should remain readable"),
			b"external",
		);
		let _ = fs::remove_dir_all(base);
	}

	#[test]
	fn br_fs_002_project_parent_creation_builds_only_under_the_canonical_root() {
		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-parent-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		fs::create_dir_all(&root).expect("root should be created");

		create_project_parent_directories(
			&root,
			Path::new("a/b/c/file.txt"),
		)
		.expect("nested project parents should be created");

		assert!(root.join("a/b/c").is_dir());
		let _ = fs::remove_dir_all(base);
	}

	#[cfg(unix)]
	#[test]
	fn project_parent_creation_rejects_intermediate_symlink_injection() {
		use std::os::unix::fs::symlink;

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-parent-link-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		let outside = base.join("outside");
		fs::create_dir_all(&root).expect("root should be created");
		fs::create_dir_all(&outside).expect("outside should be created");
		symlink(&outside, root.join("linked")).expect("symlink should be created");

		assert!(
			create_project_parent_directories(
				&root,
				Path::new("linked/child/file.txt"),
			)
			.is_err(),
		);
		assert!(!outside.join("child").exists());
		let _ = fs::remove_dir_all(base);
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn project_parent_creation_rejects_intermediate_reparse_injection() {
		use std::os::windows::fs::symlink_dir;

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-parent-reparse-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		let outside = base.join("outside");
		let linked = root.join("linked");
		fs::create_dir_all(&root).expect("root should be created");
		fs::create_dir_all(&outside).expect("outside should be created");

		let linked_arg = linked.to_string_lossy().into_owned();
		let outside_arg = outside.to_string_lossy().into_owned();
		let linked_created = symlink_dir(&outside, &linked).is_ok() || {
			std::process::Command::new("cmd")
				.args([
					"/C",
					"mklink",
					"/J",
					linked_arg.as_str(),
					outside_arg.as_str(),
				])
				.status()
				.is_ok_and(|status| status.success())
		};

		if linked_created {
			assert!(
				create_project_parent_directories(
					&root,
					Path::new("linked/child/file.txt"),
				)
				.is_err(),
			);
			assert!(!outside.join("child").exists());
			let _ = fs::remove_dir(&linked);
		}

		let _ = fs::remove_dir_all(base);
	}


	#[cfg(target_os = "windows")]
	#[test]
	fn br_adv_004_windows_short_name_alias_is_rejected_when_available() {
		use std::{ffi::{OsStr, OsString}, os::windows::ffi::{OsStrExt, OsStringExt}};

		#[link(name = "kernel32")]
		extern "system" {
			fn GetShortPathNameW(
				lpsz_long_path: *const u16,
				lpsz_short_path: *mut u16,
				cch_buffer: u32,
			) -> u32;
		}

		fn wide(value: &OsStr) -> Vec<u16> {
			value.encode_wide().chain(std::iter::once(0)).collect()
		}

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-short-name-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		fs::create_dir_all(&root).expect("root should be created");
		let long_name = "long-file-name-for-short-alias-test.txt";
		let file = root.join(long_name);
		fs::write(&file, b"alias").expect("test file should be written");

		let source = wide(file.as_os_str());
		let required = unsafe { GetShortPathNameW(source.as_ptr(), std::ptr::null_mut(), 0) };
		if required == 0 {
			let _ = fs::remove_dir_all(base);
			return;
		}
		let mut buffer = vec![0_u16; required as usize + 1];
		let written = unsafe { GetShortPathNameW(source.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
		if written == 0 {
			let _ = fs::remove_dir_all(base);
			return;
		}
		let short_path = PathBuf::from(OsString::from_wide(&buffer[..written as usize]));
		let Some(short_name) = short_path.file_name() else {
			let _ = fs::remove_dir_all(base);
			return;
		};
		if short_name.to_string_lossy().eq_ignore_ascii_case(long_name) {
			let _ = fs::remove_dir_all(base);
			return;
		}

		assert!(validate_project_relative_path(&root, Path::new(short_name)).is_err());
		assert!(validate_project_relative_path(&root, Path::new("LONG-FILE-NAME-FOR-SHORT-ALIAS-TEST.TXT")).is_ok());
		let _ = fs::remove_dir_all(base);
	}

}
