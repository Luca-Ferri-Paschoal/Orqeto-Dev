import { rootDirectory } from "../diagnostic-batch-utils.mts"
import type {
	TypeScriptDiagnostic,
	WorkspaceDefinition,
} from "./model.mts"
import { access } from "node:fs/promises"
import path from "node:path"

export async function parseDiagnostics(
	workspace: WorkspaceDefinition,
	output: string,
): Promise<TypeScriptDiagnostic[]> {
	const diagnostics: TypeScriptDiagnostic[] = []
	let current: TypeScriptDiagnostic | null = null

	for (const rawLine of normalizeOutput(output)) {
		const line = rawLine.trimEnd()
		const fileDiagnostic = await parseFileDiagnostic(
			workspace,
			line,
		)

		if (fileDiagnostic) {
			current = fileDiagnostic
			diagnostics.push(current)
			continue
		}

		const globalDiagnostic = parseGlobalDiagnostic(
			workspace,
			line,
		)

		if (globalDiagnostic) {
			current = globalDiagnostic
			diagnostics.push(current)
			continue
		}

		if (isContinuationLine(
			current,
			line,
		))
			current.message += `\n${line}`
	}

	return diagnostics
}

function normalizeOutput(output: string): string[] {
	return output
		.replaceAll(
			"\r\n",
			"\n",
		)
		.split("\n")
}

async function parseFileDiagnostic(
	workspace: WorkspaceDefinition,
	line: string,
): Promise<TypeScriptDiagnostic | null> {
	const match = /^(.*)\((\d+),(\d+)\): (?:error|warning) TS(\d+): (.*)$/.exec(line)

	if (!match)
		return null

	const [, rawFilePath, rawLineNumber, rawColumnNumber, code, message] = match

	if (!rawFilePath || !rawLineNumber || !rawColumnNumber || !code || message === undefined)
		return null

	return {
		workspace: workspace.key,
		filePath: await resolveDiagnosticFilePath(
			workspace,
			rawFilePath,
		),
		line: Number(rawLineNumber),
		column: Number(rawColumnNumber),
		code,
		message,
	}
}

function parseGlobalDiagnostic(
	workspace: WorkspaceDefinition,
	line: string,
): TypeScriptDiagnostic | null {
	const match = /^(?:error|warning) TS(\d+): (.*)$/.exec(line)

	if (!match)
		return null

	const [, code, message] = match

	if (!code || message === undefined)
		return null

	return {
		workspace: workspace.key,
		filePath: null,
		line: null,
		column: null,
		code,
		message,
	}
}

function isContinuationLine(
	current: TypeScriptDiagnostic | null,
	line: string,
): current is TypeScriptDiagnostic {
	return current !== null &&
		line.trim() !== "" &&
		!line.startsWith("> ") &&
		!line.startsWith("npm ")
}

async function resolveDiagnosticFilePath(
	workspace: WorkspaceDefinition,
	rawFilePath: string,
): Promise<string | null> {
	const candidates = path.isAbsolute(rawFilePath) ?
		[rawFilePath] :
		[
			path.resolve(
				workspace.directory,
				rawFilePath,
			),
			path.resolve(
				rootDirectory,
				rawFilePath,
			),
		]

	for (const candidate of candidates) {
		try {
			await access(candidate)
			return candidate
		} catch {
			continue
		}
	}

	return null
}
