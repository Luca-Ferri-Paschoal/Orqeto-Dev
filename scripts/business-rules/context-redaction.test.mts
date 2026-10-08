import { filesApplyOutcomeFromResult } from "../../src/features/context/operationOutcome.ts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

// BR-CTX-011
void test("BR-CTX-011 Context output redacts env/config/URL secrets before AI exposure", async () => {
	const [
		redaction,
		redactionUrl,
		contextText,
		gitState,
		gitRead,
		diagnosticRead,
		validationOutput,
		workflowPrompt,
		gitFormatter,
		docs,
	] = await Promise.all([
		read("src-tauri/src/context_redaction/core.rs"),
		read("src-tauri/src/context_redaction/url.rs"),
		read("src-tauri/src/lib/context_text.rs"),
		read("src-tauri/src/git_context/repository_state.rs"),
		read("src-tauri/src/git_context/git_apply_execution.rs"),
		read("src-tauri/src/diagnostics/lint_fix_apply.rs"),
		read("src-tauri/src/diagnostics/bounded_io.rs"),
		read("src/features/context/formatAiWorkflowPrompt.ts"),
		read("src/features/context/formatGitCommitContext.ts"),
		read("docs/AI.md"),
	])

	assert.match(
		redaction,
		/REDACTED_VALUE: &str = "\[REDACTED\]"/,
	)
	assert.match(
		redaction,
		/is_env_like_path[\s\S]*redact_env_line/,
	)
	assert.match(
		redaction,
		/SENSITIVE_FIELD_SUFFIXES[\s\S]*"token"/,
	)
	assert.match(
		redaction,
		/HIGH_CONFIDENCE_SECRET_PREFIXES[\s\S]*whs_v1_/,
	)
	assert.match(
		redactionUrl,
		/user_info\.contains\(':'\)/,
	)
	assert.match(
		redactionUrl,
		/is_sensitive_field\(&normalize_field_name\(key\)\)/,
	)
	assert.match(
		contextText,
		/context_redaction::redact_file_content/,
	)
	assert.match(
		gitState,
		/context_redaction::redact_git_diff\(staged_diff\)/,
	)
	assert.match(
		gitState,
		/context_redaction::redact_git_diff\(unstaged_diff\)/,
	)
	assert.match(
		gitRead,
		/context_redaction::redact_file_content/,
	)
	assert.match(
		diagnosticRead,
		/context_redaction::redact_file_content/,
	)
	assert.match(
		validationOutput,
		/context_redaction::redact_unstructured_text/,
	)
	assert.match(
		workflowPrompt,
		/redactionRules[\s\S]*`\[REDACTED\]`[\s\S]*Nunca tente inferir/,
	)
	assert.match(
		gitFormatter,
		/segredos substituídos por `\[REDACTED\]`/,
	)
	assert.match(
		docs,
		/Context secret redaction[\s\S]*single linear text pass/i,
	)
})

// BR-CTX-012
void test("BR-CTX-012 AI-delivered Apply protects secret-bearing files and reports blocked counts", async () => {
	const [
		secretScan,
		overlayProtection,
		overlayModel,
		gitProtection,
		outcome,
		workflowPrompt,
		protocol,
		ptProtocol,
		docs,
	] = await Promise.all([
		read("src-tauri/src/context_redaction/scan.rs"),
		read("src-tauri/src/overlay/secret_protection.rs"),
		read("src-tauri/src/overlay/model.rs"),
		read("src-tauri/src/git_context/secret_protection.rs"),
		read("src/features/context/operationOutcome/apply.ts"),
		read("src/features/context/formatAiWorkflowPrompt.ts"),
		read("src/features/context/generatedContent/protocol.ts"),
		read("src/infra/i18n/locales/ptBR/protocol.ts"),
		read("docs/AI.md"),
	])

	assert.match(
		secretScan,
		/secret_exposure_count[\s\S]*secret_scan_fails_closed_for_path/,
	)
	assert.match(
		overlayProtection,
		/source_secret_counts[\s\S]*scan_regular_file_for_secrets/,
	)
	assert.match(
		overlayProtection,
		/safe_deletes[\s\S]*protected_paths/,
	)
	assert.match(
		overlayModel,
		/protected_secret_files: usize[\s\S]*detected_secrets: usize/,
	)
	assert.match(
		gitProtection,
		/validate_git_secret_protection[\s\S]*Git patch was blocked/,
	)
	assert.match(
		outcome,
		/kind: "protected"[\s\S]*detectedSecrets/,
	)
	assert.match(
		workflowPrompt,
		/somente informativos[\s\S]*Não crie, edite, substitua, renomeie nem exclua/,
	)
	assert.match(
		protocol,
		/protocol\.redactionApplyProtection/,
	)
	assert.match(
		ptProtocol,
		/Arquivo com valor redigido ou chave\/segredo detectado é somente informativo/,
	)
	assert.match(
		docs,
		/Files-mode Apply[\s\S]*Git-mode Apply/,
	)
	const protectedOutcome = filesApplyOutcomeFromResult(
		"C:/repo",
		{
			operationId: "files-apply:protected",
			appliedAtUnixMs: null,
			addedFiles: 0,
			replacedFiles: 0,
			deletedFiles: 0,
			unchangedFiles: 0,
			addedDirectories: 0,
			replacedDirectories: 0,
			deletedDirectories: 0,
			unchangedDirectories: 0,
			protectedSecretFiles: 2,
			detectedSecrets: 3,
		},
	)
	assert.equal(
		protectedOutcome.status,
		"partial",
	)
	assert.equal(
		protectedOutcome.undoReference,
		null,
	)
	assert.deepEqual(protectedOutcome.counters.at(-1), {
		kind: "protected",
		files: 2,
		directories: 0,
		detectedSecrets: 3,
	})
})
