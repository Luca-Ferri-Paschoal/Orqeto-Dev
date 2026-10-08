import type { ContextFilter } from "../../contextPathFilter"
import {
	filterContextFiles,
	filterSkippedFiles,
	normalizeContextPathFilter,
} from "../../contextPathFilter"
import type { ContextSelectionActionStats } from "../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import { countInputDirectoriesByContribution } from "../utils"
import { createContextAddNotice } from "./contextAddNotice"
import {
	copyAddedContext,
	persistContextAddFilterHistory,
} from "./contextAddPostProcessing"
import type { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import { processDrop } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceCoreStateActions> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useContextAddActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { autoClearAfterExport, autoCopyContextAfterAdd, contextFilterHistoryLimit, contextFilterMode, contextFilterTarget, contextPathFilter, contextPathFilterError, contextSelectionRevisionRef, filesRef, isOperationRunningRef, locale, rootFolderRef, rootRevisionRef, setContextFilterHistory, setIsProcessing, setNotice, setOperationRevision } = state
	const { beginCancellableContextOperation, commitCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, appendFiles, materializeSelectedContext, copyContextToClipboard, invalidateMissingRootFolder } = deps
	const addDroppedPaths = useCallback(
		async (
			paths: string[],
			copyAfterAdd = false,
			externalAction = false,
		) => {
			if (isOperationRunningRef.current) {
				const message = translate(
					locale,
					"workspace.contextBusy",
				)

				if (externalAction)
					throw new Error(message)

				setNotice({
					kind: "info",
					message,
				})
				return
			}

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				const message = translate(
					locale,
					"workspace.selectRootForContext",
				)

				if (externalAction)
					throw new Error(message)

				setNotice({
					kind: "warning",
					message,
				})
				return
			}

			if (contextPathFilterError !== null) {
				if (externalAction)
					throw new Error(contextPathFilterError)

				setNotice({
					kind: "warning",
					message: contextPathFilterError,
				})
				return
			}

			const uniquePaths = [...new Set(paths)]

			if (uniquePaths.length === 0)
				return

			const cancellationToken = beginCancellableContextOperation(
				"create",
				!externalAction,
			)

			if (cancellationToken === null)
				return

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				if (await invalidateMissingRootFolder()) {
					if (externalAction) {
						throw new Error(translate(
							locale,
							"workspace.rootMissing",
						))
					}

					return
				}

				const rootRevision = rootRevisionRef.current
				const selectionRevision = contextSelectionRevisionRef.current
				const existingPaths = new Set<string>(filesRef.current.map(file => file.relativePath))
				const result = await processDrop(
					configuredRootFolder,
					uniquePaths,
				)

				if (!commitCancellableContextOperation(cancellationToken))
					return

				if (
					rootFolderRef.current !== configuredRootFolder ||
					rootRevisionRef.current !== rootRevision ||
					contextSelectionRevisionRef.current !== selectionRevision
				) {
					throw new Error(translate(
						locale,
						"workspace.contextChangedDuringSelection",
					))
				}

				const contextFilter: ContextFilter = {
					pattern: contextPathFilter,
					target: contextFilterTarget,
					mode: contextFilterMode,
				}
				const filteredFiles = filterContextFiles(
					result.files,
					contextFilter,
				)
				const filteredSkippedFiles = filterSkippedFiles(
					result.skippedFiles,
					contextFilter,
				)
				const filterEnabled = normalizeContextPathFilter(contextPathFilter).length > 0
				const eligiblePathSet = new Set<string>(filteredFiles.map(file => file.relativePath))
				const directoryStats = countInputDirectoriesByContribution(
					result.directories.map(relativePath => ({
						relativePath,
						isDirectory: true,
					})),
					eligiblePathSet,
					existingPaths,
				)
				const mergeResult = appendFiles(filteredFiles)
				const actionStats: ContextSelectionActionStats = {
					addedFiles: mergeResult.addedFiles,
					addedDirectories: directoryStats.added,
					unchangedFiles: mergeResult.unchangedFiles,
					unchangedDirectories: directoryStats.unchanged,
					skippedFiles: filteredSkippedFiles.length +
						(result.files.length - filteredFiles.length),
					skippedDirectories: directoryStats.skipped + result.skippedDirectoryCount,
				}
				const filterHistoryError = await persistContextAddFilterHistory({
					configuredRootFolder,
					filterEnabled,
					pattern: normalizeContextPathFilter(contextPathFilter),
					target: contextFilterTarget,
					mode: contextFilterMode,
					limit: contextFilterHistoryLimit,
					rootFolderRef,
					rootRevisionRef,
					setEntries: setContextFilterHistory,
				})
				const copyResult = await copyAddedContext({
					shouldCopy: copyAfterAdd || autoCopyContextAfterAdd,
					copyAfterAdd,
					externalAction,
					autoClearAfterExport,
					locale,
					selection: mergeResult.files,
					materializeSelectedContext,
					copyContextToClipboard,
				})
				if (!copyResult.continueOperation)
					return

				setNotice(createContextAddNotice({
					locale,
					projectRoot: configuredRootFolder,
					actionStats,
					exportSkippedFiles: copyResult.exportSkippedFiles,
					exportSkippedDirectories: copyResult.exportSkippedDirectories,
					copyAfterAdd,
					contextCopiedAfterAdd: copyResult.contextCopiedAfterAdd,
					autoCopyError: copyResult.autoCopyError,
					filterHistoryError,
				}))
			} catch (error) {
				if (isCancellableContextOperationActive(cancellationToken)) {
					setNotice({
						kind: "error",
						message: getErrorMessage(
							error,
							locale,
						),
					})

					if (externalAction)
						throw error
				}
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isOperationRunningRef.current = false
					setOperationRevision(revision => revision + 1)
					setIsProcessing(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			appendFiles,
			autoClearAfterExport,
			autoCopyContextAfterAdd,
			copyContextToClipboard,
			contextFilterHistoryLimit,
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			invalidateMissingRootFolder,
			locale,
			materializeSelectedContext,
			contextSelectionRevisionRef,
			filesRef,
			isOperationRunningRef,
			rootFolderRef,
			rootRevisionRef,
			setContextFilterHistory,
			setIsProcessing,
			setNotice,
			setOperationRevision,
		],
	)

	return {
		addDroppedPaths,
	}
}
