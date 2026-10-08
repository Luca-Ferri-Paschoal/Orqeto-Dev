import {
	createEmptyLineCountResult,
	type GroupLineCount,
	type LineCountResult,
	PROJECT_ROOT,
} from "./model.mts"
import type { Ignore } from "ignore"
import {
	readdir,
	readFile,
} from "node:fs/promises"
import path from "node:path"

export async function countDirectoryLines(
	directoryPath: string,
	matcher: Ignore,
): Promise<LineCountResult> {
	const result = createEmptyLineCountResult()
	const entries = await readdir(
		directoryPath,
		{ withFileTypes: true },
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
			mergeResult(
				result,
				await countDirectoryLines(
					absolutePath,
					matcher,
				),
			)
			continue
		}

		if (!entry.isFile())
			continue

		await countFile(
			result,
			absolutePath,
			relativePath,
		)
	}

	return result
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

async function countFile(
	result: LineCountResult,
	absolutePath: string,
	relativePath: string,
): Promise<void> {
	const buffer = await readFile(absolutePath)

	if (isBinary(buffer)) {
		result.skippedBinaryFiles += 1
		return
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

function mergeResult(
	target: LineCountResult,
	source: LineCountResult,
): void {
	target.files += source.files
	target.lines += source.lines
	target.skippedBinaryFiles += source.skippedBinaryFiles
	target.fileDetails.push(...source.fileDetails)
	mergeGroups(
		target.byExtension,
		source.byExtension,
	)
	mergeGroups(
		target.byDirectory,
		source.byDirectory,
	)
}

function mergeGroups(
	target: Map<string, GroupLineCount>,
	source: Map<string, GroupLineCount>,
): void {
	for (const [key, count] of source) {
		const current = target.get(key)

		if (current) {
			current.files += count.files
			current.lines += count.lines
		} else {
			target.set(
				key,
				{ ...count },
			)
		}
	}
}

function isBinary(buffer: Buffer): boolean {
	if (buffer.length === 0)
		return false

	const sampleLength = Math.min(
		buffer.length,
		8_000,
	)

	for (let index = 0; index < sampleLength; index += 1) {
		if (buffer[index] === 0)
			return true
	}

	return false
}

function countLines(content: string): number {
	if (content.length === 0)
		return 0

	let lines = 1

	for (let index = 0; index < content.length; index += 1) {
		if (content[index] === "\n")
			lines += 1
	}

	return lines
}

function getFileExtension(relativePath: string): string {
	return path.extname(relativePath) || "[no extension]"
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
