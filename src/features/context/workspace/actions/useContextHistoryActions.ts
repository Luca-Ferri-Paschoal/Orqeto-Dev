import type { ContextHistoryEntry } from "../../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { getErrorMessage } from "@/features/context/utils"
import {
	deleteContextHistoryEntry,
	getContextHistoryContent,
} from "@/infra/configDatabase"
import { saveContextHistoryExportFile } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

export function useContextHistoryActions(state: WorkspaceState) {
	const { contextHistoryLimit, locale, rootFolderRef, rootRevisionRef, setContextHistory, setNotice } = state

	const copyContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				const revision = rootRevisionRef.current
				const content = await getContextHistoryContent(
					configuredRootFolder,
					entry.id,
				)

				if (
					rootFolderRef.current !== configuredRootFolder ||
					rootRevisionRef.current !== revision
				)
					return

				await writeText(content)
				setNotice(null)
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistoryCopyFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[locale, rootFolderRef, rootRevisionRef, setNotice],
	)

	const downloadContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				const saved = await saveContextHistoryExportFile({
					rootFolder: configuredRootFolder,
					id: entry.id,
					suggestedFileName: "orqeto-dev-context-history.txt",
					dialogTitle: translate(
						locale,
						"dialog.saveContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
				})

				if (!saved)
					return
				setNotice(null)
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistoryDownloadFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[locale, rootFolderRef, setNotice],
	)

	const deleteContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				const revision = rootRevisionRef.current
				const entries = await deleteContextHistoryEntry(
					configuredRootFolder,
					entry.id,
					contextHistoryLimit,
				)
				if (
					rootFolderRef.current === configuredRootFolder &&
					rootRevisionRef.current === revision
				)
					setContextHistory(entries)
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistoryDeleteFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			contextHistoryLimit,
			locale,
			rootFolderRef,
			rootRevisionRef,
			setContextHistory,
			setNotice,
		],
	)

	return {
		copyContextHistory,
		downloadContextHistory,
		deleteContextHistory,
	}
}
