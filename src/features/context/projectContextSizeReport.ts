// Uses metadata from the existing Scan. File contents are never read here.
export interface DirectorySizeEntry {
	path: string
	parentPath: string
	byteCount: number
	fileCount: number
}

export interface ContextSizeFile {
	relativePath: string
	sizeBytes: number
}

export const MAX_CONTEXT_CONTENT_BYTES = 128 * 1024 * 1024
// Diagnostic review is useful below the content hard limit too. Nothing is excluded automatically.
export const MIN_CONTEXT_DIAGNOSTIC_BYTES = 16 * 1024 * 1024
export const MAX_CONTEXT_DIAGNOSTIC_FILES = 30

export function normalizeScannedRelativePath(path: string): string | null {
	const normalized = path.replaceAll(
		"\\",
		"/",
	)
	const relative = normalized.startsWith("./") ?
		normalized.slice(2) :
		normalized
	return isSafeIgnoreSuggestion(relative) ?
		relative :
		null
}

export function largestScannedFiles(files: readonly ContextSizeFile[]): ContextSizeFile[] {
	return files.flatMap(file => {
		const relativePath = normalizeScannedRelativePath(file.relativePath)
		return relativePath === null ?
			[] :
			[{
				relativePath,
				sizeBytes: Number.isFinite(file.sizeBytes) && file.sizeBytes > 0 ?
					file.sizeBytes :
					0,
			}]
	}).sort((
		left,
		right,
	) => right.sizeBytes - left.sizeBytes || left.relativePath.localeCompare(right.relativePath))
		.slice(0, MAX_CONTEXT_DIAGNOSTIC_FILES)
}

export function buildDirectorySizeReport(files: readonly ContextSizeFile[]): DirectorySizeEntry[] {
	const directories = new Map<string, DirectorySizeEntry>()
	for (const file of files) {
		// The native scanner returns project-relative paths prefixed with "./".
		// Remove exactly this presentation prefix, not any traversal component.
		const relativePath = normalizeScannedRelativePath(file.relativePath)
		if (relativePath === null)
			continue
		const parts = relativePath.split("/")
		if (parts.some(part => !part || part === "." || part === ".."))
			continue
		const byteCount = Number.isFinite(file.sizeBytes) && file.sizeBytes > 0 ?
			file.sizeBytes :
			0
		for (let depth = 1; depth < parts.length; depth += 1) {
			const path = parts.slice(
				0,
				depth,
			).join("/")
			const entry = directories.get(path) ?? {
				path,
				parentPath: parts.slice(
					0,
					depth - 1,
				).join("/"),
				byteCount: 0,
				fileCount: 0,
			}
			entry.byteCount += byteCount
			entry.fileCount += 1
			directories.set(
				path,
				entry,
			)
		}
	}
	return [...directories.values()].sort((left, right) =>
		right.byteCount - left.byteCount || left.path.localeCompare(right.path))
}

/** Prefer the smallest existing branch that alone exceeds the content budget. */
export function largestOverBudgetFolders(entries: readonly DirectorySizeEntry[]): DirectorySizeEntry[] {
	const oversized = entries.filter(entry => entry.byteCount > MAX_CONTEXT_CONTENT_BYTES)
	const oversizedParents = new Set(oversized.map(entry => entry.parentPath))
	return oversized.filter(entry => !oversizedParents.has(entry.path))
}

export function childrenOfDirectory(
	entries: readonly DirectorySizeEntry[],
	parentPath: string,
): DirectorySizeEntry[] {
	return entries.filter(entry => entry.parentPath === parentPath)
}

export function isSafeIgnoreSuggestion(path: string): boolean {
	return path.length > 0 && path.split("/").every(part =>
		part.length > 0 && part !== "." && part !== ".." && !/[\\:\x00-\x1f\x7f]/.test(part))
}
