export interface ContextSelectionFile {
	relativePath: string
}

export interface ContextSelectionCandidate {
	relativePath: string
	content?: unknown
}

export interface MergeContextSelectionResult {
	files: ContextSelectionFile[]
	addedFiles: number
	unchangedFiles: number
}

export function normalizeContextSelection(files: readonly ContextSelectionCandidate[]): ContextSelectionFile[] {
	return files.map(file => ({
		relativePath: file.relativePath,
	}))
}

export function mergeContextSelection(
	currentFiles: readonly ContextSelectionCandidate[],
	addedFiles: readonly ContextSelectionCandidate[],
): MergeContextSelectionResult {
	const files = normalizeContextSelection(currentFiles)
	const existingPaths = new Set(files.map(file => file.relativePath))
	let addedFilesCount = 0
	let unchangedFiles = 0

	for (const addedFile of addedFiles) {
		if (existingPaths.has(addedFile.relativePath)) {
			unchangedFiles += 1
			continue
		}

		existingPaths.add(addedFile.relativePath)
		files.push({
			relativePath: addedFile.relativePath,
		})
		addedFilesCount += 1
	}

	return {
		files,
		addedFiles: addedFilesCount,
		unchangedFiles,
	}
}
