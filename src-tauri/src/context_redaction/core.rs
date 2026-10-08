const REDACTED_VALUE: &str = "[REDACTED]";

const SENSITIVE_FIELD_NAMES: &[&str] = &[
	"apikey",
	"authorization",
	"cookie",
	"credentials",
	"hmackey",
	"mediakey",
	"password",
	"passwordhash",
	"privatekey",
	"secretkey",
	"setcookie",
];

const SENSITIVE_FIELD_SUFFIXES: &[&str] = &[
	"apikey",
	"authorization",
	"credential",
	"credentials",
	"encryptionkey",
	"hmackey",
	"password",
	"passwordhash",
	"privatekey",
	"secret",
	"secretkey",
	"signingkey",
	"token",
];

const HIGH_CONFIDENCE_SECRET_PREFIXES: &[(&str, &str)] = &[
	("whs_v1_", "whs_v1_[REDACTED]"),
];

pub(crate) fn redact_file_content(
	relative_path: &str,
	content: String,
) -> String {
	if is_env_like_path(relative_path) {
		return map_lines_preserving_endings(&content, redact_env_line);
	}

	let config_like = is_config_like_path(relative_path);
	let has_known_prefix = HIGH_CONFIDENCE_SECRET_PREFIXES
		.iter()
		.any(|(prefix, _)| content.contains(prefix));
	let has_url = content.contains("://");

	if !config_like && !has_known_prefix && !has_url {
		return content;
	}

	map_lines_preserving_endings(&content, |line| {
		redact_general_line(
			line,
			config_like,
		)
	})
}

pub(crate) fn redact_unstructured_text(content: String) -> String {
	map_lines_preserving_endings(&content, |line| redact_general_line(line, true))
}

pub(crate) fn redact_git_diff(diff: String) -> String {
	let mut current_path: Option<String> = None;

	map_lines_preserving_endings(&diff, |line| {
		if let Some(path) = diff_path_from_header(line) {
			current_path = Some(path);
			return redact_general_line(line, false);
		}

		let Some(path) = current_path.as_deref() else {
			return redact_general_line(line, false);
		};

		if line.starts_with("+++") || line.starts_with("---") || line.starts_with("@@") || line.starts_with("diff --git ") {
			return redact_general_line(line, false);
		}

		let Some(prefix) = line.as_bytes().first().copied() else {
			return String::new();
		};
		if !matches!(prefix, b'+' | b'-' | b' ') {
			return redact_general_line(line, false);
		}

		let body = &line[1..];
		let redacted = if is_env_like_path(path) {
			redact_env_line(body)
		} else {
			redact_general_line(
				body,
				is_config_like_path(path),
			)
		};
		format!("{}{}", prefix as char, redacted)
	})
}

fn redact_general_line(
	line: &str,
	config_like: bool,
) -> String {
	let mut redacted = if config_like {
		redact_sensitive_assignment(line)
	} else {
		line.to_string()
	};
	redacted = redact_url_like_values(&redacted);
	redact_known_secret_prefixes(redacted)
}

fn redact_env_line(line: &str) -> String {
	let trimmed = line.trim_start();
	if trimmed.is_empty() || trimmed.starts_with('#') {
		return line.to_string();
	}

	let Some(separator_index) = trimmed.find('=') else {
		let indentation = &line[..line.len() - trimmed.len()];
		return format!("{indentation}{REDACTED_VALUE}");
	};
	let value = &trimmed[separator_index + 1..];
	if value.trim().is_empty() {
		return line.to_string();
	}

	let indentation = &line[..line.len() - trimmed.len()];
	let key = &trimmed[..=separator_index];
	format!("{indentation}{key}{REDACTED_VALUE}")
}

