/// A separate, explicitly approved irreversible operation. Nothing here uses
/// the snapshot store, Undo history or the rollback journal.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermanentDeleteResult {
    deleted_files: usize,
    deleted_directories: usize,
    deleted_bytes: u64,
}

struct PermanentDeleteTree {
    files: Vec<(PathBuf, u64)>,
    directories: Vec<PathBuf>,
}

fn reject_sensitive_permanent_entry(relative: &Path) -> Result<(), String> {
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("An unsafe permanent deletion path was rejected.".into());
        };
        let name = name.to_string_lossy().to_ascii_lowercase();
        if name == ".git" || name == ".ssh" || name == ".npmrc" || name == ".pypirc" ||
            name == ".orqeto-devignore" || name == ".orqeto-dev-delete.json" ||
            name == ".env" || name.starts_with(".env.") || name.ends_with(".env") ||
            name.ends_with(".pem") || name.ends_with(".key") || name == "credentials.json" ||
            name == "secrets.json" {
            return Err(format!(
                "Permanent deletion refused a potentially sensitive entry: {}. Remove or handle it separately; AI cannot authorize deleting secrets.",
                normalize_relative_display(relative),
            ));
        }
    }
    Ok(())
}

fn inspect_permanent_delete_tree(root: &Path, directories: &[PathBuf]) -> Result<PermanentDeleteTree, String> {
    let mut budget = TraversalBudget::default();
    let mut tree = PermanentDeleteTree { files: Vec::new(), directories: Vec::new() };
    for relative_root in directories {
        let absolute_root = root.join(relative_root);
        let canonical = canonicalize_existing(&absolute_root)?;
        if !canonical.starts_with(root) {
            return Err("Permanent deletion would escape the project root.".into());
        }
        let mut stack = vec![canonical];
        while let Some(directory) = stack.pop() {
            let relative = directory.strip_prefix(root)
                .map_err(|_| "Permanent deletion escaped the project root.".to_string())?;
            reject_sensitive_permanent_entry(relative)?;
            safe_fs::validate_project_relative_path(root, relative)?;
            budget.record_directory(PROJECT_DISCOVERY_LIMITS)
                .map_err(|error| overlay_traversal_limit_error("Permanent deletion", error))?;
            budget.record_path(&directory, PROJECT_DISCOVERY_LIMITS)
                .map_err(|error| overlay_traversal_limit_error("Permanent deletion", error))?;
            let metadata = fs::symlink_metadata(&directory)
                .map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
            if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
                return Err(format!("Permanent deletion found an unsafe directory: {}", directory.display()));
            }
            tree.directories.push(relative.to_path_buf());
            let entries = fs::read_dir(&directory)
                .map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
            for entry in entries {
                let entry = entry.map_err(|error| format!("Could not inspect generated directory: {error}"))?;
                let path = entry.path();
                let relative = path.strip_prefix(root)
                    .map_err(|_| "Permanent deletion escaped the project root.".to_string())?;
                budget.record_entry(PROJECT_DISCOVERY_LIMITS)
                    .map_err(|error| overlay_traversal_limit_error("Permanent deletion", error))?;
                budget.record_path(&path, PROJECT_DISCOVERY_LIMITS)
                    .map_err(|error| overlay_traversal_limit_error("Permanent deletion", error))?;
                reject_sensitive_permanent_entry(relative)?;
                let metadata = fs::symlink_metadata(&path)
                    .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
                if safe_fs::metadata_is_link_or_reparse(&metadata) {
                    return Err(format!("Permanent deletion rejected a symlink/junction: {}", path.display()));
                }
                if metadata.is_dir() {
                    let canonical_child = canonicalize_existing(&path)?;
                    if !canonical_child.starts_with(root) {
                        return Err(format!("Permanent deletion would escape the project root: {}", path.display()));
                    }
                    stack.push(canonical_child);
                } else if metadata.is_file() {
                    let extension = path.extension().and_then(|value| value.to_str())
                        .unwrap_or("").to_ascii_lowercase();
                    let inspect_config = matches!(extension.as_str(),
                        "json" | "yaml" | "yml" | "toml" | "ini" | "conf" | "properties");
                    if inspect_config && metadata.len() <= 256 * 1024 &&
                        scan_regular_file_for_secrets(relative, &path)? > 0 {
                        return Err(format!(
                            "Permanent deletion refused a generated file containing a detectable secret: {}.",
                            normalize_relative_display(relative),
                        ));
                    }
                    budget.record_file(PROJECT_DISCOVERY_LIMITS)
                        .map_err(|error| overlay_traversal_limit_error("Permanent deletion", error))?;
                    tree.files.push((relative.to_path_buf(), metadata.len()));
                } else {
                    return Err(format!("Permanent deletion rejected a special file: {}", path.display()));
                }
            }
        }
    }
    tree.directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    Ok(tree)
}

