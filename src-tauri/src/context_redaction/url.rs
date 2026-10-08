fn redact_url_like_values(line: &str) -> String {
	let Some(scheme_index) = line.find("://") else {
		return line.to_string();
	};
	let start = line[..scheme_index]
		.rfind(|character: char| character.is_whitespace() || matches!(character, '\'' | '"' | '(' | '[' | '{'))
		.map_or(0, |index| index + 1);
	let end = line[scheme_index + 3..]
		.find(|character: char| character.is_whitespace() || matches!(character, '\'' | '"' | ')' | ']' | '}'))
		.map_or(line.len(), |index| scheme_index + 3 + index);
	let url = &line[start..end];
	let sanitized = sanitize_url_fragment(url);
	if sanitized == url {
		return line.to_string();
	}
	format!("{}{}{}", &line[..start], sanitized, &line[end..])
}

fn sanitize_url_fragment(url: &str) -> String {
	let Some(scheme_end) = url.find("://") else {
		return url.to_string();
	};
	let authority_start = scheme_end + 3;
	let authority_end = url[authority_start..]
		.find(|character| matches!(character, '/' | '?' | '#'))
		.map_or(url.len(), |index| authority_start + index);
	let authority = &url[authority_start..authority_end];
	let mut result = url.to_string();

	if let Some(at_index) = authority.rfind('@') {
		let user_info = &authority[..at_index];
		if user_info.contains(':') {
			let start = authority_start;
			let end = authority_start + at_index + 1;
			result.replace_range(start..end, &format!("{REDACTED_VALUE}@"));
		}
	}

	let Some(query_index) = result.find('?') else {
		return result;
	};
	let fragment_index = result[query_index + 1..]
		.find('#')
		.map_or(result.len(), |index| query_index + 1 + index);
	let query = result[query_index + 1..fragment_index].to_string();
	let sanitized_query = query
		.split('&')
		.map(|part| {
			let Some((key, _value)) = part.split_once('=') else {
				return part.to_string();
			};
			if is_sensitive_field(&normalize_field_name(key)) {
				format!("{key}={REDACTED_VALUE}")
			} else {
				part.to_string()
			}
		})
		.collect::<Vec<_>>()
		.join("&");
	result.replace_range(query_index + 1..fragment_index, &sanitized_query);
	result
}


fn url_secret_exposure_count(line: &str) -> usize {
	let Some(scheme_index) = line.find("://") else {
		return 0;
	};
	let start = line[..scheme_index]
		.rfind(|character: char| character.is_whitespace() || matches!(character, '\'' | '"' | '(' | '[' | '{'))
		.map_or(0, |index| index + 1);
	let end = line[scheme_index + 3..]
		.find(|character: char| character.is_whitespace() || matches!(character, '\'' | '"' | ')' | ']' | '}'))
		.map_or(line.len(), |index| scheme_index + 3 + index);
	url_fragment_secret_exposure_count(&line[start..end])
}

fn url_fragment_secret_exposure_count(url: &str) -> usize {
	let Some(scheme_end) = url.find("://") else {
		return 0;
	};
	let authority_start = scheme_end + 3;
	let authority_end = url[authority_start..]
		.find(|character| matches!(character, '/' | '?' | '#'))
		.map_or(url.len(), |index| authority_start + index);
	let authority = &url[authority_start..authority_end];
	let mut count = 0_usize;

	if let Some(at_index) = authority.rfind('@') {
		if authority[..at_index].contains(':') {
			count += 1;
		}
	}

	let Some(query_index) = url.find('?') else {
		return count;
	};
	let fragment_index = url[query_index + 1..]
		.find('#')
		.map_or(url.len(), |index| query_index + 1 + index);
	for part in url[query_index + 1..fragment_index].split('&') {
		let Some((key, _value)) = part.split_once('=') else {
			continue;
		};
		if is_sensitive_field(&normalize_field_name(key)) {
			count += 1;
		}
	}

	count
}
