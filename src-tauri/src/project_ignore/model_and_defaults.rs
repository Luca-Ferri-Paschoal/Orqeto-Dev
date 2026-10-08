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

