import type { Locale } from "@/infra/i18n"
import {
	translate,
	translateCount,
} from "@/infra/i18n"

export function getPathLabel(path: string): string {
	const normalized = path.replaceAll(
		"\\",
		"/",
	).replace(
		/\/$/,
		"",
	)
	const segments = normalized.split("/").filter(segment => segment.length > 0)
	return segments.length === 0 ?
		path :
		segments.slice(-3).join("/")
}

export function getSafeProjectName(path: string): string {
	return getPathLabel(path)
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\.+$/, "") || "project"
}

export function formatApplyStatusDetail(
	locale: Locale,
	labelKey: Parameters<typeof translate>[1],
	files: number,
	directories: number,
): string {
	return `${translate(
		locale,
		labelKey,
	)}: ${translateCount(
		locale,
		files,
		"status.files.one",
		"status.files.other",
	)} · ${translateCount(
		locale,
		directories,
		"status.affectedDirectories.one",
		"status.affectedDirectories.other",
	)}`
}

export function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
	return directoryPath === "./" ?
		filePath.startsWith("./") :
		filePath.startsWith(`${directoryPath}/`)
}

export function selectionContainsPath(
	selection: ReadonlySet<string>,
	path: string,
	isDirectory: boolean,
): boolean {
	if (!isDirectory)
		return selection.has(path)
	for (const filePath of selection) {
		if (isPathInsideDirectory(
			filePath,
			path,
		))
			return true
	}
	return false
}

export function countAffectedDirectories(
	filePaths: Iterable<string>,
	directoryScopes: readonly string[],
): number {
	const directories = new Set<string>()
	for (const filePath of filePaths) {
		const normalized = filePath.startsWith("./") ?
			filePath.slice(2) :
			filePath
		const segments = normalized.split("/")
		segments.pop()
		for (let index = 1; index <= segments.length; index += 1) {
			const directory = `./${segments.slice(
				0,
				index,
			).join("/")}`
			if (directoryScopes.some(scope =>
				scope === "./" || directory === scope || isPathInsideDirectory(
					directory,
					scope,
				)))
				directories.add(directory)
		}
	}
	return directories.size
}

export function countInputDirectoriesByContribution(
	resolvedPaths: readonly { relativePath: string; isDirectory: boolean }[],
	eligiblePaths: ReadonlySet<string>,
	existingPaths: ReadonlySet<string>,
): { added: number; unchanged: number; skipped: number } {
	let added = 0
	let unchanged = 0
	let skipped = 0
	for (const path of resolvedPaths) {
		if (!path.isDirectory)
			continue
		let hasEligible = false
		let hasNew = false
		for (const filePath of eligiblePaths) {
			if (!isPathInsideDirectory(
				filePath,
				path.relativePath,
			))
				continue
			hasEligible = true
			if (!existingPaths.has(filePath))
				hasNew = true
		}
		if (!hasEligible)
			skipped += 1
		else if (hasNew)
			added += 1
		else
			unchanged += 1
	}
	return { added, unchanged, skipped }
}
