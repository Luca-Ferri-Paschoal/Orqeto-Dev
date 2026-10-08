import { validateHistoryLimit } from "./shared"
import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "@/domain/contextFilter"
import { invoke } from "@tauri-apps/api/core"

interface ContextFilterHistoryRow {
	pattern: string
	target: string
	mode: string
	lastUsedAt: number
}
const isTarget = (value: string): value is ContextFilterTarget => value === "fileName" || value === "path"
const isMode = (value: string): value is ContextFilterMode => value === "contains" || value === "exact" || value === "regex"

export async function getContextFilterHistory(rootFolder: string, limit: number): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)
	const rows = await invoke<ContextFilterHistoryRow[]>(
		"config_get_context_filter_history",
		{ rootFolder, limit },
	)
	return rows.flatMap(row => isTarget(row.target) && isMode(row.mode) ?
		[{
			pattern: row.pattern,
			target: row.target,
			mode: row.mode,
			lastUsedAt: row.lastUsedAt,
		}] :
		[])
}
export async function saveContextFilterHistoryEntry(rootFolder: string, entry: ContextFilterHistoryEntry, limit: number): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke(
		"config_save_context_filter_history_entry",
		{ rootFolder, ...entry, limit },
	)
	return getContextFilterHistory(
		rootFolder,
		limit,
	)
}
export async function deleteContextFilterHistoryEntry(rootFolder: string, entry: ContextFilterHistoryEntry, limit: number): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke("config_delete_context_filter_history_entry", {
		rootFolder,
		pattern: entry.pattern,
		target: entry.target,
		mode: entry.mode,
	})
	return getContextFilterHistory(
		rootFolder,
		limit,
	)
}
