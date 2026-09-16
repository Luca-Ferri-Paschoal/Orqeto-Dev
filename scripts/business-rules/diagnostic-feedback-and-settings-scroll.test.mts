import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

void test(
	"diagnostic feedback separates clean results, findings, and execution failures",
	async () => {
		const [formatter, workspace, types, rust, ptBR, en] = await Promise.all([
			read("src/features/context/formatProjectDiagnosticContext.ts"),
			read("src/features/context/useContextWorkspace.ts"),
			read("src/features/context/types.ts"),
			read("src-tauri/src/diagnostics.rs"),
			read("src/infra/i18n/locales/pt-BR.ts"),
			read("src/infra/i18n/locales/en.ts"),
		])

		assert.match(
			formatter,
			/data\.issueCount === 0/,
		)
		assert.match(
			formatter,
			/workspace\.diagnosticContextClean/,
		)
		assert.match(
			formatter,
			/createProjectDiagnosticNotice/,
		)
		assert.match(
			formatter,
			/kind: "warning"/,
		)
		assert.match(
			workspace,
			/workspace\.diagnosticContextFailed/,
		)
		assert.match(
			workspace,
			/createProjectDiagnosticNotice/,
		)
		assert.match(
			types,
			/errorCount: number/,
		)
		assert.match(
			types,
			/warningCount: number/,
		)
		assert.match(
			rust,
			/error_count: usize/,
		)
		assert.match(
			rust,
			/warning_count: usize/,
		)
		assert.match(
			rust,
			/TypeScript could not generate the report for/,
		)
		assert.doesNotMatch(
			rust,
			/code: "TYPECHECK"/,
		)
		assert.match(
			ptBR,
			/"workspace\.diagnosticContextClean": "Nenhum erro\."/,
		)
		assert.match(
			en,
			/"workspace\.diagnosticContextClean": "No errors\."/,
		)
	},
)

void test(
	"settings drawer scrolls instead of shrinking its collapsible sections",
	async () => {
		const styles = await read("src/features/context/components/SettingsDrawer/style.ts")

		assert.match(
			styles,
			/"min-h-0"/,
		)
		assert.match(
			styles,
			/"flex-1"/,
		)
		assert.match(
			styles,
			/"overflow-y-auto"/,
		)
		assert.match(
			styles,
			/"\[&>section\]:shrink-0"/,
		)
	},
)

void test(
	"settings overlay scrollbar hides as soon as the drawer becomes inert",
	async () => {
		const [scrollbarManager, settings, ptBR] = await Promise.all([
			read("src/shared/components/OverlayScrollbarManager/index.tsx"),
			read("src/features/context/components/SettingsDrawer/index.tsx"),
			read("src/infra/i18n/locales/pt-BR.ts"),
		])

		assert.match(
			scrollbarManager,
			/closest\('\[hidden\], \[inert\], \[aria-hidden="true"\]'\)/,
		)
		assert.match(
			scrollbarManager,
			/attributeFilter: \[[\s\S]*?"aria-hidden"[\s\S]*?"hidden"[\s\S]*?"inert"/,
		)
		assert.match(
			scrollbarManager,
			/isOutsideViewport\(rect\)/,
		)
		assert.doesNotMatch(
			settings,
			/settings\.language\.description|settings\.workMode\.(?:files|git)Description|settings\.vscode\.description/,
		)
		assert.match(
			settings,
			/settings\.vscode\.extensionLabel/,
		)
		assert.match(
			ptBR,
			/"settings\.vscode\.install": "Instalar"/,
		)
		assert.match(
			ptBR,
			/"settings\.vscode\.hideOpenSubfolders": "Ocultar “Abrir no Orqeto Dev” nas subpastas"/,
		)
	},
)

// BR-UI-002
void test(
	"routing and destination decision dialogs immediately suppress loading overlays",
	async () => {
		const [app, pane, workspace] = await Promise.all([
			read("src/App/index.tsx"),
			read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			read("src/features/context/useContextWorkspace.ts"),
		])

		assert.match(
			app,
			/routingDecisionPending=\{pendingProjectApplySelection !== null\}/,
		)
		assert.match(
			pane,
			/routingDecisionPending: boolean/,
		)
		assert.match(
			pane,
			/const suppressLoadingOverlay = routingDecisionPending \|\|[\s\S]*?pendingOverlay !== null \|\|[\s\S]*?pendingGitPatch !== null/,
		)
		assert.match(
			pane,
			/!suppressLoadingOverlay && \([\s\S]*?<LoadingOverlay/,
		)
		assert.match(
			workspace,
			/setIsApplying\(true\)\s*setPendingGitPatch\(null\)/,
		)
		assert.match(
			workspace,
			/setIsApplying\(true\)\s*setPendingOverlay\(null\)/,
		)
	},
)
