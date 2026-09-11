import {
	parseCommonBatchOptions,
	rootDirectory,
	transferReportIfRequested,
	writeReport,
} from "./diagnostic-batch-utils.mts"
import { spawn } from "node:child_process"
import {
	cp,
	mkdir,
	readFile,
	rm,
} from "node:fs/promises"
import path from "node:path"

const options = parseCommonBatchOptions(process.argv.slice(2))
const outputDirectory = path.join(
	rootDirectory,
	".lint-batch",
	"diagnostics",
	"current",
)
const reportPath = path.join(
	outputDirectory,
	"report.md",
)
const filesDirectory = path.join(
	outputDirectory,
	"files",
)

await rm(
	outputDirectory,
	{
		recursive: true,
		force: true,
	},
)
await mkdir(
	filesDirectory,
	{
		recursive: true,
	},
)

const commonArgs = [
	"--scope",
	options.scope,
	"--limit",
	String(options.fileLimit),
]

await runNodeScript(
	"typecheck-batch.mts",
	commonArgs,
)
await runNodeScript(
	"lint-batch.mts",
	commonArgs,
)

const typecheckDirectory = path.join(
	rootDirectory,
	".lint-batch",
	"typecheck",
	"current",
)
const lintDirectory = path.join(
	rootDirectory,
	".lint-batch",
	"current",
)
const typecheckReport = await readFile(
	path.join(
		typecheckDirectory,
		"report.md",
	),
	"utf8",
)
const lintReport = await readFile(
	path.join(
		lintDirectory,
		"report.md",
	),
	"utf8",
)

await copyDirectoryIfPresent(
	path.join(
		typecheckDirectory,
		"files",
	),
	path.join(
		filesDirectory,
		"typecheck",
	),
)
await copyDirectoryIfPresent(
	path.join(
		lintDirectory,
		"files",
	),
	path.join(
		filesDirectory,
		"eslint",
	),
)

const report = [
	"# ORQETO diagnostics batch",
	"",
	`Scope: ${options.scope}`,
	`File limit per checker: ${options.fileLimit}`,
	"",
	"## TypeScript",
	"",
	typecheckReport.trim(),
	"",
	"## ESLint",
	"",
	lintReport.trim(),
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

console.log("Created combined diagnostics report.")
console.log(path.relative(
	rootDirectory,
	reportPath,
))

function runNodeScript(
	fileName: string,
	args: readonly string[],
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				path.join(
					rootDirectory,
					"scripts",
					fileName,
				),
				...args,
			],
			{
				cwd: rootDirectory,
				stdio: "inherit",
			},
		)

		child.on(
			"error",
			reject,
		)
		child.on(
			"close",
			code => {
				if (code === 0) {
					resolve()
					return
				}

				reject(new Error(`${fileName} exited with code ${code ?? "unknown"}.`))
			},
		)
	})
}

async function copyDirectoryIfPresent(
	source: string,
	destination: string,
): Promise<void> {
	try {
		await cp(
			source,
			destination,
			{
				recursive: true,
				force: true,
			},
		)
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return

		throw error
	}
}
