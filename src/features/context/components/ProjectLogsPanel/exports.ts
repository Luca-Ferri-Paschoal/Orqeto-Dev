import { formatProjectLogs } from "../../formatProjectLogs"
import { projectName } from "./helpers"
import {
	clearProjectLogSession,
	getProjectLogSnapshot,
	saveExportFile,
} from "@/infra/desktop"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"

interface ExportOptions {
	rootFolder: string
	locale: Locale
	effectiveCommand: string
}

interface CopyOptions extends ExportOptions {
	clearAfterCopy: boolean
}

export interface CopyProjectLogsResult {
	copied: boolean
	clearedCursor: number | null
}

export async function copyProjectLogs(options: CopyOptions): Promise<CopyProjectLogsResult> {
	const snapshot = await getProjectLogSnapshot(
		options.rootFolder,
		0,
	)
	if (snapshot.entries.length === 0)
		return { copied: false, clearedCursor: null }
	await writeText(formatProjectLogs(
		options.locale,
		snapshot.command ?? options.effectiveCommand,
		snapshot.startedAtMs,
		snapshot.entries,
		snapshot.truncated,
	))
	if (!options.clearAfterCopy)
		return { copied: true, clearedCursor: null }
	const cleared = await clearProjectLogSession(
		options.rootFolder,
		snapshot.latestSequence,
	)
	return { copied: true, clearedCursor: cleared.cursor }
}

export async function downloadProjectLogs(options: ExportOptions): Promise<boolean> {
	const snapshot = await getProjectLogSnapshot(
		options.rootFolder,
		0,
	)
	if (snapshot.entries.length === 0)
		return false
	await saveExportFile({
		suggestedFileName: `${projectName(options.rootFolder)}-logs.txt`,
		dialogTitle: translate(
			options.locale,
			"logs.downloadTitle",
		),
		filterName: translate(
			options.locale,
			"logs.downloadFilter",
		),
		extension: "txt",
		content: formatProjectLogs(
			options.locale,
			snapshot.command ?? options.effectiveCommand,
			snapshot.startedAtMs,
			snapshot.entries,
			snapshot.truncated,
		),
	})
	return true
}
