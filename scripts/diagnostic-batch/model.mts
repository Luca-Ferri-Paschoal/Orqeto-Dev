import path from "node:path"
import { fileURLToPath } from "node:url"

export type DiagnosticScope = "all" | "app" | "vscode"

export interface CommonBatchOptions {
	fileLimit: number
	scope: DiagnosticScope
	transfer: boolean
}

export interface CommandExecutionResult {
	exitCode: number
	output: string
}

const scriptDirectory = path.dirname(fileURLToPath(new URL(
	"../diagnostic-batch-utils.mts",
	import.meta.url,
)))

export const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
)
