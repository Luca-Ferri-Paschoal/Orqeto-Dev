import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import { test } from "node:test"

void test(
	"Startup loading is global, runtime loading is tab-scoped, and Context cancellation stays local",
	async () => {
		const loadingOverlay = await readProjectFile("src/shared/components/LoadingOverlay/index.tsx")
		const bootCleanup = await readProjectFile("src/shared/components/BootLoadingOverlayCleanup/index.tsx")
		const main = await readProjectFile("src/main.tsx")
		const app = await readProjectFile("src/App/index.tsx")
		const pane = await readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx")
		const paneStyle = await readProjectFile("src/features/context/components/ProjectWorkspacePane/style.ts")
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")

		assert.match(
			loadingOverlay,
			/delayMs = 200/,
		)
		assert.match(
			loadingOverlay,
			/minimumVisibleMs = 300/,
		)
		assert.match(
			loadingOverlay,
			/scope === "viewport"\s*\?\s*"fixed"\s*:\s*"absolute"/,
		)
		assert.match(
			loadingOverlay,
			/onCancel\?: \(\) => void/,
		)
		assert.match(
			loadingOverlay,
			/"text-xs"/,
		)

		assert.doesNotMatch(
			main,
			/BootLoadingOverlayCleanup/,
		)
		assert.match(
			bootCleanup,
			/ready: boolean/,
		)
		assert.match(
			bootCleanup,
			/if \(!ready\)/,
		)
		assert.match(
			app,
			/<BootLoadingOverlayCleanup ready=\{appReady\} \/>/,
		)
		assert.match(
			app,
			/inert=\{!appReady\}/,
		)
		assert.doesNotMatch(
			app,
			/isGlobalOperationBusy/,
		)
		assert.doesNotMatch(
			app,
			/busyWorkspaceTabs/,
		)
		assert.match(
			app,
			/routingBusy=\{state\.routingApplyTabId === tab\.id\}/,
		)
		assert.match(
			app,
			/disabled=\{!appReady \|\| state\.ignoreDialogTabId !== null \|\| state\.isRoutingApply\}/,
		)

		assert.doesNotMatch(
			paneStyle,
			/root: cn\([\s\S]{0,80}"relative"/,
		)
		assert.match(
			app,
			/workspaceStage/,
		)
		assert.match(
			pane,
			/const isTabBusy = isInteractionBusy \|\| routingBusy/,
		)
		assert.match(
			pane,
			/scope="container"/,
		)
		assert.match(
			pane,
			/inert=\{interaction\.isTabBusy\}/,
		)
		assert.match(
			pane,
			/workspace\.cancellableContextOperationKind !== null/,
		)
		assert.match(
			pane,
			/workspace\.cancelCancellableContextOperation/,
		)

		assert.match(
			workspace,
			/setCancelledContextOperationKind\(token\.kind\)/,
		)
		assert.match(
			workspace,
			/cancellableContextOperationRef\.current = null/,
		)
		assert.match(
			workspace,
			/if \(finishCancellableContextOperation\(cancellationToken\)\)/,
		)

		const cancellableKindType = workspace.slice(
			workspace.indexOf("type CancellableContextOperationKind"),
			workspace.indexOf("interface CancellableContextOperationToken"),
		)

		for (const kind of [
			"create",
			"custom",
			"commit",
			"project",
			"typecheck",
			"eslint",
		]) {
			assert.match(
				cancellableKindType,
				new RegExp(`"${kind}"`),
			)
		}

		assert.match(
			workspace,
			/beginCancellableContextOperation\(kind\)/,
		)

		assert.doesNotMatch(
			workspace,
			/beginCancellableContextOperation\("apply"\)/,
		)
		assert.doesNotMatch(
			workspace,
			/beginCancellableContextOperation\("undo"\)/,
		)
	},
)

void test(
	"Project tabs reject duplicate canonical roots and TypeScript mode is labeled Type Check",
	async () => {
		const app = await readProjectFile("src/App/index.tsx")
		const configDatabase = await readProjectFile("src-tauri/src/config_database.rs")
		const pt = await readProjectFile("src/infra/i18n/locales/pt-BR.ts")
		const en = await readProjectFile("src/infra/i18n/locales/en.ts")

		assert.match(
			app,
			/findProjectForRoot\(\s*otherRoots,\s*rootFolder,?\s*\)/s,
		)
		assert.match(
			app,
			/const uniqueRootTabs:/,
		)
		assert.match(
			app,
			/duplicateActiveTabRedirect/,
		)
		assert.match(
			configDatabase,
			/async fn ensure_unique_project_root/,
		)
		assert.match(
			configDatabase,
			/fs::canonicalize\(root_folder\)/,
		)
		assert.match(
			configDatabase,
			/SELECT root_folder FROM project_tabs WHERE id <> \?1 AND root_folder IS NOT NULL/,
		)
		assert.match(
			configDatabase,
			/ensure_unique_project_root\(/,
		)
		assert.match(
			pt,
			/"folder\.contextMode\.typecheck": "Type Check"/,
		)
		assert.match(
			en,
			/"folder\.contextMode\.typecheck": "Type Check"/,
		)
	},
)
