#[cfg(test)]
mod tests {
	use super::*;
	use std::time::{SystemTime, UNIX_EPOCH};

	fn test_root(name: &str) -> PathBuf {
		let nonce = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time")
			.as_nanos();

		std::env::temp_dir().join(format!(
			"orqeto-project-ignore-{name}-{}-{nonce}",
			std::process::id(),
		))
	}

	#[test]
	fn creates_default_ignore_without_overwriting_existing_file() {
		let root = test_root("create");
		fs::create_dir_all(&root).expect("create root");
		let root_string = root.to_string_lossy().into_owned();

		assert!(create_project_ignore_blocking(root_string.clone()).expect("create ignore"));
		assert!(!create_project_ignore_blocking(root_string).expect("keep ignore"));
		let content = fs::read_to_string(root.join(PROJECT_IGNORE_FILE_NAME))
			.expect("read ignore");

		assert!(content.contains("node_modules/"));
		assert!(content.contains("target/"));
		assert!(content.contains(".venv/"));

		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn appends_exact_ignore_and_unignore_rules() {
		let root = test_root("update");
		let generated = root.join("src").join("generated");
		fs::create_dir_all(&generated).expect("create generated");
		let root_string = root.to_string_lossy().into_owned();
		let generated_string = generated.to_string_lossy().into_owned();
		create_project_ignore_blocking(root_string.clone()).expect("create ignore");

		let added = update_project_ignore_blocking(
			root_string.clone(),
			vec![generated_string.clone()],
			true,
		)
		.expect("add ignore");
		assert_eq!(added.changed_paths, 1);
		assert_eq!(added.changed_directories, 1);
		assert_eq!(added.changed_files, 0);
		assert_eq!(added.unchanged_paths, 0);
		assert!(ProjectIgnore::load(&root)
			.expect("load ignore")
			.is_ignored(&generated, true));

		let removed = update_project_ignore_blocking(
			root_string,
			vec![generated_string],
			false,
		)
		.expect("remove ignore");
		assert_eq!(removed.changed_paths, 1);
		assert_eq!(removed.changed_directories, 1);
		assert_eq!(removed.changed_files, 0);
		assert!(!ProjectIgnore::load(&root)
			.expect("reload ignore")
			.is_ignored(&generated, true));

		fs::remove_dir_all(root).expect("cleanup");
	}
	#[test]
	fn unignore_reopens_ignored_parent_directories() {
		let root = test_root("nested-unignore");
		let package = root.join("node_modules").join("example-package");
		fs::create_dir_all(&package).expect("create package");
		let root_string = root.to_string_lossy().into_owned();
		let package_string = package.to_string_lossy().into_owned();
		create_project_ignore_blocking(root_string.clone()).expect("create ignore");

		assert!(ProjectIgnore::load(&root)
			.expect("load default ignore")
			.is_ignored(&package, true));

		let removed = update_project_ignore_blocking(
			root_string,
			vec![package_string],
			false,
		)
		.expect("unignore nested package");

		assert_eq!(removed.changed_paths, 1);
		assert!(!ProjectIgnore::load(&root)
			.expect("reload ignore")
			.is_ignored(&package, true));

		let content = fs::read_to_string(root.join(PROJECT_IGNORE_FILE_NAME))
			.expect("read ignore");
		assert!(content.contains("!/node_modules/"));
		assert!(content.contains("!/node_modules/example-package/"));

		fs::remove_dir_all(root).expect("cleanup");
	}

	#[test]
	fn escapes_gitignore_metacharacters_in_managed_paths() {
		let root = test_root("literal-rules");
		let generated = root.join("generated[1] #draft");
		fs::create_dir_all(&generated).expect("create generated");
		let root_string = root.to_string_lossy().into_owned();
		let generated_string = generated.to_string_lossy().into_owned();
		create_project_ignore_blocking(root_string.clone()).expect("create ignore");

		update_project_ignore_blocking(
			root_string,
			vec![generated_string],
			true,
		)
		.expect("add literal ignore");

		let content = fs::read_to_string(root.join(PROJECT_IGNORE_FILE_NAME))
			.expect("read ignore");
		assert!(content.contains(r"/generated\[1\]\ \#draft/"));
		assert!(ProjectIgnore::load(&root)
			.expect("reload ignore")
			.is_ignored(&generated, true));

		fs::remove_dir_all(root).expect("cleanup");
	}
}
