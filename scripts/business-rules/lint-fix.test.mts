import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

// BR-DIAG-001
void test(
	"BR-DIAG-001 Type Check and ESLint stay standardized while Lint Fix uses explicit project command or safe fallback",
	async () => {
		const [
			pane,
			paneStyles,
			lintFixActions,
			desktop,
			types,
			rust,
			lib,
			packageJsonSource,
		] = await Promise.all([
			read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			read("src/features/context/components/ProjectWorkspacePane/style.ts"),
			read("src/features/context/workspace/actions/useLintFixActions.ts"),
			read("src/infra/desktop.ts"),
			read("src/domain/contextContracts.ts"),
			read("src-tauri/src/diagnostics.rs"),
			read("src-tauri/src/lib.rs"),
			read("package.json"),
		])

		assert.match(
			pane,
			/folder\.contextMode\.typecheck[\s\S]*folder\.contextMode\.lintFix[\s\S]*folder\.contextMode\.eslint/,
		)
		assert.match(
			paneStyles,
			/secondaryModeLabel:[\s\S]*"text-\[12px\]"/,
		)
		assert.match(
			paneStyles,
			/validationModeLabel:[\s\S]*"text-\[12px\]"/,
		)
		assert.match(
			pane,
			/const lintFixAvailable = workspace\.diagnosticCapabilities\.lintFixCommand !== null \|\|[\s\S]*workspace\.diagnosticCapabilities\.eslint/,
		)

		const fixWorkflow = lintFixActions
		assert.match(
			fixWorkflow,
			/const customCommand = capabilities\.lintFixCommand[\s\S]*if \(customCommand !== null\)[\s\S]*runProjectValidationCommand\([\s\S]*"lintfix"/,
		)
		assert.match(
			fixWorkflow,
			/if \(!capabilities\.eslint\)[\s\S]*if \(!await requestProjectExecutionTrust\(\s*configuredRootFolder,\s*null,\s*"lintfix",?\s*\)[\s\S]*const result = await fixProjectEslint\(\s*configuredRootFolder,\s*cancellationToken\.backendOperationId,\s*\)/,
		)
		assert.match(
			fixWorkflow,
			/invalidatePreparedReportsAfterLintFix\(configuredRootFolder\)/,
		)

		const internalDiagnosticStart = rust.indexOf("pub async fn generate_project_diagnostic_context(")
		const internalDiagnosticEnd = rust.indexOf(
			"#[tauri::command]\npub async fn run_project_validation_command",
			internalDiagnosticStart,
		)
		const internalDiagnostic = rust.slice(
			internalDiagnosticStart,
			internalDiagnosticEnd,
		)
		assert.match(
			internalDiagnostic,
			/"typecheck" => DiagnosticKind::Typecheck/,
		)
		assert.match(
			internalDiagnostic,
			/"eslint" => DiagnosticKind::Eslint/,
		)
		assert.doesNotMatch(
			internalDiagnostic,
			/orqetoDev|package\.json|run_project_validation_command/,
		)

		const fixPlanStart = rust.indexOf("fn collect_eslint_fix_plan(")
		const fixPlanEnd = rust.indexOf(
			"#[cfg(test)]",
			fixPlanStart,
		)
		const fallbackFix = rust.slice(
			fixPlanStart,
			fixPlanEnd,
		)
		assert.match(
			fallbackFix,
			/\.arg\("--fix-dry-run"\)/,
		)
		assert.match(
			fallbackFix,
			/ProjectIgnore::load\(root\)/,
		)
		assert.match(
			fallbackFix,
			/safe_fs::atomic_write_from_reader_checked/,
		)
		assert.match(
			fallbackFix,
			/let expected_source = fs::read\(&file_path\)/,
		)

		assert.match(
			desktop,
			/"run_project_validation_command"/,
		)
		assert.match(
			desktop,
			/"fix_project_eslint"/,
		)
		assert.match(
			types,
			/lintFixCommand: string \| null/,
		)
		assert.match(
			lib,
			/diagnostics::run_project_validation_command/,
		)
		assert.match(
			lib,
			/diagnostics::fix_project_eslint/,
		)

		const packageJson = JSON.parse(packageJsonSource) as {
			orqetoDev?: { validation?: { lintFix?: string } }
		}
		assert.equal(
			packageJson.orqetoDev?.validation?.lintFix,
			"npm run lint:fix",
		)
	},
)
