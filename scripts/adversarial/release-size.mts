import type { Dirent } from "node:fs"
import {
	readdir,
	stat,
} from "node:fs/promises"
import path from "node:path"

async function collectFiles(directory: string): Promise<string[]> {
	let entries: Dirent[]
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
		const item = path.join(
			directory,
			entry.name,
		)
		if (entry.isDirectory())
			files.push(...await collectFiles(item))
		else if (entry.isFile())
			files.push(item)
	}
	return files
}

const releaseRoot = path.resolve(
	"src-tauri",
	"target",
	"release",
)
const files = await collectFiles(releaseRoot)
const interesting = files.filter(file => {
	const lower = file.toLowerCase()
	return lower.endsWith(".exe") || lower.endsWith(".msi") || lower.endsWith(".dmg") || lower.endsWith(".appimage")
})

if (interesting.length === 0)
	process.stdout.write("No release binary/installer artifacts were found. Run npm run build first.\n")
else {
	for (const file of interesting.sort()) {
		const metadata = await stat(file)
		process.stdout.write(`${path.relative(
			process.cwd(),
			file,
		)}\t${(metadata.size / 1024 / 1024).toFixed(2)} MiB\n`)
	}
}