fn redact_sensitive_assignment(line: &str) -> String {
	let Some((separator_index, separator)) = assignment_separator(line) else {
		return line.to_string();
	};
	let key = field_name_before_separator(&line[..separator_index]);
	if key.is_empty() || !is_sensitive_field(&key) {
		return line.to_string();
	}

	let prefix = &line[..=separator_index];
	let value = &line[separator_index + separator.len_utf8()..];
	let leading = &value[..value.len() - value.trim_start().len()];
	let trimmed = value.trim_start();
	let comma = if trimmed.trim_end().ends_with(',') { "," } else { "" };
	let quoted = matches!(trimmed.as_bytes().first(), Some(b'\'' | b'"'));
	let replacement = if quoted {
		format!("\"{REDACTED_VALUE}\"")
	} else {
		REDACTED_VALUE.to_string()
	};

	format!("{prefix}{leading}{replacement}{comma}")
}

fn assignment_separator(line: &str) -> Option<(usize, char)> {
	for (index, character) in line.char_indices() {
		if character == ':' {
			return Some((index, character));
		}
		if character != '=' {
			continue;
		}
		let previous = line[..index].chars().next_back();
		let next = line[index + 1..].chars().next();
		if matches!(previous, Some('=' | '!' | '<' | '>')) || matches!(next, Some('=' | '>')) {
			continue;
		}
		return Some((index, character));
	}
	None
}

fn field_name_before_separator(value: &str) -> String {
	let candidate = value
		.trim()
		.rsplit(|character: char| character.is_whitespace() || matches!(character, '{' | '[' | '(' | ','))
		.next()
		.unwrap_or("")
		.trim_matches(|character| matches!(character, '\'' | '"'));
	normalize_field_name(candidate)
}

fn normalize_field_name(field_name: &str) -> String {
	field_name
		.chars()
		.filter(|character| character.is_ascii_alphanumeric())
		.map(|character| character.to_ascii_lowercase())
		.collect()
}

fn is_sensitive_field(field_name: &str) -> bool {
	SENSITIVE_FIELD_NAMES.contains(&field_name) ||
		SENSITIVE_FIELD_SUFFIXES
			.iter()
			.any(|suffix| field_name.ends_with(suffix))
}

fn redact_known_secret_prefixes(mut value: String) -> String {
	for &(prefix, replacement) in HIGH_CONFIDENCE_SECRET_PREFIXES {
		let mut search_from = 0;
		while let Some(relative_index) = value[search_from..].find(prefix) {
			let start = search_from + relative_index;
			let mut end = start + prefix.len();
			for character in value[end..].chars() {
				if !matches!(character, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_' | '-') {
					break;
				}
				end += character.len_utf8();
			}
			if end == start + prefix.len() {
				search_from = end;
				continue;
			}
			value.replace_range(start..end, replacement);
			search_from = start + replacement.len();
		}
	}
	value
}

fn is_env_like_path(path: &str) -> bool {
	let name = path.rsplit(|character| character == '/' || character == '\\').next().unwrap_or(path).to_ascii_lowercase();
	name == ".env" || name.starts_with(".env.") || name.ends_with(".env") || name.contains(".env.")
}

fn is_config_like_path(path: &str) -> bool {
	let extension = path
		.rsplit_once('.')
		.map(|(_, extension)| extension.to_ascii_lowercase())
		.unwrap_or_default();
	matches!(
		extension.as_str(),
		"json" | "yaml" | "yml" | "toml" | "ini" | "conf" | "config" | "properties"
	)
}

fn diff_path_from_header(line: &str) -> Option<String> {
	if let Some(path) = line.strip_prefix("+++ b/") {
		return Some(path.trim_matches('"').to_string());
	}
	let rest = line.strip_prefix("diff --git ")?;
	let path = rest.split_whitespace().nth(1)?.strip_prefix("b/")?;
	Some(path.trim_matches('"').to_string())
}

fn map_lines_preserving_endings<F>(
	content: &str,
	mut transform: F,
) -> String
where
	F: FnMut(&str) -> String,
{
	let mut output = String::with_capacity(content.len());
	for segment in content.split_inclusive('\n') {
		let (line, ending) = if let Some(line) = segment.strip_suffix("\r\n") {
			(line, "\r\n")
		} else if let Some(line) = segment.strip_suffix('\n') {
			(line, "\n")
		} else {
			(segment, "")
		};
		output.push_str(&transform(line));
		output.push_str(ending);
	}
	output
}

