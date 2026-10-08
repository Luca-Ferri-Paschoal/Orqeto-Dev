import {
	parseCommonBatchOptions,
	prepareOutputDirectory,
	rootDirectory,
	transferReportIfRequested,
	writeReport,
} from "./diagnostic-batch-utils.mts"
import { buildTypecheckReport } from "./typecheck-batch/report.mts"
import { runTypecheck } from "./typecheck-batch/run.mts"
import { getSelectedWorkspaces } from "./typecheck-batch/workspaces.mts"
import path from "node:path"

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
const executions = await Promise.all(getSelectedWorkspaces(options.scope).map(runTypecheck))
const result = await buildTypecheckReport({
	scope: options.scope,
	fileLimit: options.fileLimit,
	filesDirectory,
	executions,
})

await writeReport(
	reportPath,
	result.report,
)
await transferReportIfRequested(
	reportPath,
	options.transfer,
)

console.log(`Created TypeScript batch with ${result.diagnosticCount} diagnostics from ${result.filesWithErrors} files.`)
console.log(path.relative(
	rootDirectory,
	reportPath,
))
