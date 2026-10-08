import { getMode } from "./format-typescript/config.mts"
import { getProjectFiles } from "./format-typescript/files.mts"
import {
	checkFormattedFiles,
	writeFormattedFiles,
} from "./format-typescript/run.mts"

const mode = getMode()
const files = await getProjectFiles()
if (mode === "check")
	await checkFormattedFiles(files)
else
	await writeFormattedFiles(files)
