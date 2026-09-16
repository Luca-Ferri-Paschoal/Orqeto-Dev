import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
	"..",
)
const testFile = path.join(
	rootDirectory,
	"scripts",
	"business-rules",
	"adversarial-final.test.mts",
)
const result = spawnSync(
	process.execPath,
	[
		"--experimental-strip-types",
		"--test",
		testFile,
	],
	{
		cwd: rootDirectory,
		stdio: "inherit",
		windowsHide: true,
	},
)

if (result.error)
	throw result.error

process.exitCode = result.status ?? 1
