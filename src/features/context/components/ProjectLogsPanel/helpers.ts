import type { ProjectLogEntry } from "@/features/context/types"
import type { Locale } from "@/infra/i18n"

const MAX_LOCAL_LOG_ENTRIES = 20_000
const MAX_LOCAL_LOG_CHARS = 8 * 1024 * 1024

export function formatLogTime(locale: Locale, timestampMs: number): string {
	return new Intl.DateTimeFormat(
		locale,
		{
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		},
	).format(new Date(timestampMs))
}

export function retainBoundedEntries(entries: ProjectLogEntry[]): { entries: ProjectLogEntry[]; truncated: boolean } {
	let characters = 0
	let start = entries.length
	while (start > 0 && entries.length - start < MAX_LOCAL_LOG_ENTRIES) {
		const next = entries[start - 1]
		if (next === undefined)
			break
		if (characters + next.message.length > MAX_LOCAL_LOG_CHARS)
			break
		characters += next.message.length
		start -= 1
	}
	return {
		entries: entries.slice(start),
		truncated: start > 0,
	}
}

export function projectName(rootFolder: string): string {
	const normalized = rootFolder.replaceAll(
		"\\",
		"/",
	)
	return normalized.split("/").filter(Boolean).at(-1) ?? "project"
}
