import {
	EXTENSIONS,
	IGNORED_DIRECTORIES,
	ROOT_FILES,
	rootDirectory,
	ROOTS,
} from "./config.mts"
import {
	readdir,
	stat,
} from "node:fs/promises"
import path from "node:path"

async function collectFiles(directory: string): Promise<string[]> {
	let entries
	try {
		entries = await readdir(
			directory,
			{ withFileTypes: true },
		)
	} catch {
		return []
	}
	const files: string[] = []
	for (const entry of entries) {
		const entryPath = path.join(
			directory,
			entry.name,
		)
		if (entry.isDirectory()) {
			if (!IGNORED_DIRECTORIES.has(entry.name))
				files.push(...await collectFiles(entryPath))
			continue
		}
		if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name)))
			files.push(entryPath)
	}
	return files
}

async function fileExists(fileName: string): Promise<boolean> {
	try {
		return (await stat(fileName)).isFile()
	} catch {
		return false
	}
}

export async function getProjectFiles(): Promise<string[]> {
	const files = (await Promise.all(ROOTS.map(root => collectFiles(path.join(
		rootDirectory,
		root,
	))))).flat()
	for (const rootFile of ROOT_FILES) {
		const fileName = path.join(
			rootDirectory,
			rootFile,
		)
		if (await fileExists(fileName))
			files.push(fileName)
	}
	return [...new Set(files)].sort((
		left,
		right,
	) => left.localeCompare(right))
}
