import ignore, { type Ignore } from "ignore"
import {
	readdir,
	readFile,
} from "node:fs/promises"
import path from "node:path"

const PROJECT_ROOT = process.cwd()

const IGNORE_FILE_NAMES = [
	".linecountignore",
	".gitignore",
] as const

const LARGEST_FILES_LIMIT = 10

interface FileLineCount {
	path: string
	extension: string
	directory: string
	lines: number
}

interface GroupLineCount {
	files: number
	lines: number
}

interface LineCountResult {
	files: number
	lines: number
	skippedBinaryFiles: number
	fileDetails: FileLineCount[]
	byExtension: Map<string, GroupLineCount>
	byDirectory: Map<string, GroupLineCount>
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
	return (
		error instanceof Error &&
		"code" in error &&
		error.code === "ENOENT"
	)
}

async function createIgnoreMatcher(): Promise<Ignore> {
	const matcher = ignore()

	for (const ignoreFileName of IGNORE_FILE_NAMES) {
		const ignoreFilePath = path.join(
			PROJECT_ROOT,
			ignoreFileName,
		)

		try {
			const content = await readFile(
				ignoreFilePath,
				"utf8",
			)

			matcher.add(content)

			console.log(`[LineCount] Using ${ignoreFileName}.`)

			return matcher
		} catch (error) {
			if (!isFileNotFoundError(error))
				throw error
		}
	}

	console.warn("[LineCount] Neither .linecountignore nor .gitignore was found. No paths will be ignored.")

	return matcher
}

function normalizeRelativePath(absolutePath: string): string {
	return path
		.relative(
			PROJECT_ROOT,
			absolutePath,
		)
		.split(path.sep)
		.join("/")
}

function isBinary(buffer: Buffer): boolean {
	if (buffer.length === 0)
		return false

	const sampleLength = Math.min(
		buffer.length,
		8_000,
	)

	for (
		let index = 0;
		index < sampleLength;
		index += 1
	) {
		if (buffer[index] === 0)
			return true
	}

	return false
}

function countLines(content: string): number {
	if (content.length === 0)
		return 0

	let lines = 1

	for (
		let index = 0;
		index < content.length;
		index += 1
	) {
		if (content[index] === "\n")
			lines += 1
	}

	return lines
}

function getFileExtension(relativePath: string): string {
	const extension = path.extname(relativePath)

	return extension || "[no extension]"
}

function getDirectoryGroup(relativePath: string): string {
	const segments = relativePath.split("/")

	if (segments.length === 1)
		return "[root]"

	const rootDirectory = segments[0]

	if (!rootDirectory)
		return "[root]"

	if (rootDirectory === "integrations") {
		const childDirectory = segments[1]

		return childDirectory ?
			`${rootDirectory}/${childDirectory}` :
			rootDirectory
	}

	return rootDirectory
}

function addGroupCount(
	groups: Map<string, GroupLineCount>,
	key: string,
	lines: number,
): void {
	const current = groups.get(key)

	if (current) {
		current.files += 1
		current.lines += lines

		return
	}

	groups.set(
		key,
		{
			files: 1,
			lines,
		},
	)
}

async function countDirectoryLines(
	directoryPath: string,
	matcher: Ignore,
): Promise<LineCountResult> {
	const result: LineCountResult = {
		files: 0,
		lines: 0,
		skippedBinaryFiles: 0,
		fileDetails: [],
		byExtension: new Map(),
		byDirectory: new Map(),
	}

	const entries = await readdir(
		directoryPath,
		{
			withFileTypes: true,
		},
	)

	for (const entry of entries) {
		const absolutePath = path.join(
			directoryPath,
			entry.name,
		)

		const relativePath = normalizeRelativePath(absolutePath)

		const ignorePath = entry.isDirectory() ?
			`${relativePath}/` :
			relativePath

		if (matcher.ignores(ignorePath))
			continue

		if (entry.isDirectory()) {
			const childResult = await countDirectoryLines(
				absolutePath,
				matcher,
			)

			result.files += childResult.files
			result.lines += childResult.lines
			result.skippedBinaryFiles +=
				childResult.skippedBinaryFiles

			result.fileDetails.push(...childResult.fileDetails)

			for (
				const [
					extension,
					count,
				] of childResult.byExtension
			) {
				const current = result.byExtension.get(extension)

				if (current) {
					current.files += count.files
					current.lines += count.lines
				} else {
					result.byExtension.set(
						extension,
						{
							...count,
						},
					)
				}
			}

			for (
				const [
					directory,
					count,
				] of childResult.byDirectory
			) {
				const current = result.byDirectory.get(directory)

				if (current) {
					current.files += count.files
					current.lines += count.lines
				} else {
					result.byDirectory.set(
						directory,
						{
							...count,
						},
					)
				}
			}

			continue
		}

		if (!entry.isFile())
			continue

		const buffer = await readFile(absolutePath)

		if (isBinary(buffer)) {
			result.skippedBinaryFiles += 1
			continue
		}

		const lines = countLines(buffer.toString("utf8"))

		const extension = getFileExtension(relativePath)

		const directory = getDirectoryGroup(relativePath)

		result.files += 1
		result.lines += lines

		result.fileDetails.push({
			path: relativePath,
			extension,
			directory,
			lines,
		})

		addGroupCount(
			result.byExtension,
			extension,
			lines,
		)

		addGroupCount(
			result.byDirectory,
			directory,
			lines,
		)
	}

	return result
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

	for (
		const [
			name,
			count,
		] of entries
	) {
		console.log([
			name.padEnd(nameWidth),
			formatNumber(count.lines)
				.padStart(lineWidth),
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
			formatNumber(file.lines)
				.padStart(lineWidth),
			"lines",
		].join("  "))
	}
}

async function main(): Promise<void> {
	const matcher = await createIgnoreMatcher()

	const result = await countDirectoryLines(
		PROJECT_ROOT,
		matcher,
	)

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

void main().catch((error: unknown) => {
	console.error(
		"[LineCount] Failed to count project lines.",
		error,
	)

	process.exitCode = 1
})
