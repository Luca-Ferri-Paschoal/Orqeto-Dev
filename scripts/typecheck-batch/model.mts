import type { DiagnosticScope } from "../diagnostic-batch-utils.mts"
import { rootDirectory } from "../diagnostic-batch-utils.mts"
import path from "node:path"

export interface WorkspaceDefinition {
	key: Exclude<DiagnosticScope, "all">
	label: string
	directory: string
	commandArgs: readonly string[]
}

export interface TypeScriptDiagnostic {
	workspace: WorkspaceDefinition["key"]
	filePath: string | null
	line: number | null
	column: number | null
	code: string
	message: string
}

export interface TypecheckExecution {
	workspace: WorkspaceDefinition
	exitCode: number
	output: string
	diagnostics: TypeScriptDiagnostic[]
}

export const WORKSPACES: Record<WorkspaceDefinition["key"], WorkspaceDefinition> = {
	app: {
		key: "app",
		label: "Orqeto Dev app",
		directory: rootDirectory,
		commandArgs: [
			"run",
			"typecheck:app",
			"--",
			"--pretty",
			"false",
		],
	},
	vscode: {
		key: "vscode",
		label: "VS Code companion",
		directory: path.join(
			rootDirectory,
			"integrations",
			"vscode",
		),
		commandArgs: [
			"run",
			"typecheck:vscode",
			"--",
			"--pretty",
			"false",
		],
	},
}
