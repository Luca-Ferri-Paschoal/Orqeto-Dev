impl OverlayUndoState {
	pub fn new() -> Self {
		Self {
			histories: Mutex::new(HashMap::new()),
			project_access: Arc::new(Mutex::new(ProjectAccessState::default())),
		}
	}

	pub(crate) fn has_active_mutations(&self) -> bool {
		self.project_access
			.lock()
			.map(|access| !access.writers.is_empty())
			.unwrap_or(true)
	}

	pub(crate) fn is_project_mutating(&self, root: &Path) -> Result<bool, String> {
		let access = self
			.project_access
			.lock()
			.map_err(|_| "The operation coordinator became unavailable.".to_string())?;
		Ok(access.writers.iter().any(|writer| roots_overlap(root, writer)))
	}

	pub(crate) fn begin_project_read(&self, root_folder: &str) -> Result<ProjectReadGuard, String> {
		let root = canonicalize_existing(Path::new(root_folder))?;
		let mut access = self
			.project_access
			.lock()
			.map_err(|_| "The operation coordinator became unavailable.".to_string())?;

		if access.writers.iter().any(|writer| roots_overlap(&root, writer)) {
			return Err(
				"A modification operation is already in progress in this project or an overlapping root.".to_string(),
			);
		}

		*access.readers.entry(root.clone()).or_insert(0) += 1;
		Ok(ProjectReadGuard {
			root,
			project_access: Arc::clone(&self.project_access),
		})
	}

	pub(crate) fn begin_project_mutation(&self, root_folder: &str) -> Result<ProjectMutationGuard, String> {
		if startup_tasks_pending()? {
			return Err("Startup recovery is still running. Wait for initialization before modifying this project.".to_string());
		}
		if mutation_protection_reason().is_some() {
			return Err(
				"Project modifications are blocked because a previous recovery requires attention. Restart Orqeto after preserving or fixing the files identified in the backup.".to_string(),
			);
		}

		let root = canonicalize_existing(Path::new(root_folder))?;
		let mut access = self
			.project_access
			.lock()
			.map_err(|_| "The operation coordinator became unavailable.".to_string())?;

		let writer_conflict = access.writers.iter().any(|writer| roots_overlap(&root, writer));
		let reader_conflict = access
			.readers
			.iter()
			.any(|(reader, count)| *count > 0 && roots_overlap(&root, reader));
		if writer_conflict || reader_conflict {
			return Err(
				"A read or modification operation is already in progress in this project or an overlapping root.".to_string(),
			);
		}

		access.writers.insert(root.clone());
		Ok(ProjectMutationGuard {
			root,
			project_access: Arc::clone(&self.project_access),
		})
	}

	pub(crate) fn load_persisted_histories(&self) -> Result<(), String> {
		let result = (|| {
			let directories = storage::snapshot_directories_by_class(storage::StorageClass::ActiveUndo)?;
			let mut by_operation = HashMap::<String, UndoSnapshot>::new();

			for directory in directories {
				let Some(snapshot) = load_persisted_undo_snapshot(&directory)? else {
					continue;
				};
				let score = (
					snapshot.source_fingerprints.len(),
					snapshot.files.len(),
					snapshot.backup_directories.len(),
				);
				let replace = by_operation
					.get(&snapshot.operation_id)
					.map(|existing| {
						(
							existing.source_fingerprints.len(),
							existing.files.len(),
							existing.backup_directories.len(),
						) < score
					})
					.unwrap_or(true);
				if replace {
					by_operation.insert(snapshot.operation_id.clone(), snapshot);
				}
			}

			let mut loaded = HashMap::<PathBuf, Vec<UndoSnapshot>>::new();
			for snapshot in by_operation.into_values() {
				loaded.entry(snapshot.root.clone()).or_default().push(snapshot);
			}
			for history in loaded.values_mut() {
				history.sort_by_key(|snapshot| snapshot.applied_at_unix_ms);
				trim_undo_history(history, MAX_UNDO_HISTORY_ENTRIES);
			}

			let mut histories = self.histories
				.lock()
				.map_err(|_| "Undo state became unavailable while restoring persistent history.".to_string())?;
			*histories = loaded;
			Ok(())
		})();

		if let Err(error) = &result {
			protect_mutations(format!(
				"Persistent application history could not be restored safely: {error}",
			));
		}
		result
	}
}

