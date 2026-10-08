import { rootDirectory } from "./config.mts"
import {
	assertStable,
	formatToStable,
} from "./stable.mts"
import {
	readFile,
	writeFile,
} from "node:fs/promises"
import path from "node:path"

export async function writeFormattedFiles(files: readonly string[]): Promise<void> {
	let changedCount = 0
	for (const fileName of files) {
		const source = await readFile(
			fileName,
			"utf8",
		)
		const formatted = await formatToStable(
			fileName,
			source,
		)
		await assertStable(
			fileName,
			formatted,
		)
		if (formatted === source)
			continue
		await writeFile(
			fileName,
			formatted,
			"utf8",
		)
		changedCount++
	}
	console.log(`Processed ${files.length} TypeScript files.`)
	console.log(`Changed ${changedCount} TypeScript files.`)
}

export async function checkFormattedFiles(files: readonly string[]): Promise<void> {
	const changedFiles: string[] = []
	for (const fileName of files) {
		const source = await readFile(
			fileName,
			"utf8",
		)
		const formatted = await formatToStable(
			fileName,
			source,
		)
		await assertStable(
			fileName,
			formatted,
		)
		if (formatted !== source) {
			changedFiles.push(path.relative(
				rootDirectory,
				fileName,
			))
		}
	}
	console.log(`Checked ${files.length} TypeScript files.`)
	if (changedFiles.length === 0) {
		console.log("Formatting is stable.")
		return
	}
	console.error("Formatting changes are required in:")
	for (const fileName of changedFiles)
		console.error(`- ${fileName}`)
	throw new Error("Formatting is not stable. Run npm run format:ts.")
}
