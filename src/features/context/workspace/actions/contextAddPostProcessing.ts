import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "../../contextPathFilter"
import type { ContextSelectionFile } from "../../types"
import type { MaterializedContextResult } from "../types"
import { saveContextFilterHistoryEntry } from "@/infra/configDatabase"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import type { MutableRefObject } from "react"

interface PersistFilterHistoryOptions {
	configuredRootFolder: string
	filterEnabled: boolean
	pattern: string
	target: ContextFilterTarget
	mode: ContextFilterMode
	limit: number
	rootFolderRef: MutableRefObject<string | null>
	rootRevisionRef: MutableRefObject<number>
	setEntries: (entries: ContextFilterHistoryEntry[]) => void
}

export async function persistContextAddFilterHistory(options: PersistFilterHistoryOptions): Promise<unknown> {
	if (!options.filterEnabled)
		return null

	try {
		const revision = options.rootRevisionRef.current
		const entries = await saveContextFilterHistoryEntry(
			options.configuredRootFolder,
			{
				pattern: options.pattern,
				target: options.target,
				mode: options.mode,
				lastUsedAt: Date.now(),
			},
			options.limit,
		)
		if (
			options.rootFolderRef.current === options.configuredRootFolder &&
			options.rootRevisionRef.current === revision
		)
			options.setEntries(entries)
		return null
	} catch (error) {
		return error
	}
}

interface CopyAddedContextOptions {
	shouldCopy: boolean
	copyAfterAdd: boolean
	externalAction: boolean
	autoClearAfterExport: boolean
	locale: "pt-BR" | "en"
	selection: readonly ContextSelectionFile[]
	materializeSelectedContext: (selection?: readonly ContextSelectionFile[]) => Promise<MaterializedContextResult | null>
	copyContextToClipboard: (
		content: string,
		fileCount: number,
		clearAfterCopy: boolean,
	) => Promise<boolean>
}

interface CopyAddedContextResult {
	continueOperation: boolean
	autoCopyError: unknown
	exportSkippedFiles: number
	exportSkippedDirectories: number
	contextCopiedAfterAdd: boolean
}

export async function copyAddedContext(options: CopyAddedContextOptions): Promise<CopyAddedContextResult> {
	const result: CopyAddedContextResult = {
		continueOperation: true,
		autoCopyError: null,
		exportSkippedFiles: 0,
		exportSkippedDirectories: 0,
		contextCopiedAfterAdd: false,
	}
	if (!options.shouldCopy)
		return result

	try {
		const materialized = await options.materializeSelectedContext(options.selection)
		result.exportSkippedFiles = materialized?.skippedFiles ?? 0
		result.exportSkippedDirectories = materialized?.skippedDirectories ?? 0
		if (materialized === null || materialized.content.length === 0) {
			throw new Error(translate(
				options.locale,
				"workspace.contextNothingAvailable",
			))
		}
		if (options.copyAfterAdd && materialized.skippedFiles > 0) {
			throw new Error(translate(
				options.locale,
				"workspace.contextCopyIncomplete",
			))
		}

		if (options.copyAfterAdd) {
			const copied = await options.copyContextToClipboard(
				materialized.content,
				materialized.fileCount,
				options.autoClearAfterExport,
			)
			if (!copied) {
				if (options.externalAction) {
					throw new Error(translate(
						options.locale,
						"workspace.contextCopyNotCompleted",
					))
				}
				result.continueOperation = false
				return result
			}
		} else
			await writeText(materialized.content)

		result.contextCopiedAfterAdd = true
	} catch (error) {
		if (options.externalAction && options.copyAfterAdd)
			throw error
		result.autoCopyError = error
	}
	return result
}
