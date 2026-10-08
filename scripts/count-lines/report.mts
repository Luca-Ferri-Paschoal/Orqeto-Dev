import {
	type FileLineCount,
	type GroupLineCount,
	LARGEST_FILES_LIMIT,
	type LineCountResult,
} from "./model.mts"

export function printLineCountReport(result: LineCountResult): void {
	printSectionTitle("Project line count")
	console.log(`Files: ${formatNumber(result.files)}`)
	console.log(`Lines: ${formatNumber(result.lines)}`)
	console.log(`Skipped binary files: ${formatNumber(result.skippedBinaryFiles)}`)

	printSectionTitle("Lines by extension")
	printGroupedCounts(result.byExtension)

	printSectionTitle("Largest files")
	printLargestFiles(result.fileDetails)

	printSectionTitle("Lines by directory")
	printGroupedCounts(result.byDirectory)
	console.log("")
}

function formatNumber(value: number): string {
	return value.toLocaleString("en-US")
}

function printSectionTitle(title: string): void {
	console.log("")
	console.log(title)
	console.log("-".repeat(title.length))
}

function printGroupedCounts(groups: Map<string, GroupLineCount>): void {
	const entries = [...groups.entries()]
		.sort((
			[, left],
			[, right],
		) => right.lines - left.lines)

	if (entries.length === 0) {
		console.log("No files found.")
		return
	}

	const nameWidth = Math.max(...entries.map(([name]) => name.length))
	const lineWidth = Math.max(
		"Lines".length,
		...entries.map(([, count]) => formatNumber(count.lines).length),
	)

	for (const [name, count] of entries) {
		console.log([
			name.padEnd(nameWidth),
			formatNumber(count.lines).padStart(lineWidth),
			`lines in ${formatNumber(count.files)} files`,
		].join("  "))
	}
}

function printLargestFiles(files: FileLineCount[]): void {
	const largestFiles = [...files]
		.sort((
			left,
			right,
		) => right.lines - left.lines)
		.slice(
			0,
			LARGEST_FILES_LIMIT,
		)

	if (largestFiles.length === 0) {
		console.log("No files found.")
		return
	}

	const pathWidth = Math.max(...largestFiles.map(file => file.path.length))
	const lineWidth = Math.max(...largestFiles.map(file => formatNumber(file.lines).length))

	for (const file of largestFiles) {
		console.log([
			file.path.padEnd(pathWidth),
			formatNumber(file.lines).padStart(lineWidth),
			"lines",
		].join("  "))
	}
}
