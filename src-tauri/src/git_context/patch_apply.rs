#[tauri::command]
pub async fn apply_git_patch(
	root_folder: String,
	patch_path: String,
	expected_patch_fingerprint: String,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ApplyGitPatchResult, String> {
	let _mutation_guard = undo_state.begin_project_mutation(&root_folder)?;
	let blocking_task = tauri::async_runtime::spawn_blocking(move || {
		let prepared = prepare_git_patch_blocking(&root_folder, &patch_path)?;
		if prepared.patch_fingerprint != expected_patch_fingerprint {
			return Err("The .patch/.diff file changed after the preview. Drop it again to validate the current version.".to_string());
		}

		let expected_after_states = simulate_git_patch_after_states(&prepared)?;
		let snapshot = prepare_external_undo_snapshot(
			&root_folder,
			&prepared.affected_paths,
			&expected_after_states,
			prepared.patch_name.clone(),
			prepared.patch_fingerprint.clone(),
			prepared.added_lines,
			prepared.deleted_lines,
		)?;

		// Re-run the strict check after the durable snapshot/journal. The same
		// immutable Arc-backed bytes used for preview, simulation and statistics
		// are fed to Git over stdin again immediately before mutation.
		let check = match execute_git_apply(
			&prepared.repository_root,
			&prepared.root_relative_to_repository,
			&["--check"],
			Arc::clone(&prepared.patch_bytes),
		) {
			Ok(check) => check,
			Err(error) => {
				discard_external_undo_snapshot(snapshot);
				return Err(error);
			}
		};
		if !check.status.success() {
			discard_external_undo_snapshot(snapshot);
			return Err(format!(
				"The patch stopped being applicable during preparation: {}",
				git_failure(&check),
			));
		}

		if let Err(error) = apply_prepared_git_patch(&prepared) {
			return match rollback_external_undo_snapshot(&snapshot) {
				Ok(()) => {
					discard_external_undo_snapshot(snapshot);
					Err(format!("Git rejected patch application: {error}"))
				}
				Err(rollback_error) => Err(format!(
					"Git rejected patch application: {error}. {rollback_error}",
				)),
			};
		}

		let rollback_snapshot = snapshot.clone();
		let (snapshot, file_result) = match finalize_external_undo_snapshot(snapshot) {
			Ok(result) => result,
			Err(error) => {
				return match rollback_external_undo_snapshot(&rollback_snapshot) {
					Ok(()) => {
						discard_external_undo_snapshot(rollback_snapshot);
						Err(format!("The patch was rolled back because final validation failed: {error}"))
					}
					Err(rollback_error) => Err(format!(
						"Final validation failed: {error}. {rollback_error}",
					)),
				};
			}
		};

		Ok((
			ApplyGitPatchResult {
				operation_id: file_result.operation_id.clone(),
				applied_at_unix_ms: file_result
					.applied_at_unix_ms
					.expect("Git Apply always records an Undo snapshot"),
				added_files: file_result.added_files,
				replaced_files: file_result.replaced_files,
				deleted_files: file_result.deleted_files,
				added_directories: file_result.added_directories,
				replaced_directories: file_result.replaced_directories,
				deleted_directories: file_result.deleted_directories,
				added_lines: prepared.added_lines,
				deleted_lines: prepared.deleted_lines,
			},
			snapshot,
		))
	})
	.await;
	let task = match blocking_task {
		Ok(result) => result?,
		Err(error) => {
			let reason = protect_after_interrupted_mutation("Git patch application");
			return Err(format!("{reason} Detalhes: {error}"));
		}
	};

	let (result, snapshot) = task;
	if let Err(error) = record_external_undo_snapshot(&undo_state, snapshot.clone(), undo_history_limit) {
		return match rollback_external_undo_snapshot(&snapshot) {
			Ok(()) => {
				discard_external_undo_snapshot(snapshot);
				Err(format!(
					"The patch was rolled back because Undo history could not be recorded: {error}",
				))
			}
			Err(rollback_error) => Err(format!(
				"Undo history could not be recorded: {error}. {rollback_error}",
			)),
		};
	}

	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn patch_fingerprint_is_content_addressed() {
		let first: Arc<[u8]> = Arc::from(&b"diff --git a/a b/a\n"[..]);
		let same: Arc<[u8]> = Arc::from(&b"diff --git a/a b/a\n"[..]);
		let changed: Arc<[u8]> = Arc::from(&b"diff --git a/a b/b\n"[..]);

		assert_eq!(patch_fingerprint(&first), patch_fingerprint(&same));
		assert_ne!(patch_fingerprint(&first), patch_fingerprint(&changed));
	}

	#[test]
	fn git_command_neutralizes_apply_configuration() {
		let command = configure_git_command(Path::new("git"), Path::new("."));
		let arguments = command
			.get_args()
			.map(|value| value.to_string_lossy().into_owned())
			.collect::<Vec<_>>();
		let joined = arguments.join(" ");

		assert!(joined.contains("apply.ignoreWhitespace=false"));
		assert!(joined.contains("apply.whitespace=warn"));
	}

	#[test]
	fn br_adv_005_git_unsupported_operation_and_path_corpus() {
		for patch in [
			"diff --git a/a.bin b/a.bin\nGIT binary patch\n",
			"diff --git a/a b/a\nold mode 100644\nnew mode 100755\n",
			"diff --git a/a b/b\ncopy from a\ncopy to b\n",
			"diff --git a/link b/link\nnew file mode 120000\n",
			"diff --git a/submodule b/submodule\nnew file mode 160000\n",
			"diff --git a/script b/script\nnew file mode 100755\n",
		] {
			assert!(
				validate_text_patch(patch).is_err(),
				"unsupported Git patch should be rejected: {patch}",
			);
		}

		for unsafe_path in [
			"../escape.ts",
			"/absolute.ts",
			"src\\windows-separator.ts",
			"\"quoted path.ts\"",
		] {
			assert!(
				normalize_declared_patch_path(unsafe_path, false).is_err(),
				"unsafe Git path {unsafe_path} should be rejected",
			);
		}

		assert_eq!(
			normalize_declared_patch_path("a/src/unicode/Δ.ts", true)
				.expect("safe Unicode Git path should be accepted"),
			"src/unicode/Δ.ts",
		);

		let incomplete_rename = "diff --git a/a.ts b/b.ts\nrename from a.ts\n";
		assert!(parse_patch_metadata(incomplete_rename).is_err());
	}

}
