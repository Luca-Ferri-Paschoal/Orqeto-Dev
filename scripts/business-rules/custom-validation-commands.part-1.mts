import {
	createValidationCommandTrustKey,
	hasValidationExecutionTrust,
	recordValidationExecutionTrust,
} from "../../src/features/context/workspace/validationTrust.ts"
import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

// BR-DIAG-002
void test(
	"BR-DIAG-002 Test is explicit-only and package configuration cannot override Type Check or ESLint reports",
	async () => {
		const [
			pane,
			folderSettings,
			workspace,
			types,
			rust,
			packageJsonSource,
			workflowPrompt,
		] = await Promise.all([
			read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			read("src/features/context/components/FolderSettings/index.tsx"),
			read("src/features/context/useContextWorkspace.ts"),
			read("src/domain/contextContracts.ts"),
			read("src-tauri/src/diagnostics.rs"),
			read("package.json"),
			read("src/features/context/formatAiWorkflowPrompt.ts"),
		])

		assert.match(
			types,
			/export interface ProjectDiagnosticCapabilities \{[\s\S]*typecheck: boolean[\s\S]*eslint: boolean[\s\S]*lintFixCommand: string \| null[\s\S]*testCommand: string \| null/,
		)
		assert.match(
			rust,
			/\.get\("orqetoDev"\)[\s\S]*\.get\("validation"\)[\s\S]*\.get\("lintFix"\)[\s\S]*\.get\("test"\)/,
		)
		const parserStart = rust.indexOf("fn read_project_validation_commands(")
		const parserEnd = rust.indexOf(
			"fn get_project_validation_command(",
			parserStart,
		)
		const parser = rust.slice(
			parserStart,
			parserEnd,
		)
		assert.doesNotMatch(
			parser,
			/\.get\("typecheck"\)|\.get\("lint"\)/,
		)
		assert.match(
			rust,
			/br_diag_002_project_validation_commands_are_explicit_and_limited_to_fix_and_test/,
		)

		assert.match(
			pane,
			/const testAvailable = workspace\.diagnosticCapabilities\.testCommand !== null/,
		)
		assert.match(
			pane,
			/\{testAvailable && \([\s\S]*folder\.contextMode\.test[\s\S]*onClick=\{onTest\}/,
		)
		assert.match(
			pane,
			/isGeneratingDerivedContext[\s\S]*workspace\.validationCommandKind !== null/,
		)
		assert.match(
			folderSettings,
			/hasValidation: props\.hasTypecheckContext \|\| props\.hasLintFixAction \|\| props\.hasEslintContext \|\| props\.hasTestAction/,
		)
		assert.match(
			folderSettings,
			/\["typecheck", "lintfix", "eslint", "test"\]\.includes\(contextMode\)/,
		)
		assert.match(
			workspace,
			/window\.addEventListener\([\s\S]*"focus"[\s\S]*refreshCapabilities/,
		)
		assert.match(
			workspace,
			/const runProjectTests = useCallback\([\s\S]*capabilities\.testCommand[\s\S]*runProjectValidationCommand\([\s\S]*"test"/,
		)

		assert.match(
			workflowPrompt,
			/orqetoDev\.validation`:\s*`lintFix`[\s\S]*`test`/,
		)
		assert.match(
			workflowPrompt,
			/Somente quando eu pedir testes explicitamente[\s\S]*orqetoDev\.validation\.test[\s\S]*Não invente testes/,
		)
		assert.match(
			workflowPrompt,
			/Only when I explicitly request tests[\s\S]*orqetoDev\.validation\.test[\s\S]*Do not invent tests/,
		)
		assert.equal(
			workflowPrompt.match(/\.\.\.validationIntegrationRules\(locale\)/g)?.length,
			4,
			"Files and Git prompts in both locales must include the same validation integration rules",
		)

		const packageJson = JSON.parse(packageJsonSource) as {
			orqetoDev?: { validation?: { test?: string; lintFix?: string } }
			scripts?: Record<string, string>
		}
		assert.deepEqual(
			packageJson.orqetoDev?.validation,
			{
				lintFix: "npm run lint:fix",
				test: "npm test",
			},
		)
		assert.equal(
			packageJson.scripts?.test,
			"npm run test:business:contracts && npm run test:adversarial:node && npm run test:business:rust",
		)
	},
)

// BR-DIAG-003
void test(
	"BR-DIAG-003 custom validation commands require exact-command trust and preserve completed output as Context",
	async () => {
		const [
			workspace,
			desktop,
			formatter,
			types,
			rust,
			lib,
			renderedHistory,
			database,
		] = await Promise.all([
			read("src/features/context/useContextWorkspace.ts"),
			read("src/infra/desktop.ts"),
			read("src/features/context/formatValidationCommandContext.ts"),
			read("src/domain/contextContracts.ts"),
			read("src-tauri/src/diagnostics.rs"),
			read("src-tauri/src/lib.rs"),
			read("src/features/context/components/ContextHistoryPanel/index.tsx"),
			read("src-tauri/src/config_database.rs"),
		])

		assert.match(
			desktop,
			/export async function approveProjectValidationCommand\([\s\S]*"approve_project_validation_command"/,
		)
		assert.match(
			workspace,
			/workspace\.custom(?:Test|LintFix)TrustMessage[\s\S]*\{ command: customValidation\.command \}/,
		)
		assert.match(
			workspace,
			/approveProjectValidationCommand\([\s\S]*customValidation\.kind[\s\S]*customValidation\.command/,
		)
		assert.match(
			workspace,
			/recordValidationExecutionTrust\([\s\S]*configuredRootFolder[\s\S]*customValidation/,
		)

		const trustedRoots = new Set<string>()
		const trustedCommands = new Set<string>()
		const command = { kind: "test" as const, command: "npm test" }
		recordValidationExecutionTrust(
			"C:/repo",
			command,
			trustedRoots,
			trustedCommands,
		)
		assert.equal(
			hasValidationExecutionTrust(
				"C:/repo",
				command,
				trustedRoots,
				trustedCommands,
			),
			true,
		)
		assert.equal(
			hasValidationExecutionTrust(
				"C:/repo",
				{ kind: "test", command: "npm run changed-tests" },
				trustedRoots,
				trustedCommands,
			),
			false,
		)
		assert.equal(
			createValidationCommandTrustKey(
				"C:/repo",
				"npm test",
			),
			"C:/repo\nnpm test",
		)
		assert.match(
			rust,
			/pub fn approve_project_validation_command\([\s\S]*expected_command: String[\s\S]*current_command != expected_command[\s\S]*approve_custom_command/,
		)
		assert.match(
			rust,
			/pub async fn run_project_validation_command\([\s\S]*is_custom_command_approved\([\s\S]*command_text/,
		)
		assert.match(
			rust,
			/fn run_custom_validation_command_blocking\([\s\S]*run_bounded_custom_validation_command[\s\S]*success: output\.status\.success\(\)[\s\S]*stdout:[\s\S]*stderr:/,
		)
		assert.match(
			rust,
			/const MAX_CUSTOM_VALIDATION_RUNTIME: Duration = Duration::from_secs\(15 \* 60\)/,
		)
		assert.doesNotMatch(
			rust.slice(
				rust.indexOf("fn run_custom_validation_command_blocking("),
				rust.indexOf(
					"fn path_inside_root(",
					rust.indexOf("fn run_custom_validation_command_blocking("),
				),
			),
			/if\s+!output\.status\.success\(\)[\s\S]*Err/,
		)
		assert.match(
			lib,
			/diagnostics::approve_project_validation_command/,
		)

		assert.match(
			types,
			/export interface ProjectValidationCommandResult \{[\s\S]*exitCode: number \| null[\s\S]*success: boolean[\s\S]*durationMs: number[\s\S]*stdout: string[\s\S]*stderr: string/,
		)
		assert.match(
			formatter,
			/diagnostics\.command\.command[\s\S]*result\.command[\s\S]*diagnostics\.command\.exitCode[\s\S]*result\.exitCode[\s\S]*result\.stdout[\s\S]*result\.stderr/,
		)
		assert.match(
			workspace,
			/const publishValidationCommandContext = useCallback\([\s\S]*archiveContextSnapshot\([\s\S]*kind[\s\S]*autoCopyGeneratedReports[\s\S]*writeText\(content\)/,
		)
		assert.doesNotMatch(
			workspace,
			/autoCopyError:\s*unknown\s*\|\s*null/,
		)
		assert.match(
			workspace,
			/autoCopyErrorMessage: string \| null[\s\S]*getErrorMessage\([\s\S]*error,[\s\S]*locale/,
		)
		assert.match(
			workspace,
			/const copyValidationCommandContext = useCallback\(/,
		)
		assert.match(
			workspace,
			/const downloadValidationCommandContext = useCallback\(/,
		)
		assert.match(
			renderedHistory,
			/case "lintfix":[\s\S]*context\.history\.kind\.lintfix[\s\S]*case "test":[\s\S]*context\.history\.kind\.test/,
		)
		assert.match(
			database,
			/matches!\(kind, "custom" \| "project" \| "commit" \| "typecheck" \| "lintfix" \| "eslint" \| "test"\)/,
		)
	},
)

// BR-DIAG-005
