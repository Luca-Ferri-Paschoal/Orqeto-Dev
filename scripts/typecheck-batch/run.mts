import { runNpmCommand } from "../diagnostic-batch-utils.mts"
import type {
	TypecheckExecution,
	WorkspaceDefinition,
} from "./model.mts"
import { parseDiagnostics } from "./parser.mts"

export async function runTypecheck(workspace: WorkspaceDefinition): Promise<TypecheckExecution> {
	const result = await runNpmCommand(workspace.commandArgs)

	return {
		workspace,
		exitCode: result.exitCode,
		output: result.output,
		diagnostics: await parseDiagnostics(
			workspace,
			result.output,
		),
	}
}
