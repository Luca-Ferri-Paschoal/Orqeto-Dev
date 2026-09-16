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
	"VS Code Context actions are published only for projects in Create mode",
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
			/contextProjectRoots/,
		)
		assert.match(
			app,
			/workspaceContextModes\[tab\.id\] === "create"/,
		)
		assert.match(
			app,
			/workspace\.externalContextUnavailableOutsideCreate/,
		)
		assert.match(
			workspace,
			/contextModeRef\.current !== "create"/,
		)
		assert.match(
			desktop,
			/contextProjectRoots: string\[\]/,
		)
		assert.match(
			externalIntegration,
			/context_project_roots: Vec<String>/,
		)
		assert.match(
			extension,
			/CREATE_CONTEXT_MODE_CONTEXT_KEY = "orqetoDev\.createContextMode"/,
		)
		assert.match(
			extension,
			/projectIsInCreateContextMode/,
		)
		assert.match(
			extensionPackage,
			/orqetoDev\.createContextMode/,
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
