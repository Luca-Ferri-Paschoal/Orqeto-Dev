use super::{redact_file_content, redact_git_diff, REDACTED_VALUE};

#[test]
fn env_files_redact_every_non_empty_assignment_value() {
	let content = "PUBLIC_URL=https://example.com\nAPI_TOKEN=abc123\nEMPTY=\n# comment\nprivate-key-body\n";
	let redacted = redact_file_content("./.env.local", content.to_string());
	assert_eq!(
		redacted,
		format!(
			"PUBLIC_URL={0}\nAPI_TOKEN={0}\nEMPTY=\n# comment\n{0}\n",
			REDACTED_VALUE,
		),
	);
}

#[test]
fn config_files_redact_sensitive_keys_without_hiding_normal_fields() {
	let content = "{\n  \"name\": \"demo\",\n  \"api_key\": \"abc\",\n  \"nestedAccessToken\": \"def\"\n}\n";
	let redacted = redact_file_content("./config.json", content.to_string());
	assert!(redacted.contains("\"name\": \"demo\""));
	assert!(redacted.contains("\"api_key\": \"[REDACTED]\""));
	assert!(redacted.contains("\"nestedAccessToken\": \"[REDACTED]\""));
	assert!(!redacted.contains("abc"));
	assert!(!redacted.contains("def"));
}

#[test]
fn url_credentials_and_sensitive_query_values_are_redacted() {
	let content = "DATABASE_URL=postgres://user:pass@example.com/db?sslmode=require&token=abc";
	let redacted = redact_file_content("./settings.txt", content.to_string());
	assert_eq!(
		redacted,
		"DATABASE_URL=postgres://[REDACTED]@example.com/db?sslmode=require&token=[REDACTED]",
	);
}

#[test]
fn high_confidence_token_prefixes_are_redacted_in_regular_text() {
	let content = "request failed with whs_v1_abc_DEF-123 in the response";
	let redacted = redact_file_content("./debug.log", content.to_string());
	assert_eq!(
		redacted,
		"request failed with whs_v1_[REDACTED] in the response",
	);
}

#[test]
fn git_diff_redacts_env_values_without_damaging_diff_headers() {
	let diff = "diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-API_TOKEN=old\n+API_TOKEN=new\n";
	let redacted = redact_git_diff(diff.to_string());
	assert!(redacted.contains("diff --git a/.env b/.env"));
	assert!(redacted.contains("-API_TOKEN=[REDACTED]"));
	assert!(redacted.contains("+API_TOKEN=[REDACTED]"));
	assert!(!redacted.contains("old"));
	assert!(!redacted.contains("new"));
}

#[test]
fn secret_detection_counts_redacted_env_and_config_values() {
	assert_eq!(
		super::secret_exposure_count(".env", "TOKEN=abc\nPUBLIC_URL=https://example.com\n"),
		2,
	);
	assert_eq!(
		super::secret_exposure_count("config.json", "\"apiKey\": \"[REDACTED]\""),
		1,
	);
}

#[test]
fn git_diff_secret_summary_identifies_protected_files() {
	let diff = "diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-TOKEN=old\n+TOKEN=new\n";
	let summary = super::git_diff_secret_summary(diff);
	assert_eq!(summary.protected_paths.len(), 1);
	assert!(summary.secret_count >= 2);
}
