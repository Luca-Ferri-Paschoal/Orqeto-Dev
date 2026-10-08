import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import { getSafeProjectName } from "../utils"
import type { useFullProjectScanActions } from "./useFullProjectScanActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import { saveFullProjectContextExportFile } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useFullProjectScanActions>

export function useFullProjectExportActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { contextHistoryLimit, isGeneratingCommitContextRef, locale, pathsOnly, setIsGeneratingProjectContext, setNotice, workMode } = state
	const { beginCancellableContextOperation, commitCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, loadContextHistory, archiveContextSnapshot, getScannedFullProjectContextFiles, loadFullProjectContext } = deps

	const copyFullProjectContext = useCallback(
		async (): Promise<void> => {
			if (isGeneratingCommitContextRef.current)
				return

			const cancellationToken = beginCancellableContextOperation("project")

			if (cancellationToken === null)
				return

			isGeneratingCommitContextRef.current = true
			setIsGeneratingProjectContext(true)

			try {
				const loaded = await loadFullProjectContext(cancellationToken)

				if (loaded === null || !commitCancellableContextOperation(cancellationToken))
					return

				await writeText(loaded.content)

				if (!await archiveContextSnapshot(
					loaded.content,
					loaded.fileCount,
					"project",
				))
					return

				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.projectContextCopied",
					),
				})
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.projectContextFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isGeneratingCommitContextRef.current = false
					setIsGeneratingProjectContext(false)
				}
			}
		},
		[
			archiveContextSnapshot,
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			loadFullProjectContext,
			locale,
			isGeneratingCommitContextRef,
			setIsGeneratingProjectContext,
			setNotice,
		],
	)

	const downloadFullProjectContext = useCallback(
		async (): Promise<void> => {
			if (isGeneratingCommitContextRef.current)
				return

			const cancellationToken = beginCancellableContextOperation("project")

			if (cancellationToken === null)
				return

			isGeneratingCommitContextRef.current = true
			setIsGeneratingProjectContext(true)

			try {
				const discovery = getScannedFullProjectContextFiles()

				if (discovery === null)
					return

				if (discovery.relativePaths.length === 0) {
					setNotice({
						kind: "info",
						message: translate(
							locale,
							"workspace.projectContextEmpty",
						),
					})
					return
				}

				if (!commitCancellableContextOperation(cancellationToken))
					return

				const result = await saveFullProjectContextExportFile({
					rootFolder: discovery.rootFolder,
					relativePaths: discovery.relativePaths,
					pathsOnly,
					locale,
					workMode,
					suggestedFileName: `${getSafeProjectName(discovery.rootFolder)}-project-context.txt`,
					dialogTitle: translate(
						locale,
						"dialog.saveProjectContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
					contextHistoryLimit,
				})

				if (result.fileCount === 0) {
					setNotice({
						kind: "info",
						message: translate(
							locale,
							"workspace.projectContextEmpty",
						),
					})
					return
				}

				if (!result.saved)
					return

				await loadContextHistory(discovery.rootFolder)

				if (result.historyError !== null) {
					setNotice({
						kind: "warning",
						message: `${translate(
							locale,
							"workspace.projectContextDownloaded",
						)} ${translate(
							locale,
							"workspace.contextHistorySaveFailed",
							{ error: result.historyError },
						)}`,
					})
					return
				}

				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.projectContextDownloaded",
					),
				})
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.projectContextFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isGeneratingCommitContextRef.current = false
					setIsGeneratingProjectContext(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			contextHistoryLimit,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			getScannedFullProjectContextFiles,
			loadContextHistory,
			locale,
			pathsOnly,
			workMode,
			isGeneratingCommitContextRef,
			setIsGeneratingProjectContext,
			setNotice,
		],
	)

	return {
		copyFullProjectContext,
		downloadFullProjectContext,
	}
}
