use crate::{operation_id::next_operation_id, overlay::OverlayUndoState, safe_fs};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;
use std::{
	collections::HashSet,
	fs::{self, OpenOptions},
	io::Write,
	path::{Path, PathBuf},
	sync::Mutex,
};
use tauri::State;

pub const PROJECT_IGNORE_FILE_NAME: &str = ".orqeto-devignore";

static PROJECT_IGNORE_UPDATE_LOCK: Mutex<()> = Mutex::new(());

const DEFAULT_PROJECT_IGNORE: &str = r#"# Orqeto Dev ignore rules
# Uses .gitignore-compatible syntax.

# Version control and editor metadata
.git/
.hg/
.svn/
.idea/
.vs/
.vscode/
.DS_Store
Thumbs.db

# Local environment and secrets
.env
.env.*
!.env.example
!.env.template

# Logs, caches, and temporary files
*.log
*.tmp
*.temp
*.swp
*.swo
.cache/
.cache-loader/
.eslintcache
.stylelintcache

# JavaScript / TypeScript
node_modules/
bower_components/
.pnpm-store/
.yarn/cache/
.yarn/unplugged/
.next/
.nuxt/
.output/
.svelte-kit/
.angular/
.vite/
.parcel-cache/
.turbo/
.nx/
.expo/
.storybook-static/
coverage/
.nyc_output/
dist/
build/
out/

# Python
__pycache__/
*.py[cod]
.venv/
venv/
env/
__pypackages__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.tox/
.nox/
.coverage
htmlcov/
*.egg-info/

# Rust
target/

# Java / Kotlin / Gradle / Maven
.gradle/
.classpath
.project
.settings/
*.class

# .NET
bin/
obj/
TestResults/

# Go / PHP / Ruby dependencies and build output
vendor/
.bundle/
vendor/bundle/
.phpunit.result.cache
coverage.xml

# Swift / Xcode / CocoaPods / Carthage
.build/
DerivedData/
Pods/
Carthage/Build/

# Dart / Flutter
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
.packages

# C / C++ / CMake
CMakeFiles/
cmake-build-*/
CMakeCache.txt

# Zig
.zig-cache/
zig-out/

# Elixir / Erlang
_build/
deps/
.eunit/

# Haskell
.stack-work/
dist-newstyle/

# Terraform / infrastructure tooling
.terraform/
*.tfstate
*.tfstate.*
.terragrunt-cache/

# Bazel
bazel-bin/
bazel-out/
bazel-testlogs/

# Android native/generated output
.externalNativeBuild/
.cxx/
local.properties

# Unity generated folders
Library/
Temp/
Obj/
Logs/
UserSettings/

# Packaged editor extensions
*.vsix
"#;

const MANAGED_SECTION_HEADER: &str = "# Paths managed from the Orqeto Dev ignore dialog";

pub struct ProjectIgnore {
	root: PathBuf,
	matcher: Gitignore,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIgnoreUpdateResult {
	operation_id: String,
	changed_paths: usize,
	unchanged_paths: usize,
	changed_files: usize,
	changed_directories: usize,
	unchanged_files: usize,
	unchanged_directories: usize,
}

impl ProjectIgnore {
	pub fn load(root: &Path) -> Result<Self, String> {
		let mut builder = GitignoreBuilder::new(root);

		builder
			.case_insensitive(cfg!(target_os = "windows"))
			.map_err(|error| format!("Could not configure ignore rules: {error}"))?;

		let ignore_file = root.join(PROJECT_IGNORE_FILE_NAME);

		if ignore_file.is_file() {
			if let Some(error) = builder.add(&ignore_file) {
				return Err(format!(
					"Could not load {}: {error}",
					ignore_file.display(),
				));
			}
		}

		let matcher = builder
			.build()
			.map_err(|error| format!("Could not finalize ignore rules: {error}"))?;

		Ok(Self {
			root: root.to_path_buf(),
			matcher,
		})
	}

