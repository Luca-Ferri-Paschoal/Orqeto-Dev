use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::path::{Path, PathBuf};

pub const PROJECT_IGNORE_FILE_NAME: &str = ".orqeto-devignore";

pub struct ProjectIgnore {
	root: PathBuf,
	matcher: Gitignore,
}

impl ProjectIgnore {
	pub fn load(root: &Path) -> Result<Self, String> {
		let mut builder = GitignoreBuilder::new(root);

		builder
			.case_insensitive(cfg!(target_os = "windows"))
			.map_err(|error| format!("Não foi possível configurar as regras de ignore: {error}"))?;

		let ignore_file = root.join(PROJECT_IGNORE_FILE_NAME);

		if ignore_file.is_file() {
			if let Some(error) = builder.add(&ignore_file) {
				return Err(format!(
					"Não foi possível carregar {}: {error}",
					ignore_file.display(),
				));
			}
		}

		let matcher = builder
			.build()
			.map_err(|error| format!("Não foi possível finalizar as regras de ignore: {error}"))?;

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
