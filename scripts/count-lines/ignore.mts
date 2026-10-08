import { PROJECT_ROOT } from "./model.mts"
import ignore, { type Ignore } from "ignore"
import { readFile } from "node:fs/promises"
import path from "node:path"

const IGNORE_FILE_NAMES = [
	".linecountignore",
	".gitignore",
] as const

export async function createIgnoreMatcher(): Promise<Ignore> {
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

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error &&
		"code" in error &&
		error.code === "ENOENT"
}