	pub fn is_ignored(
		&self,
		path: &Path,
		is_directory: bool,
	) -> bool {
		let Ok(relative_path) = path.strip_prefix(&self.root) else {
			return false;
		};

		self.matcher
			.matched_path_or_any_parents(
				relative_path,
				is_directory,
			)
			.is_ignore()
	}
}

fn canonical_project_root(root_folder: &str) -> Result<PathBuf, String> {
	let root = fs::canonicalize(root_folder)
		.map_err(|error| format!("Could not access the project folder: {error}"))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	Ok(root)
}

fn project_ignore_path(root: &Path) -> PathBuf {
	root.join(PROJECT_IGNORE_FILE_NAME)
}

fn normalize_relative_rule_path(
	root: &Path,
	path: &Path,
) -> Result<String, String> {
	let relative = path
		.strip_prefix(root)
		.map_err(|_| "The submitted item is not inside the project folder.".to_string())?;
	let normalized = relative
		.to_string_lossy()
		.replace('\\', "/");

	if normalized.is_empty() {
		return Err("The project root cannot be added to ignore.".to_string());
	}

	if normalized.contains('\r') || normalized.contains('\n') {
		return Err("The path contains a line break and cannot become an ignore rule.".to_string());
	}

	Ok(normalized)
}

fn escape_gitignore_literal(path: &str) -> String {
	let mut escaped = String::with_capacity(path.len());

	for character in path.chars() {
		if matches!(
			character,
			'\\' | '*' | '?' | '[' | ']' | '!' | '#' | ' '
		) {
			escaped.push('\\');
		}

		escaped.push(character);
	}

	escaped
}

fn exact_ignore_rule(
	relative_path: &str,
	is_directory: bool,
) -> String {
	let escaped_path = escape_gitignore_literal(relative_path);

	if is_directory {
		format!("/{escaped_path}/")
	} else {
		format!("/{escaped_path}")
	}
}

fn exact_unignore_rules(
	relative_path: &str,
	is_directory: bool,
) -> Vec<String> {
	let parts = relative_path
		.split('/')
		.filter(|part| !part.is_empty())
		.collect::<Vec<_>>();
	let mut rules = Vec::new();

	for parent_depth in 1..parts.len() {
		let parent = parts[..parent_depth].join("/");
		rules.push(format!(
			"!/{}/",
			escape_gitignore_literal(&parent),
		));
	}

	let escaped_path = escape_gitignore_literal(relative_path);

	if is_directory {
		rules.push(format!("!/{escaped_path}/"));
		rules.push(format!("!/{escaped_path}/**"));
	} else {
		rules.push(format!("!/{escaped_path}"));
	}

	rules
}

fn append_managed_rules(
	ignore_file: &Path,
	rules: &[String],
) -> Result<(), String> {
	if rules.is_empty() {
		return Ok(());
	}

	let current_content = fs::read_to_string(ignore_file)
		.map_err(|error| format!("Could not read {}: {error}", ignore_file.display()))?;
	let line_ending = if current_content.contains("\r\n") {
		"\r\n"
	} else {
		"\n"
	};
	let needs_leading_line_ending = !current_content.is_empty() &&
		!current_content.ends_with('\n') &&
		!current_content.ends_with('\r');
	let needs_header = !current_content
		.lines()
		.any(|line| line.trim() == MANAGED_SECTION_HEADER);
	let mut appended = String::new();

	if needs_leading_line_ending {
		appended.push_str(line_ending);
	}

	if needs_header {
		if !current_content.is_empty() {
			appended.push_str(line_ending);
		}

		appended.push_str(MANAGED_SECTION_HEADER);
		appended.push_str(line_ending);
	}

	for rule in rules {
		appended.push_str(rule);
		appended.push_str(line_ending);
	}

	let mut next_content = current_content;
	next_content.push_str(&appended);
	safe_fs::atomic_write_bytes(ignore_file, next_content.as_bytes())
		.map_err(|error| format!("Could not update {}: {error}", ignore_file.display()))
}

#[tauri::command]
pub fn project_ignore_exists(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<bool, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	let root = canonical_project_root(&root_folder)?;
	let ignore_file = project_ignore_path(&root);

	if ignore_file.exists() && !ignore_file.is_file() {
		return Err(format!(
			"{} exists but is not a file.",
			ignore_file.display(),
		));
	}

	Ok(ignore_file.is_file())
}

fn create_project_ignore_blocking(root_folder: String) -> Result<bool, String> {
	let _guard = PROJECT_IGNORE_UPDATE_LOCK
		.lock()
		.map_err(|_| "The Dev Ignore coordinator became unavailable.".to_string())?;
	let root = canonical_project_root(&root_folder)?;
	let ignore_file = project_ignore_path(&root);

	if ignore_file.exists() {
		if ignore_file.is_file() {
			return Ok(false);
		}

		return Err(format!(
			"{} exists but is not a file.",
			ignore_file.display(),
		));
	}

	let mut file = OpenOptions::new()
		.write(true)
		.create_new(true)
		.open(&ignore_file)
		.map_err(|error| format!("Could not create {}: {error}", ignore_file.display()))?;

	file.write_all(DEFAULT_PROJECT_IGNORE.as_bytes())
		.map_err(|error| format!("Could not write {}: {error}", ignore_file.display()))?;
	file.sync_all()
		.map_err(|error| format!("Could not finish creating {}: {error}", ignore_file.display()))?;

	Ok(true)
}

fn update_project_ignore_blocking(
	root_folder: String,
	paths: Vec<String>,
	ignore_paths: bool,
) -> Result<ProjectIgnoreUpdateResult, String> {
	let _guard = PROJECT_IGNORE_UPDATE_LOCK
		.lock()
		.map_err(|_| "The Dev Ignore coordinator became unavailable.".to_string())?;
	let operation_id = next_operation_id(if ignore_paths {
		"dev-ignore-add"
	} else {
		"dev-ignore-remove"
	});
	if paths.is_empty() {
		return Ok(ProjectIgnoreUpdateResult {
			operation_id,
			changed_paths: 0,
			unchanged_paths: 0,
			changed_files: 0,
			changed_directories: 0,
			unchanged_files: 0,
			unchanged_directories: 0,
		});
	}

	let root = canonical_project_root(&root_folder)?;
	let ignore_file = project_ignore_path(&root);

	if !ignore_file.is_file() {
		return Err(format!(
			"{} does not exist yet. Create Dev Ignore before editing rules.",
			PROJECT_IGNORE_FILE_NAME,
		));
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut canonical_paths = paths
		.into_iter()
		.map(|path| {
			fs::canonicalize(&path)
				.map_err(|error| format!("Could not access {path}: {error}"))
		})
		.collect::<Result<Vec<_>, _>>()?;

	canonical_paths.sort();
	canonical_paths.dedup();

	let mut changed_paths = 0;
	let mut unchanged_paths = 0;
	let mut changed_files = 0;
	let mut changed_directories = 0;
	let mut unchanged_files = 0;
	let mut unchanged_directories = 0;
	let mut appended_rules = Vec::new();
	let mut seen_rules = HashSet::new();

	for path in canonical_paths {
		if !path.starts_with(&root) {
			return Err(format!(
				"Item {} is not inside the project folder.",
				path.display(),
			));
		}

		if path == ignore_file {
			return Err(format!(
				"{} cannot ignore itself.",
				PROJECT_IGNORE_FILE_NAME,
			));
		}

		let metadata = fs::metadata(&path)
			.map_err(|error| format!("Could not read {}: {error}", path.display()))?;

		if !metadata.is_file() && !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				path.display(),
			));
		}