fn delete_generated_directories_blocking(root: &Path, paths: &[String]) -> Result<PermanentDeleteResult, String> {
    if paths.is_empty() || paths.len() > MAX_DELETE_MANIFEST_PATHS {
        return Err("No valid permanent deletion paths were provided.".into());
    }
    let directories = parse_permanent_directory_paths(root, paths)?;
    let tree = inspect_permanent_delete_tree(root, &directories)?;
    let mut result = PermanentDeleteResult { deleted_files: 0, deleted_directories: 0, deleted_bytes: 0 };
    // All descendants are inspected before the first destructive step. Each
    // mutation also rechecks the project boundary and reparse-point status.
    for (relative, size) in tree.files {
        let path = root.join(&relative);
        if let Err(error) = safe_fs::validate_project_relative_path(root, &relative) {
            return Err(format!("Permanent deletion partially completed ({} files): {error}", result.deleted_files));
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Permanent deletion partially completed ({} files): {error}", result.deleted_files))?;
        if !metadata.is_file() || safe_fs::metadata_is_link_or_reparse(&metadata) || metadata.len() != size {
            return Err(format!("Permanent deletion stopped after {} files because {} changed.", result.deleted_files, path.display()));
        }
        fs::remove_file(&path).map_err(|error| format!(
            "Permanent deletion stopped after {} files at {}: {error}. Deleted content is not in Undo.",
            result.deleted_files, path.display(),
        ))?;
        result.deleted_files += 1;
        result.deleted_bytes = result.deleted_bytes.saturating_add(size);
    }
    for relative in tree.directories {
        safe_fs::validate_project_relative_path(root, &relative).map_err(|error| format!(
            "Permanent deletion stopped after {} files: {error}", result.deleted_files,
        ))?;
        let path = root.join(&relative);
        let metadata = fs::symlink_metadata(&path).map_err(|error| format!(
            "Permanent deletion stopped after {} files: {error}", result.deleted_files,
        ))?;
        if !metadata.is_dir() || safe_fs::metadata_is_link_or_reparse(&metadata) {
            return Err(format!("Permanent deletion stopped because {} changed.", path.display()));
        }
        fs::remove_dir(&path).map_err(|error| format!(
            "Permanent deletion stopped after {} files at {}: {error}. Deleted content is not in Undo.",
            result.deleted_files, path.display(),
        ))?;
        result.deleted_directories += 1;
    }
    Ok(result)
}

#[tauri::command]
pub async fn delete_project_generated_directories_permanently(
    root_folder: String,
    relative_paths: Vec<String>,
    confirmed: bool,
    undo_state: State<'_, OverlayUndoState>,
) -> Result<PermanentDeleteResult, String> {
    if !confirmed {
        return Err("Permanent deletion requires an explicit in-app user confirmation.".into());
    }
    let _guard = undo_state.begin_project_mutation(&root_folder)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonicalize_existing(Path::new(&root_folder))?;
        delete_generated_directories_blocking(&root, &relative_paths)
    })
    .await
    .map_err(|error| format!("Permanent deletion was interrupted; some files may already be gone and cannot be recovered with Undo: {error}"))?
}
