import {
	appendSourceFiles,
	escapeInlineMarkdown,
	rootDirectory,
} from "../diagnostic-batch-utils.mts"
import type {
	TypecheckExecution,
	TypeScriptDiagnostic,
} from "./model.mts"
import {
	type FileDiagnostic,
	getSelectedFiles,
	splitDiagnostics,
} from "./selection.mts"
import path from "node:path"

interface BuildReportInput {
	scope: string
	fileLimit: number
	filesDirectory: string
	executions: TypecheckExecution[]
}

export async function buildTypecheckReport({
	scope,
	fileLimit,
	filesDirectory,
	executions,
}: BuildReportInput): Promise<{
	report: string[]
	diagnosticCount: number
	filesWithErrors: number
}> {
	const diagnostics = executions.flatMap(execution => execution.diagnostics)
	const {
		fileDiagnostics,
		globalDiagnostics,
	} = splitDiagnostics(diagnostics)
	const selectedFiles = getSelectedFiles(
		fileDiagnostics,
		fileLimit,
	)
	const selectedFileSet = new Set(selectedFiles)
	const selectedDiagnostics = fileDiagnostics.filter(diagnostic =>
		selectedFileSet.has(diagnostic.filePath))
	const filesWithErrors = new Set(fileDiagnostics.map(diagnostic => diagnostic.filePath)).size
	const report = createHeader(
		scope,
		diagnostics.length,
		filesWithErrors,
		selectedFiles.length,
	)

	if (diagnostics.length === 0) {
		appendCleanOrFailureReport(
			report,
			executions,
		)
	} else {
		await appendDiagnosticsReport(
			report,
			filesDirectory,
			selectedFiles,
			selectedDiagnostics,
			globalDiagnostics,
		)
	}

	return {
		report,
		diagnosticCount: diagnostics.length,
		filesWithErrors,
	}
}

function createHeader(
	scope: string,
	diagnosticCount: number,
	filesWithErrors: number,
	selectedFileCount: number,
): string[] {
	return [
		"# TypeScript typecheck batch",
		"",
		`Scope: ${scope}`,
		`Errors: ${diagnosticCount}`,
		`Files with errors: ${filesWithErrors}`,
		`Selected files: ${selectedFileCount}`,
		"",
	]
}

function appendCleanOrFailureReport(
	report: string[],
	executions: readonly TypecheckExecution[],
): void {
	const failedExecutions = executions.filter(execution => execution.exitCode !== 0)

	if (failedExecutions.length === 0) {
		report.push(
			"No TypeScript errors found.",
			"",
		)
		return
	}

	report.push(
		"## Typecheck command failures",
		"",
	)

	for (const execution of failedExecutions) {
		report.push(
			`### ${execution.workspace.label}`,
			"",
			"````text",
			execution.output.trim(),
			"````",
			"",
		)
	}
}

async function appendDiagnosticsReport(
	report: string[],
	filesDirectory: string,
	selectedFiles: readonly string[],
	selectedDiagnostics: readonly FileDiagnostic[],
	globalDiagnostics: readonly TypeScriptDiagnostic[],
): Promise<void> {
	report.push(
		"## Errors",
		"",
	)

	for (const filePath of selectedFiles) {
		appendFileDiagnostics(
			report,
			filePath,
			selectedDiagnostics,
		)
	}

	appendGlobalDiagnostics(
		report,
		globalDiagnostics,
	)
	await appendSourceFiles(
		report,
		filesDirectory,
		selectedFiles,
	)
}

function appendFileDiagnostics(
	report: string[],
	filePath: string,
	diagnostics: readonly FileDiagnostic[],
): void {
	const relativeFilePath = path.relative(
		rootDirectory,
		filePath,
	)
	const messages = diagnostics.filter(diagnostic => diagnostic.filePath === filePath)

	report.push(
		`### ${relativeFilePath}`,
		"",
	)

	for (const diagnostic of messages) {
		const location = diagnostic.line === null ?
			"?" :
			`${diagnostic.line}:${diagnostic.column ?? "?"}`

		report.push(`- \`${location}\` \`TS${diagnostic.code}\` \`${diagnostic.workspace}\` — ${escapeInlineMarkdown(diagnostic.message)}`)
	}

	report.push("")
}

function appendGlobalDiagnostics(
	report: string[],
	diagnostics: readonly TypeScriptDiagnostic[],
): void {
	if (diagnostics.length === 0)
		return

	report.push(
		"### Global diagnostics",
		"",
	)

	for (const diagnostic of diagnostics)
		report.push(`- \`TS${diagnostic.code}\` \`${diagnostic.workspace}\` — ${escapeInlineMarkdown(diagnostic.message)}`)

	report.push("")
}
