import { rootDirectory } from "./model.mts"
import {
	copyFile,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises"
import path from "node:path"

export async function prepareOutputDirectory(outputDirectory: string): Promise<string> {
	await rm(
		outputDirectory,
		{
			recursive: true,
			force: true,
		},
	)

	const filesDirectory = path.join(
		outputDirectory,
		"files",
	)

	await mkdir(
		filesDirectory,
		{
			recursive: true,
		},
	)

	return filesDirectory
}

export function getMarkdownLanguage(filePath: string): string {
	switch (path.extname(filePath)) {
		case ".ts":
		case ".mts":
		case ".cts":
			return "ts"
		case ".tsx":
			return "tsx"
		case ".js":
		case ".mjs":
		case ".cjs":
			return "js"
		case ".jsx":
			return "jsx"
		case ".json":
			return "json"
		default:
			return ""
	}
}

export function escapeInlineMarkdown(value: string): string {
	return value.replaceAll(
		"`",
		"\\`",
	)
}

export function isInsideRoot(filePath: string): boolean {
	const relativePath = path.relative(
		rootDirectory,
		filePath,
	)

	return relativePath !== "" &&
		!relativePath.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relativePath)
}

export async function appendSourceFiles(
	report: string[],
	filesDirectory: string,
	filePaths: readonly string[],
): Promise<void> {
	report.push(
		"## Files",
		"",
	)

	for (const filePath of [...new Set(filePaths)]) {
		if (!isInsideRoot(filePath))
			continue

		const relativeFilePath = path.relative(
			rootDirectory,
			filePath,
		)
		const source = await readFile(
			filePath,
			"utf8",
		)
		const copiedFilePath = path.join(
			filesDirectory,
			relativeFilePath,
		)

		await mkdir(
			path.dirname(copiedFilePath),
			{ recursive: true },
		)
		await copyFile(
			filePath,
			copiedFilePath,
		)

		report.push(
			`### ${relativeFilePath}`,
			"",
			"````" + getMarkdownLanguage(filePath),
			source,
			"````",
			"",
		)
	}
}

export async function writeReport(
	reportPath: string,
	report: readonly string[],
): Promise<void> {
	await writeFile(
		reportPath,
		`${report.join("\n")}\n`,
		"utf8",
	)
}
