pub(crate) const MAX_SECRET_SCAN_TEXT_BYTES: u64 = 16 * 1024 * 1024;

pub(crate) fn secret_exposure_count(
	relative_path: &str,
	content: &str,
) -> usize {
	let env_like = is_env_like_path(relative_path);
	let config_like = is_config_like_path(relative_path);

	content
		.lines()
		.map(|line| {
			if env_like {
				env_line_secret_count(line)
			} else {
				general_line_secret_count(
					line,
					config_like,
				)
			}
		})
		.sum()
}

pub(crate) fn secret_scan_fails_closed_for_path(relative_path: &str) -> bool {
	is_env_like_path(relative_path) || is_config_like_path(relative_path)
}

fn env_line_secret_count(line: &str) -> usize {
	let trimmed = line.trim_start();
	if trimmed.is_empty() || trimmed.starts_with('#') {
		return 0;
	}

	let Some(separator_index) = trimmed.find('=') else {
		return 1;
	};
	let value = &trimmed[separator_index + 1..];
	usize::from(!value.trim().is_empty())
}

fn general_line_secret_count(
	line: &str,
	config_like: bool,
) -> usize {
	let sensitive_assignment = if config_like {
		usize::from(line_has_sensitive_assignment(line))
	} else {
		0
	};

	sensitive_assignment +
		url_secret_exposure_count(line) +
		known_secret_prefix_count(line)
}

fn line_has_sensitive_assignment(line: &str) -> bool {
	let Some((separator_index, _separator)) = assignment_separator(line) else {
		return false;
	};
	let key = field_name_before_separator(&line[..separator_index]);
	!key.is_empty() && is_sensitive_field(&key)
}

fn known_secret_prefix_count(value: &str) -> usize {
	HIGH_CONFIDENCE_SECRET_PREFIXES
		.iter()
		.map(|(prefix, _)| {
			let mut count = 0_usize;
			let mut search_from = 0_usize;
			while let Some(relative_index) = value[search_from..].find(prefix) {
				let start = search_from + relative_index;
				let mut end = start + prefix.len();
				for character in value[end..].chars() {
					if !matches!(character, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_' | '-') {
						break;
					}
					end += character.len_utf8();
				}
				if end > start + prefix.len() {
					count += 1;
				}
				search_from = end.max(start + prefix.len());
			}
			count
		})
		.sum()
}

pub(crate) struct GitDiffSecretSummary {
	pub(crate) protected_paths: std::collections::HashSet<String>,
	pub(crate) secret_count: usize,
}

pub(crate) fn git_diff_secret_summary(diff: &str) -> GitDiffSecretSummary {
	let mut current_path: Option<String> = None;
	let mut protected_paths = std::collections::HashSet::new();
	let mut secret_count = 0_usize;

	for line in diff.lines() {
		if let Some(path) = diff_path_from_header(line) {
			current_path = Some(path);
			continue;
		}

		let Some(path) = current_path.as_deref() else {
			continue;
		};
		if line.starts_with("+++") || line.starts_with("---") || line.starts_with("@@") || line.starts_with("diff --git ") {
			continue;
		}
		let Some(prefix) = line.as_bytes().first().copied() else {
			continue;
		};
		if !matches!(prefix, b'+' | b'-' | b' ') {
			continue;
		}

		let count = secret_exposure_count(
			path,
			&line[1..],
		);
		if count > 0 {
			secret_count = secret_count.saturating_add(count);
			protected_paths.insert(path.to_string());
		}
	}

	GitDiffSecretSummary {
		protected_paths,
		secret_count,
	}
}