		let is_directory = metadata.is_dir();
		let currently_ignored = project_ignore.is_ignored(
			&path,
			is_directory,
		);

		if currently_ignored == ignore_paths {
			unchanged_paths += 1;
			if is_directory {
				unchanged_directories += 1;
			} else {
				unchanged_files += 1;
			}
			continue;
		}

		let relative_path = normalize_relative_rule_path(
			&root,
			&path,
		)?;
		let rules = if ignore_paths {
			vec![exact_ignore_rule(
				&relative_path,
				is_directory,
			)]
		} else {
			exact_unignore_rules(
				&relative_path,
				is_directory,
			)
		};

		for rule in rules {
			if seen_rules.insert(rule.clone()) {
				appended_rules.push(rule);
			}
		}

		changed_paths += 1;
		if is_directory {
			changed_directories += 1;
		} else {
			changed_files += 1;
		}
	}

	append_managed_rules(
		&ignore_file,
		&appended_rules,
	)?;

	Ok(ProjectIgnoreUpdateResult {
		operation_id,
		changed_paths,
		unchanged_paths,
		changed_files,
		changed_directories,
		unchanged_files,
		unchanged_directories,
	})
}

#[tauri::command]
pub fn create_project_ignore(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<bool, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	create_project_ignore_blocking(root_folder)
}

#[tauri::command]
pub fn update_project_ignore(
	root_folder: String,
	paths: Vec<String>,
	ignore_paths: bool,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ProjectIgnoreUpdateResult, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	update_project_ignore_blocking(
		root_folder,
		paths,
		ignore_paths,
	)
}

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
