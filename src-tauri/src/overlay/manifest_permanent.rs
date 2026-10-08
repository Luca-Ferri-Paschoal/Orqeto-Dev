const PERMANENT_GENERATED_DIRECTORY_NAMES: &[&str] = &[
    "target", "node_modules", "dist", "build", "coverage", ".next", ".nuxt",
    ".turbo", ".cache", ".vite", ".output", "__pycache__", ".pytest_cache",
];

fn validate_permanent_directory_path(root: &Path, value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.trim() != value || value.contains('\\') ||
        value.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..") {
        return Err(format!("Invalid permanent deletion path: {value}."));
    }
    let relative = parse_relative_path(value)?;
    safe_fs::validate_project_relative_path(root, &relative)?;
    let last = relative.file_name().and_then(|name| name.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if !PERMANENT_GENERATED_DIRECTORY_NAMES.contains(&last.as_str()) ||
        relative.components().count() > 16 {
        return Err(format!(
            "Permanent deletion is restricted to explicitly named generated/cache directories, not source code: {value}."
        ));
    }
    let absolute = root.join(&relative);
    let metadata = fs::symlink_metadata(&absolute)
        .map_err(|error| format!("Permanent deletion target {value} is unavailable: {error}"))?;
    if safe_fs::metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(format!("Permanent deletion target is not a safe regular directory: {value}."));
    }
    if !canonicalize_existing(&absolute)?.starts_with(root) {
        return Err(format!("Permanent deletion target escapes the project root: {value}."));
    }
    Ok(relative)
}

fn parse_permanent_directory_paths(root: &Path, requested: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::<PathBuf>::new();
    for value in requested {
        let relative = validate_permanent_directory_path(root, value)?;
        if paths.iter().any(|previous| path_starts_with_case_insensitive(&relative, previous) ||
            path_starts_with_case_insensitive(previous, &relative)) {
            return Err(format!("Permanent deletion repeats or overlaps another directory: {value}."));
        }
        paths.push(relative);
    }
    paths.sort();
    Ok(paths)
}

fn ensure_separate_deletion_modes(normal: &Path, permanent: &[PathBuf]) -> Result<(), String> {
    if permanent.iter().any(|entry| path_starts_with_case_insensitive(normal, entry) ||
        path_starts_with_case_insensitive(entry, normal)) {
        return Err(format!(
            "Normal deletion and permanent deletion must not overlap: {}. List the generated directory separately and explicitly enumerate normal source paths.",
            normalize_relative_display(normal),
        ));
    }
    Ok(())
}
