import {
	appendSourceFiles,
	type DiagnosticScope,
	escapeInlineMarkdown,
	parseCommonBatchOptions,
	prepareOutputDirectory,
	rootDirectory,
	transferReportIfRequested,
	writeReport,
} from "./diagnostic-batch-utils.mts"
import {
	ESLint,
	type Linter,
} from "eslint"
import path from "node:path"

const outputDirectory = path.join(
	rootDirectory,
	".lint-batch",
	"current",
)
const reportPath = path.join(
	outputDirectory,
	"report.md",
)
const eslintConfigPath = path.join(
	rootDirectory,
	"eslint.config.mts",
)
const options = parseCommonBatchOptions(process.argv.slice(2))
const filesDirectory = await prepareOutputDirectory(outputDirectory)
const eslint = new ESLint({
	cwd: rootDirectory,
	overrideConfigFile: eslintConfigPath,
})
const results = await eslint.lintFiles(getLintTargets(options.scope))
const errorResults = getResultsBySeverity(
	results,
	2,
)
const severity: Linter.Severity = errorResults.length > 0 ?
	2 :
	1
const selectedResults = (
	severity === 2 ?
		errorResults :
		getResultsBySeverity(
			results,
			1,
		)
).slice(
	0,
	options.fileLimit,
)

if (selectedResults.length === 0) {
	const report = [
		"# ESLint batch",
		"",
		`Scope: ${options.scope}`,
		"",
		"No lint errors or warnings found.",
		"",
	]

	await writeReport(
		reportPath,
		report,
	)
	await transferReportIfRequested(
		reportPath,
		options.transfer,
	)

	console.log("No ESLint errors or warnings found.")
	console.log(path.relative(
		rootDirectory,
		reportPath,
	))
	process.exit(0)
}

const label = severity === 2 ?
	"Errors" :
	"Warnings"
const selectedMessagesByFile = new Map<string, Linter.LintMessage[]>()

for (const result of selectedResults) {
	selectedMessagesByFile.set(
		result.filePath,
		getMessagesBySeverity(
			result,
			severity,
		),
	)
}

const messageCount = [...selectedMessagesByFile.values()]
	.reduce(
		(
			total,
			messages,
		) => total + messages.length,
		0,
	)
const report: string[] = [
	"# ESLint batch",
	"",
	`Scope: ${options.scope}`,
	`${label}: ${messageCount}`,
	`Files: ${selectedMessagesByFile.size}`,
	"",
	`## ${label}`,
	"",
]

for (const [filePath, messages] of selectedMessagesByFile) {
	const relativeFilePath = path.relative(
		rootDirectory,
		filePath,
	)

	report.push(
		`### ${relativeFilePath}`,
		"",
	)

	for (const message of messages)
		report.push(`- \`${getLocation(message)}\` \`${getRuleId(message)}\` — ${escapeInlineMarkdown(message.message)}`)

	report.push("")
}

await appendSourceFiles(
	report,
	filesDirectory,
	[...selectedMessagesByFile.keys()],
)
await writeReport(
	reportPath,
	report,
)
await transferReportIfRequested(
	reportPath,
	options.transfer,
)

console.log(`Created lint batch with ${messageCount} ${label.toLowerCase()} from ${selectedMessagesByFile.size} files.`)
console.log(path.relative(
	rootDirectory,
	reportPath,
))

function getLintTargets(scope: DiagnosticScope): string[] {
	switch (scope) {
		case "app":
			return [
				"src",
				"scripts",
				"eslint.config.mts",
				"eslint.format.config.mts",
				"vite.config.ts",
			]
		case "vscode":
			return [
				"integrations/vscode/src",
			]
		case "all":
			return [
				".",
			]
	}
}

function getLocation(message: Linter.LintMessage): string {
	const line = message.line ?? "?"
	const column = message.column ?? "?"

	return `${line}:${column}`
}

function getRuleId(message: Linter.LintMessage): string {
	return message.ruleId ?? "parsing-error"
}

function getMessagesBySeverity(
	result: ESLint.LintResult,
	severity: Linter.Severity,
): Linter.LintMessage[] {
	return result.messages.filter(message =>
		message.severity === severity)
}

function getResultsBySeverity(
	results: ESLint.LintResult[],
	severity: Linter.Severity,
): ESLint.LintResult[] {
	return results
		.filter(result =>
			getMessagesBySeverity(
				result,
				severity,
			).length > 0)
		.sort((
			left,
			right,
		) => left.filePath.localeCompare(right.filePath))
}
