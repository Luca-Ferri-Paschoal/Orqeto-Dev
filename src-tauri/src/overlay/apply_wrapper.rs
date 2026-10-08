fn apply_overlay_manifest_blocking(
    root: PathBuf,
    manifest: &OverlayManifest,
    destination_relative_path: String,
    source_prefix: String,
) -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {
    apply_overlay_manifest_blocking_with_review(
        root, manifest, destination_relative_path, source_prefix, &[], None,
    )
}

