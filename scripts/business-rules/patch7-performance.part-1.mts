import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import { test } from "node:test"

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
			/\[\s*active,\s*operationRevision,\s*rootFolder,\s*setDiagnosticCapabilitiesState,\s*\]/,
		)
	},
)

void test(
	"BR-PERF-002 Apply never scans other open project tabs",
	async () => {
		const [routing, files, git] = await Promise.all([
			readProjectFile("src/App/controllers/useApplyRouting.ts"),
			readProjectFile("src/App/controllers/routeFilesApply.ts"),
			readProjectFile("src/App/controllers/routeGitApply.ts"),
		])
		assert.doesNotMatch(
			routing + files + git,
			/mapFilesystemHeavySerially|rootedTabs|Promise\.all\(tabs/,
		)
		assert.match(
			files,
			/prepareProjectOverlay\(\s*sourceTab\.rootFolder,\s*\[path\],?\s*\)/,
		)
		assert.match(
			git,
			/prepareGitPatch\(\s*sourceTab\.rootFolder,\s*patchPath,?\s*\)/,
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
			/relativePaths: discovery\.relativePaths/,
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
			/showFilters=\{(?:props\.)?folderSectionExpanded\}/,
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
			/materializeContextFiles\(\s*discovery\.rootFolder,\s*discovery\.relativePaths,\s*pathsOnly,\s*\)/,
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
