import {
	appendSourceFiles,
	type DiagnosticScope,
	escapeInlineMarkdown,
	parseCommonBatchOptions,
	prepareOutputDirectory,
	rootDirectory,
	runNpmCommand,
	transferReportIfRequested,
	writeReport,
} from "./diagnostic-batch-utils.mts"
import { access } from "node:fs/promises"
import path from "node:path"

interface WorkspaceDefinition {
	key: Exclude<DiagnosticScope, "all">
	label: string
	directory: string
	commandArgs: readonly string[]
}

interface TypeScriptDiagnostic {
	workspace: WorkspaceDefinition["key"]
	filePath: string | null
	line: number | null
	column: number | null
	code: string
	message: string
}

interface TypecheckExecution {
	workspace: WorkspaceDefinition
	exitCode: number
	output: string
	diagnostics: TypeScriptDiagnostic[]
}

const WORKSPACES: Record<WorkspaceDefinition["key"], WorkspaceDefinition> = {
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

const outputDirectory = path.join(
	rootDirectory,
	".lint-batch",
	"typecheck",
	"current",
)
const reportPath = path.join(
	outputDirectory,
	"report.md",
)

const options = parseCommonBatchOptions(process.argv.slice(2))
const filesDirectory = await prepareOutputDirectory(outputDirectory)
const selectedWorkspaces = getSelectedWorkspaces(options.scope)
const executions: TypecheckExecution[] = []

for (const workspace of selectedWorkspaces)
	executions.push(await runTypecheck(workspace))

const diagnostics = executions.flatMap(execution => execution.diagnostics)
const fileDiagnostics = diagnostics.filter((diagnostic): diagnostic is TypeScriptDiagnostic & {
	filePath: string
} => diagnostic.filePath !== null)
const globalDiagnostics = diagnostics.filter(diagnostic => diagnostic.filePath === null)
const selectedFiles = getSelectedFiles(
	fileDiagnostics,
	options.fileLimit,
)
const selectedFileSet = new Set(selectedFiles)
const selectedDiagnostics = fileDiagnostics.filter(diagnostic =>
	selectedFileSet.has(diagnostic.filePath))
const report: string[] = [
	"# TypeScript typecheck batch",
	"",
	`Scope: ${options.scope}`,
	`Errors: ${diagnostics.length}`,
	`Files with errors: ${new Set(fileDiagnostics.map(diagnostic => diagnostic.filePath)).size}`,
	`Selected files: ${selectedFiles.length}`,
	"",
]

if (diagnostics.length === 0) {
	const failedExecutions = executions.filter(execution => execution.exitCode !== 0)

	if (failedExecutions.length === 0) {
		report.push(
			"No TypeScript errors found.",
			"",
		)
	} else {
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
} else {
	report.push(
		"## Errors",
		"",
	)

	for (const filePath of selectedFiles) {
		const relativeFilePath = path.relative(
			rootDirectory,
			filePath,
		)
		const messages = selectedDiagnostics.filter(diagnostic => diagnostic.filePath === filePath)

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

	if (globalDiagnostics.length > 0) {
		report.push(
			"### Global diagnostics",
			"",
		)

		for (const diagnostic of globalDiagnostics)
			report.push(`- \`TS${diagnostic.code}\` \`${diagnostic.workspace}\` — ${escapeInlineMarkdown(diagnostic.message)}`)

		report.push("")
	}

	await appendSourceFiles(
		report,
		filesDirectory,
		selectedFiles,
	)
}

await writeReport(
	reportPath,
	report,
)
await transferReportIfRequested(
	reportPath,
	options.transfer,
)

console.log(`Created TypeScript batch with ${diagnostics.length} diagnostics from ${new Set(fileDiagnostics.map(diagnostic => diagnostic.filePath)).size} files.`)
console.log(path.relative(
	rootDirectory,
	reportPath,
))

function getSelectedWorkspaces(scope: DiagnosticScope): WorkspaceDefinition[] {
	switch (scope) {
		case "app":
			return [WORKSPACES.app]
		case "vscode":
			return [WORKSPACES.vscode]
		case "all":
			return [
				WORKSPACES.app,
				WORKSPACES.vscode,
			]
	}
}

async function runTypecheck(workspace: WorkspaceDefinition): Promise<TypecheckExecution> {
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

async function parseDiagnostics(
	workspace: WorkspaceDefinition,
	output: string,
): Promise<TypeScriptDiagnostic[]> {
	const diagnostics: TypeScriptDiagnostic[] = []
	let current: TypeScriptDiagnostic | null = null

	for (const rawLine of output
		.replaceAll(
			"\r\n",
			"\n",
		)
		.split("\n")) {
		const line = rawLine.trimEnd()
		const fileMatch = /^(.*)\((\d+),(\d+)\): (?:error|warning) TS(\d+): (.*)$/.exec(line)

		if (fileMatch) {
			const [, rawFilePath, rawLineNumber, rawColumnNumber, code, message] = fileMatch

			if (
				!rawFilePath ||
				!rawLineNumber ||
				!rawColumnNumber ||
				!code ||
				message === undefined
			)
				continue

			const filePath = await resolveDiagnosticFilePath(
				workspace,
				rawFilePath,
			)

			current = {
				workspace: workspace.key,
				filePath,
				line: Number(rawLineNumber),
				column: Number(rawColumnNumber),
				code,
				message,
			}
			diagnostics.push(current)
			continue
		}

		const globalMatch = /^(?:error|warning) TS(\d+): (.*)$/.exec(line)

		if (globalMatch) {
			const [, code, message] = globalMatch

			if (
				!code ||
				message === undefined
			)
				continue

			current = {
				workspace: workspace.key,
				filePath: null,
				line: null,
				column: null,
				code,
				message,
			}
			diagnostics.push(current)
			continue
		}

		if (
			current &&
			line.trim() !== "" &&
			!line.startsWith("> ") &&
			!line.startsWith("npm ")
		)
			current.message += `\n${line}`
	}

	return diagnostics
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

function getSelectedFiles(
	diagnostics: readonly (TypeScriptDiagnostic & {
		filePath: string
	})[],
	fileLimit: number,
): string[] {
	const files: string[] = []
	const seen = new Set<string>()

	for (const diagnostic of diagnostics) {
		if (seen.has(diagnostic.filePath))
			continue

		seen.add(diagnostic.filePath)
		files.push(diagnostic.filePath)

		if (files.length >= fileLimit)
			break
	}

	return files
}
