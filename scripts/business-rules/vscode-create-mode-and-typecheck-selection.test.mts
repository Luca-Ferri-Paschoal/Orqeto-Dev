import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

void test(
	"VS Code Context actions stay available for open projects, focus the owner tab, and follow the app locale",
	async () => {
		const [
			app,
			workspace,
			desktop,
			externalIntegration,
			extension,
			extensionPackage,
		] = await Promise.all([
			read("src/App/index.tsx"),
			read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			read("src/infra/desktop.ts"),
			read("src-tauri/src/external_integration.rs"),
			read("integrations/vscode/src/extension.ts"),
			read("integrations/vscode/package.json"),
		])

		assert.match(
			app,
			/await persistActiveTab\(matchingTab\.id\)/,
		)
		assert.doesNotMatch(
			app,
			/workspace\.externalContextUnavailableOutsideCreate/,
		)
		assert.match(
			workspace,
			/setRequestedContextMode\("create"\)/,
		)
		assert.doesNotMatch(
			workspace,
			/contextModeRef\.current !== "create"/,
		)
		assert.match(
			desktop,
			/locale: "pt-BR" \| "en"/,
		)
		assert.match(
			externalIntegration,
			/locale: String/,
		)
		assert.match(
			extension,
			/LOCALE_PT_BR_CONTEXT_KEY = "orqetoDev\.localePtBR"/,
		)
		assert.match(
			extension,
			/LOCALE_ENGLISH_CONTEXT_KEY = "orqetoDev\.localeEnglish"/,
		)
		assert.doesNotMatch(
			extension,
			/createContextMode|projectIsInCreateContextMode/,
		)
		assert.doesNotMatch(
			extensionPackage,
			/orqetoDev\.createContextMode/,
		)
		assert.match(
			extensionPackage,
			/resourcePath not in orqetoDev\.openProjectRootPaths/,
		)
		assert.match(
			extensionPackage,
			/Enviar para o Orqeto Dev/,
		)
		assert.match(
			extensionPackage,
			/Send to Orqeto Dev/,
		)
	},
)

void test(
	"BR-VSCODE-003 Context actions are mode-independent, switch to Project Custom, and hide only while the owning project is busy",
	async () => {
		const [
			app,
			workspace,
			desktop,
			externalIntegration,
			extension,
			extensionPackage,
		] = await Promise.all([
			read("src/App/index.tsx"),
			read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			read("src/infra/desktop.ts"),
			read("src-tauri/src/external_integration.rs"),
			read("integrations/vscode/src/extension.ts"),
			read("integrations/vscode/package.json"),
		])

		assert.match(
			app,
			/const contextProjectRoots = openProjectRoots/,
			"legacy integration availability must include every open project regardless of visible Context mode",
		)
		assert.match(
			app,
			/busyProjectRoots[\s\S]*workspaceBusyStates/,
		)
		assert.match(
			workspace,
			/setRequestedContextMode\("create"\)[\s\S]*addDroppedPaths/,
			"external Context actions must switch to Project > Custom before adding",
		)
		assert.match(
			workspace,
			/setRequestedContextMode\("create"\)[\s\S]*removeDroppedPaths/,
			"external remove must also switch to Project > Custom",
		)
		assert.match(
			desktop,
			/busyProjectRoots: string\[\]/,
		)
		assert.match(
			externalIntegration,
			/let context_project_roots = open_project_roots\.clone\(\)/,
			"backend publication must preserve mode-independent behavior for older extension builds",
		)
		assert.match(
			externalIntegration,
			/set_external_integration_state_blocking\([\s\S]*Vec::new\(\),[\s\S]*Vec::new\(\),[\s\S]*Vec::new\(\),[\s\S]*None,[\s\S]*true,[\s\S]*"pt-BR"\.to_string\(\)/,
			"system integration bootstrap must initialize open, legacy-context, and busy project root lists",
		)
		assert.match(
			externalIntegration,
			/fn sanitize_integration_state\([\s\S]*_context_project_roots: Vec<String>/,
			"the intentionally ignored legacy context-root input must not produce a Rust unused-variable warning",
		)
		assert.match(
			extension,
			/PROJECT_BUSY_CONTEXT_KEY = "orqetoDev\.projectBusy"/,
		)
		assert.match(
			extension,
			/state\.busyProjectRoots\.some/,
			"command execution must revalidate busy state even if the VS Code menu is stale",
		)
		assert.match(
			extensionPackage,
			/orqetoDev\.projectOpen && !orqetoDev\.projectBusy && !orqetoDev\.ignoreMode/,
		)
		assert.doesNotMatch(
			extensionPackage,
			/contextProjectRoots|createContextMode/,
			"VS Code menu visibility must not depend on Project Full/Custom, Commit, or Validation mode",
		)
	},
)

void test(
	"TypeScript diagnostics select package configs instead of every recursive tsconfig",
	async () => {
		const diagnostics = await read("src-tauri/src/diagnostics.rs")

		assert.match(
			diagnostics,
			/select_typecheck_configs/,
		)
		assert.match(
			diagnostics,
			/package_is_workspace_typecheck_aggregator/,
		)
		assert.match(
			diagnostics,
			/typecheck_script\.contains\("--workspaces"\)/,
		)
		assert.match(
			diagnostics,
			/is_solution_style_typecheck_config/,
		)
		assert.match(
			diagnostics,
			/!is_base_typecheck_config/,
		)
		assert.doesNotMatch(
			diagnostics,
			/Command::new\([^)]*(?:npm|pnpm|yarn)/,
			"diagnostics must keep invoking local tools directly instead of package scripts",
		)
	},
)
