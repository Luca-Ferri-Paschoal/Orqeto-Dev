export const PROJECT_ROOT = process.cwd()
export const LARGEST_FILES_LIMIT = 10

export interface FileLineCount {
	path: string
	extension: string
	directory: string
	lines: number
}

export interface GroupLineCount {
	files: number
	lines: number
}

export interface LineCountResult {
	files: number
	lines: number
	skippedBinaryFiles: number
	fileDetails: FileLineCount[]
	byExtension: Map<string, GroupLineCount>
	byDirectory: Map<string, GroupLineCount>
}

export function createEmptyLineCountResult(): LineCountResult {
	return {
		files: 0,
		lines: 0,
		skippedBinaryFiles: 0,
		fileDetails: [],
		byExtension: new Map(),
		byDirectory: new Map(),
	}
}
