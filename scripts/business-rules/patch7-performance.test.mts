import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
	"..",
)

async function readProjectFile(relativePath: string): Promise<string> {
	return readFile(
		path.join(
			rootDirectory,
			relativePath,
		),
		"utf8",
	)
}

void test(
	"BR-VSCODE-001 VS Code liveness avoids the permanent CIM scan and uses cheap adaptive refresh",
	async () => {
		const extension = await readProjectFile("integrations/vscode/src/extension.ts")

		assert.doesNotMatch(
			extension,
			/Get-CimInstance|Win32_Process|STATE_REFRESH_INTERVAL_MS = 2_000/,
		)
		assert.match(
			extension,
			/process\.kill\(/,
		)
		assert.match(
			extension,
			/ACTIVE_STATE_REFRESH_INTERVAL_MS = 5_000/,
		)
		assert.match(
			extension,
			/INACTIVE_STATE_REFRESH_INTERVAL_MS = 30_000/,
		)
		assert.match(
			extension,
			/setTimeout\(/,
		)
	},
)

void test(
	"BR-VSCODE-002 forwarded commands revalidate the published process and project state at execution time",
	async () => {
		const extension = await readProjectFile("integrations/vscode/src/extension.ts")
		const backend = await readProjectFile("src-tauri/src/external_integration.rs")

		assert.match(
			extension,
			/const state = await queryRegistryIntegrationState\(\)/,
		)
		assert.match(
			extension,
			/if \(!isPublishedProcessAlive\(state\)\)/,
		)
		assert.match(
			extension,
			/const projectRoot = findOpenProjectRoot/,
		)
		assert.match(
			backend,
			/process_id: u32/,
		)
		assert.match(
			backend,
			/version: 2/,
		)
	},
)

void test(
	"BR-PERF-001 inactive tabs do not refresh diagnostic capabilities on global focus",
	async () => {
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")

		assert.match(
			workspace,
			/if \(!active \|\| rootFolder === null\)/,
		)
		assert.match(
			workspace,
			/window\.addEventListener\(\s*"focus",\s*refreshCapabilities/,
		)
		assert.match(
			workspace,
			/\[\s*active,\s*operationRevision,\s*rootFolder,\s*\]/,
		)
	},
)

void test(
	"BR-PERF-002 filesystem-heavy cross-project routing is serialized until parallel I/O is justified",
	async () => {
		const app = await readProjectFile("src/App/index.tsx")

		assert.match(
			app,
			/async function mapFilesystemHeavySerially/,
		)
		assert.doesNotMatch(
			app,
			/Promise\.all\(rootedTabs\.map/,
		)
		assert.match(
			app,
			/mapFilesystemHeavySerially\(rootedTabs, async tab =>/,
		)
	},
)

void test(
	"BR-PERF-003 full-project Download stays in the backend instead of round-tripping the giant context string through React",
	async () => {
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")
		const desktop = await readProjectFile("src/infra/desktop.ts")
		const backend = await readProjectFile("src-tauri/src/lib.rs")

		assert.match(
			workspace,
			/saveFullProjectContextExportFile\(\{/,
		)
		assert.match(
			desktop,
			/"save_full_project_context_export_file"/,
		)
		assert.match(
			backend,
			/async fn save_full_project_context_export_file/,
		)
		assert.match(
			backend,
			/format_materialized_context\(/,
		)
		assert.match(
			workspace,
			/relativePaths: discovery\.files\.map\(file => file\.relativePath\)/,
		)
		assert.match(
			workspace,
			/pathsOnly,/,
		)
		assert.match(
			backend,
			/relative_paths: Vec<String>/,
		)
		assert.match(
			backend,
			/paths_only: bool/,
		)
	},
)

void test(
	"Project context is one card with Full or Custom scope and embedded filters/drop targets",
	async () => {
		const pane = await readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx")
		const dropZone = await readProjectFile("src/features/context/components/DropZone/index.tsx")
		const folderSettings = await readProjectFile("src/features/context/components/FolderSettings/index.tsx")
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")

		assert.match(
			folderSettings,
			/mode: "project"[\s\S]*?mode: "commit" as const[\s\S]*?mode: "validation" as const/,
		)
		assert.match(
			pane,
			/folder\.projectScope\.full/,
		)
		assert.match(
			pane,
			/folder\.projectScope\.custom/,
		)
		assert.match(
			pane,
			/embedded/,
		)
		assert.match(
			pane,
			/showDropTargets=\{contextMode === "create"\}/,
		)
		assert.match(
			pane,
			/showFilters=\{folderSectionExpanded\}/,
		)
		assert.match(
			dropZone,
			/if \(embedded\)/,
		)

		assert.match(
			workspace,
			/filterContextFiles\(\s*selection\.files,\s*filter,\s*\)/,
		)
		assert.match(
			workspace,
			/materializeContextFiles\(\s*discovery\.rootFolder,\s*discovery\.files\.map\(file => file\.relativePath\),\s*pathsOnly,\s*\)/,
		)
	},
)

void test(
	"Native Apply drag autoscroll targets the actual application scroll container",
	async () => {
		const pane = await readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx")

		assert.match(
			pane,
			/closest<HTMLElement>\(\s*"\.orqeto-scroll-area"/,
		)
		assert.match(
			pane,
			/scrollContainer\.scrollTop \+= scrollStep/,
		)
		assert.doesNotMatch(
			pane,
			/window\.scrollBy\(/,
		)
	},
)

void test(
	"Development preflight terminates the previous project Tauri tree instead of only the app process",
	async () => {
		const devStop = await readProjectFile("scripts/stop-running-dev.mts")

		assert.match(
			devStop,
			/Find-ProjectTauriAncestor/,
		)
		assert.match(
			devStop,
			/ORQETO_DEV_PROJECT_ROOT/,
		)
		assert.match(
			devStop,
			/& \$taskkill \/PID \$tauriProcessId \/T \/F/,
		)
	},
)

void test(
	"BR-PERF-004 release build avoids routine dependency installation and duplicate app TypeScript compilation",
	async () => {
		const packageJson = JSON.parse(await readProjectFile("package.json")) as {
			scripts?: Record<string, string>
		}
		const tauriConfig = JSON.parse(await readProjectFile("src-tauri/tauri.conf.json")) as {
			build?: { beforeBuildCommand?: string }
		}
		const scripts = packageJson.scripts ?? {}

		assert.equal(
			scripts["vscode:package"],
			"npm --prefix integrations/vscode run package",
		)
		assert.equal(
			scripts["validate:build"],
			"npm run typecheck:app && npm run format:check && npm run lint",
		)
		assert.equal(
			scripts["build:web:bundle"],
			"vite build",
		)
		assert.equal(
			tauriConfig.build?.beforeBuildCommand,
			"npm run build:web:bundle",
		)
	},
)

void test(
	"BR-UI-001 project UI state is global and shared by every open tab",
	async () => {
		const app = await readProjectFile("src/App/index.tsx")
		const settings = await readProjectFile("src/features/context/useAppSettings.ts")
		const frontendConfig = await readProjectFile("src/infra/configDatabase.ts")
		const configDatabase = await readProjectFile("src-tauri/src/config_database.rs")
		const settingValidation = configDatabase.slice(
			configDatabase.indexOf("fn validate_setting"),
			configDatabase.indexOf("async fn trim_filter_history"),
		)

		assert.match(
			app,
			/folderSectionExpanded=\{appSettings\.folderSectionExpanded\}/,
		)
		assert.match(
			app,
			/contextSectionExpanded=\{appSettings\.contextSectionExpanded\}/,
		)
		assert.match(
			app,
			/applySectionExpanded=\{appSettings\.applySectionExpanded\}/,
		)
		assert.match(
			app,
			/folderAction=\{appSettings\.folderAction\}/,
		)
		assert.match(
			app,
			/onFolderActionChange=\{action => void appSettings\.updateFolderAction\(action\)\}/,
		)
		assert.doesNotMatch(
			app,
			/setProjectTabSectionExpanded/,
		)
		assert.match(
			settings,
			/updateFolderSectionExpanded/,
		)
		assert.match(
			settings,
			/updateContextSectionExpanded/,
		)
		assert.match(
			settings,
			/updateApplySectionExpanded/,
		)
		assert.match(
			settings,
			/updateFolderAction/,
		)
		assert.match(
			frontendConfig,
			/folderAction: "folder_action"/,
		)
		assert.match(
			frontendConfig,
			/setFolderActionSetting/,
		)
		for (const settingKey of [
			"folder_action",
			"folder_section_expanded",
			"context_section_expanded",
			"apply_section_expanded",
		]) {
			assert.match(
				settingValidation,
				new RegExp(`"${settingKey}"`),
			)
		}
	},
)

void test(
	"Navigation and Settings collapse state survives application restart",
	async () => {
		const app = await readProjectFile("src/App/index.tsx")
		const settings = await readProjectFile("src/features/context/useAppSettings.ts")
		const drawer = await readProjectFile("src/features/context/components/SettingsDrawer/index.tsx")
		const configDatabase = await readProjectFile("src-tauri/src/config_database.rs")
		const settingValidation = configDatabase.slice(
			configDatabase.indexOf("fn validate_setting"),
			configDatabase.indexOf("async fn trim_filter_history"),
		)
		const settingsLoadQuery = configDatabase.slice(
			configDatabase.indexOf("pub async fn config_get_settings"),
			configDatabase.indexOf("pub async fn config_get_project_tabs"),
		)

		assert.match(
			app,
			/getActiveProjectTabId\(\)/,
		)
		assert.match(
			app,
			/const desiredActiveTabId = duplicateActiveTabRedirect \?\? storedActiveTabId/,
		)
		assert.match(
			app,
			/nextTabs\.find\(tab => tab\.id === desiredActiveTabId\)/,
		)
		assert.match(
			app,
			/setActiveProjectTabId\(nextActiveTab\.id\)/,
		)

		for (const settingName of [
			"settingsGeneralExpanded",
			"settingsContextExpanded",
			"settingsHistoryExpanded",
			"settingsVscodeExpanded",
			"settingsExplorerExpanded",
		]) {
			assert.match(
				settings,
				new RegExp(settingName),
			)
			assert.match(
				drawer,
				new RegExp(settingName),
			)
		}

		for (const settingKey of [
			"folder_action",
			"folder_section_expanded",
			"context_section_expanded",
			"apply_section_expanded",
			"settings_general_expanded",
			"settings_context_expanded",
			"settings_history_expanded",
			"settings_vscode_expanded",
			"settings_explorer_expanded",
		]) {
			assert.match(
				settingValidation,
				new RegExp(`"${settingKey}"`),
			)
			assert.match(
				settingsLoadQuery,
				new RegExp(`'${settingKey}'`),
			)
		}

		assert.doesNotMatch(
			drawer,
			/INITIAL_OPEN_SECTIONS/,
		)
	},
)

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
			/routingBusy=\{routingApplyTabId === tab\.id\}/,
		)
		assert.match(
			app,
			/disabled=\{!appReady \|\| ignoreDialogTabId !== null \|\| pendingProjectApplySelection !== null\}/,
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
			/inert=\{isTabBusy\}/,
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

		for (const kind of [
			"create",
			"custom",
			"commit",
			"project",
			"typecheck",
			"eslint",
		]) {
			assert.match(
				workspace,
				new RegExp(`\\| "${kind}"|beginCancellableContextOperation\\("${kind}"\\)`),
			)
		}

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
