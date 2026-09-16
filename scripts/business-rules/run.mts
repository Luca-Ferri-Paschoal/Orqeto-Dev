import { spawnSync } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const testFiles = (await readdir(scriptDirectory))
	.filter(fileName => fileName.endsWith(".test.mts"))
	.sort()
	.map(fileName => path.join(
		scriptDirectory,
		fileName,
	))

if (testFiles.length === 0)
	throw new Error("No business-rule Node tests were found.")

const result = spawnSync(
	process.execPath,
	[
		"--experimental-strip-types",
		"--test",
		...testFiles,
	],
	{
		cwd: path.resolve(
			scriptDirectory,
			"..",
			"..",
		),
		stdio: "inherit",
		windowsHide: true,
	},
)

if (result.error)
	throw result.error

process.exitCode = result.status ?? 1
