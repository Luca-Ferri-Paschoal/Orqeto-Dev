import {
	hasValidationExecutionTrust,
	recordValidationExecutionTrust,
} from "../../src/features/context/workspace/validationTrust.ts"
import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

void test("Each tool and custom command kind has its own session confirmation", () => {
	const roots = new Set<string>()
	const commands = new Set<string>()
	const root = "C:/workspace"
	assert.equal(
		hasValidationExecutionTrust(
			root,
			null,
			roots,
			commands,
			"typecheck",
		),
		false,
	)
	recordValidationExecutionTrust(
		root,
		null,
		roots,
		commands,
		"typecheck",
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			null,
			roots,
			commands,
			"typecheck",
		),
		true,
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			null,
			roots,
			commands,
			"eslint",
		),
		false,
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			null,
			roots,
			commands,
			"lintfix",
		),
		false,
	)
	recordValidationExecutionTrust(
		root,
		null,
		roots,
		commands,
		"eslint",
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			null,
			roots,
			commands,
			"eslint",
		),
		true,
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			null,
			roots,
			commands,
			"lintfix",
		),
		false,
	)
	const testCommand = { kind: "test" as const, command: "npm run verify" }
	const fixCommand = { kind: "lintfix" as const, command: "npm run verify" }
	recordValidationExecutionTrust(
		root,
		testCommand,
		roots,
		commands,
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			testCommand,
			roots,
			commands,
		),
		true,
	)
	assert.equal(
		hasValidationExecutionTrust(
			root,
			fixCommand,
			roots,
			commands,
		),
		false,
	)
	assert.equal(
		hasValidationExecutionTrust(
			"C:/other",
			testCommand,
			roots,
			commands,
		),
		false,
	)
})

void test("Tool-specific messages do not mention unrelated tools", async () => {
	for (const locale of ["ptBR", "en"]) {
		const source = await readProjectFile(`src/infra/i18n/locales/${locale}/workspaceB.ts`)
		const messages = new Map<string, string>()
		for (const match of source.matchAll(/^\s*"([^"]+)": "([^"]*)",?$/gm)) {
			const key = match[1]
			const value = match[2]
			if (key !== undefined && value !== undefined) {
				messages.set(
					key,
					value,
				)
			}
		}
		const requiredMessage = (key: string): string => {
			const value = messages.get(key)
			assert.ok(
				value !== undefined,
				`Missing translation ${key} in ${locale}`,
			)
			return value
		}
		const typecheck = requiredMessage("workspace.diagnosticTrustTypecheckMessage")
		const eslint = requiredMessage("workspace.diagnosticTrustEslintMessage")
		const lintFix = requiredMessage("workspace.diagnosticTrustLintFixMessage")
		assert.match(
			typecheck,
			/TypeScript/,
		)
		assert.doesNotMatch(
			typecheck,
			/ESLint|Lint Fix/,
		)
		assert.match(
			eslint,
			/ESLint/,
		)
		assert.doesNotMatch(
			eslint,
			/TypeScript|Lint Fix/,
		)
		assert.match(
			lintFix,
			/ESLint/,
		)
		assert.doesNotMatch(
			lintFix,
			/TypeScript/,
		)
		for (const suffix of ["customTestTrustMessage", "customLintFixTrustMessage"]) {
			assert.match(
				requiredMessage(`workspace.${suffix}`),
				/\{command\}/,
			)
		}
	}
})

