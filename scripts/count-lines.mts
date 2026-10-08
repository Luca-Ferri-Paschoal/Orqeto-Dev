import { countDirectoryLines } from "./count-lines/count.mts"
import { createIgnoreMatcher } from "./count-lines/ignore.mts"
import { PROJECT_ROOT } from "./count-lines/model.mts"
import { printLineCountReport } from "./count-lines/report.mts"

async function main(): Promise<void> {
	const matcher = await createIgnoreMatcher()
	const result = await countDirectoryLines(
		PROJECT_ROOT,
		matcher,
	)

	printLineCountReport(result)
}

void main().catch((error: unknown) => {
	console.error(
		"[LineCount] Failed to count project lines.",
		error,
	)
	process.exitCode = 1
})
