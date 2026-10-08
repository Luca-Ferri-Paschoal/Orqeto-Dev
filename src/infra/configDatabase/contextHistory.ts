import { validateHistoryLimit } from "./shared"
import type {
	ContextHistoryEntry,
	ContextHistoryKind,
	ContextHistorySnapshot,
} from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

interface ContextHistoryRow {
	id: number
	kind: ContextHistoryKind
	fileCount: number
	byteCount: number
	createdAt: number
}
export async function getContextHistory(rootFolder: string, limit: number): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)
	return invoke<ContextHistoryRow[]>(
		"config_get_context_history",
		{ rootFolder, limit },
	)
}
export const getContextHistoryContent = (
	rootFolder: string,
	id: number,
) => invoke<string>(
	"config_get_context_history_content",
	{ rootFolder, id },
)
export async function saveContextHistoryEntry(rootFolder: string, entry: ContextHistorySnapshot, limit: number): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke("config_save_context_history_entry", {
		rootFolder,
		kind: entry.kind,
		content: entry.content,
		fileCount: entry.fileCount,
		byteCount: entry.byteCount,
		createdAt: entry.createdAt,
		limit,
	})
	return getContextHistory(
		rootFolder,
		limit,
	)
}
export async function deleteContextHistoryEntry(rootFolder: string, id: number, limit: number): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke(
		"config_delete_context_history_entry",
		{ rootFolder, id },
	)
	return getContextHistory(
		rootFolder,
		limit,
	)
}
