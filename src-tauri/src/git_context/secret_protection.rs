fn current_git_file_secret_count(
	root: &Path,
	relative_path: &str,
) -> Result<usize, String> {
	let path = root.join(relative_path);
	let metadata = match fs::metadata(&path) {
		Ok(metadata) => metadata,
		Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
		Err(error) => {
			return Err(format!(
				"Could not inspect protected content at {relative_path}: {error}",
			));
		}
	};
	if !metadata.is_file() {
		return Ok(0);
	}
	if metadata.len() > crate::context_redaction::MAX_SECRET_SCAN_TEXT_BYTES {
		return Ok(usize::from(
			crate::context_redaction::secret_scan_fails_closed_for_path(relative_path),
		));
	}

	let bytes = fs::read(&path)
		.map_err(|error| format!("Could not inspect protected content at {relative_path}: {error}"))?;
	let Some(content) = decode_text(bytes) else {
		return Ok(usize::from(
			crate::context_redaction::secret_scan_fails_closed_for_path(relative_path),
		));
	};
	Ok(crate::context_redaction::secret_exposure_count(
		relative_path,
		&content,
	))
}

fn validate_git_secret_protection(
	root: &Path,
	patch_text: &str,
	affected_paths: &[String],
) -> Result<(), String> {
	let mut summary = crate::context_redaction::git_diff_secret_summary(patch_text);

	for relative_path in affected_paths {
		let count = current_git_file_secret_count(
			root,
			relative_path,
		)?;
		if count == 0 {
			continue;
		}
		summary.secret_count = summary.secret_count.saturating_add(count);
		summary.protected_paths.insert(relative_path.clone());
	}

	if summary.protected_paths.is_empty() {
		return Ok(());
	}

	Err(format!(
		"Git patch was blocked because {} file(s) contain protected keys/secrets ({} detection(s)). Redacted or secret-bearing files are informational only and cannot be modified by AI-delivered code.",
		summary.protected_paths.len(),
		summary.secret_count,
	))
}

#[cfg(test)]
mod secret_protection_tests {
	use super::*;

	#[test]
	fn git_patch_with_secret_material_is_blocked_before_apply() {
		let patch = "diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-TOKEN=old\n+TOKEN=new\n";
		let error = validate_git_secret_protection(
			Path::new("."),
			patch,
			&[".env".to_string()],
		)
		.err()
		.expect("secret-bearing Git patch should be blocked");
		assert!(error.contains("blocked"));
		assert!(error.contains("keys/secrets"));
	}
}