void test("Slow bootstrap tasks do not block the event thread or release unsafe writes", async () => {
	const bootstrap = await readProjectFile("src-tauri/src/lib/app_bootstrap.rs")
	const recovery = await readProjectFile("src-tauri/src/overlay/recovery_startup.rs")
	const undo = await readProjectFile("src-tauri/src/overlay/undo_state.rs")
	const external = await readProjectFile("src-tauri/src/external_integration/integration_state.rs")
	const shutdown = await readProjectFile("src-tauri/src/lib/export.rs")
	assert.match(
		bootstrap,
		/\.setup\(\|app\|[\s\S]*begin_startup_tasks\(\)[\s\S]*\.spawn\(move \|\| initialize_background_services\(handle\)\)/,
	)
	assert.match(
		bootstrap,
		/fn initialize_background_services[\s\S]*recover_stale_snapshots\(\)[\s\S]*load_persisted_histories\(\)[\s\S]*register_system_integrations\(\)[\s\S]*finish_startup_tasks\(\)/,
	)
	assert.match(
		recovery,
		/pub async fn overlay_recovery_status[\s\S]*spawn_blocking[\s\S]*wait_for_startup_tasks\(\)/,
	)
	assert.match(
		undo,
		/begin_project_mutation[\s\S]*startup_tasks_pending\(\)\?[\s\S]*mutation_protection_reason\(\)/,
	)
	assert.match(
		external,
		/pub async fn set_external_integration_state[\s\S]*wait_for_startup_tasks\(\)\?;[\s\S]*set_external_integration_state_blocking\(/,
	)
	assert.match(
		shutdown,
		/async fn destroy_main_window[\s\S]*spawn_blocking\(overlay::wait_for_startup_tasks\)/,
	)
})

void test("Blocked startup recovery can be explicitly discarded without changing project files", async () => {
	const [
		recovery,
		bootstrap,
		desktop,
		recoveryHook,
		recoveryNotice,
		stage,
		notice,
		ptBR,
		en,
	] = await Promise.all([
		readProjectFile("src-tauri/src/overlay/recovery_startup.rs"),
		readProjectFile("src-tauri/src/lib/app_bootstrap.rs"),
		readProjectFile("src/infra/desktop.ts"),
		readProjectFile("src/App/controllers/useAppRecovery.ts"),
		readProjectFile("src/App/components/AppRecoveryNotice.tsx"),
		readProjectFile("src/App/components/AppWorkspaceStage.tsx"),
		readProjectFile("src/shared/components/Notice/index.tsx"),
		readProjectFile("src/infra/i18n/locales/ptBR/core.ts"),
		readProjectFile("src/infra/i18n/locales/en/core.ts"),
	])

	assert.match(
		recovery,
		/pub async fn discard_overlay_recovery_state[\s\S]*wait_for_startup_tasks[\s\S]*mutation_protection_reason\(\)\.is_none\(\)[\s\S]*has_active_mutations/,
	)
	assert.match(
		recovery,
		/discard_recovery_directories[\s\S]*name\.starts_with\("undo-"\)[\s\S]*validate_managed_directory[\s\S]*remove_managed_directory/,
	)
	assert.match(
		recovery,
		/failures\.is_empty\(\)[\s\S]*histories[\s\S]*clear\(\)[\s\S]*mutation_protection\(\)[\s\S]*= None/,
	)
	assert.match(
		bootstrap,
		/overlay::discard_overlay_recovery_state/,
	)
	assert.match(
		desktop,
		/discardOverlayRecoveryState[\s\S]*discard_overlay_recovery_state/,
	)
	assert.match(
		recoveryHook,
		/getOverlayRecoveryStatus[\s\S]*setRecoveryBlocked[\s\S]*discardOverlayRecoveryState/,
	)
	assert.match(
		stage,
		/state\.recoveryBlocked[\s\S]*<AppRecoveryNotice/,
	)
	assert.match(
		recoveryNotice,
		/app\.recoveryDiscard[\s\S]*<Dialog[\s\S]*app\.recoveryDiscardMessage[\s\S]*variant="danger"/,
	)
	assert.match(
		notice,
		/actionLabel[\s\S]*onAction/,
	)
	for (const locale of [ptBR, en]) {
		assert.match(
			locale,
			/"app\.recoveryDiscard"/,
		)
		assert.match(
			locale,
			/"app\.recoveryDiscardMessage"/,
		)
		assert.match(
			locale,
			/"app\.recoveryDiscardSuccess"/,
		)
	}
})
