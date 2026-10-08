import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "../../contextPathFilter"
import type { UseContextWorkspaceOptions } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import { deleteContextFilterHistoryEntry } from "@/infra/configDatabase"
import {
	closeFolderInExplorer,
	stopProjectLogSession,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceCoreStateActions> & ReturnType<typeof useWorkspaceHistoryActions>

export function useWorkspaceRootFilterActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
	deps: Dependencies,
) {
	const { closeExplorerOnFolderClose, contextFilterHistoryLimit, fullProjectSummaryRequestVersionRef, hasAppliedCurrentOverlayBatchRef, isOperationRunningRef, locale, pendingGitPatch, pendingOverlay, pendingOverlayQueueIndexRef, pendingOverlayQueueRef, rootFolderRef, rootRevisionRef, setContextFilterHistory, setContextFilterMode, setContextFilterTarget, setContextHistory, setContextPathFilter, setFullProjectContextScanState, setIsProcessing, setNotice, setOperationRevision, setOverlayUndoHistory, setPathsOnly, setPendingGitPatch, setPendingOverlay } = state
	const { onRootFolderChange } = options
	const { replaceFiles, updateRootFolderState, cleanupActiveNativeDrop } = deps

	const closeRootFolder = useCallback(
		async () => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			if (
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.tabBusy",
					),
				})
				return
			}

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				await stopProjectLogSession(configuredRootFolder)

				if (!await onRootFolderChange(null))
					return

				updateRootFolderState(null)
				setContextFilterHistory([])
				setContextHistory([])
				replaceFiles([])
				pendingOverlayQueueRef.current = []
				pendingOverlayQueueIndexRef.current = 0
				hasAppliedCurrentOverlayBatchRef.current = false
				setPendingOverlay(null)
				setPendingGitPatch(null)
				setOverlayUndoHistory([])

				let cleanupError: unknown = null

				try {
					await cleanupActiveNativeDrop()
				} catch (error) {
					cleanupError = error
				}

				if (closeExplorerOnFolderClose) {
					try {
						await closeFolderInExplorer(configuredRootFolder)
					} catch (error) {
						cleanupError ??= error
					}
				}

				if (cleanupError !== null) {
					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.rootClosedCleanupWarning",
							{
								error: getErrorMessage(
									cleanupError,
									locale,
								),
							},
						),
					})
					return
				}

				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.rootClosed",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsProcessing(false)
			}
		},
		[
			cleanupActiveNativeDrop,
			closeExplorerOnFolderClose,
			locale,
			onRootFolderChange,
			pendingGitPatch,
			pendingOverlay,
			replaceFiles,
			updateRootFolderState,
			hasAppliedCurrentOverlayBatchRef,
			isOperationRunningRef,
			pendingOverlayQueueIndexRef,
			pendingOverlayQueueRef,
			rootFolderRef,
			setContextFilterHistory,
			setContextHistory,
			setIsProcessing,
			setNotice,
			setOperationRevision,
			setOverlayUndoHistory,
			setPendingGitPatch,
			setPendingOverlay,
		],
	)

	const invalidateFullProjectContextScan = useCallback(
		() => {
			fullProjectSummaryRequestVersionRef.current += 1
			setFullProjectContextScanState({
				rootFolder: rootFolderRef.current,
				value: null,
			})
		},
		[fullProjectSummaryRequestVersionRef, rootFolderRef, setFullProjectContextScanState],
	)

	const updateContextPathFilter = useCallback(
		(value: string) => {
			invalidateFullProjectContextScan()
			setContextPathFilter(value)
		},
		[invalidateFullProjectContextScan, setContextPathFilter],
	)

	const updateContextFilterTarget = useCallback(
		(value: ContextFilterTarget) => {
			invalidateFullProjectContextScan()
			setContextFilterTarget(value)
		},
		[invalidateFullProjectContextScan, setContextFilterTarget],
	)

	const updateContextFilterMode = useCallback(
		(value: ContextFilterMode) => {
			invalidateFullProjectContextScan()
			setContextFilterMode(value)
		},
		[invalidateFullProjectContextScan, setContextFilterMode],
	)

	const clearContextFilter = useCallback(
		() => {
			invalidateFullProjectContextScan()
			setContextPathFilter("")
		},
		[invalidateFullProjectContextScan, setContextPathFilter],
	)

	const updatePathsOnly = useCallback(
		(value: boolean) => {
			setPathsOnly(value)
		},
		[setPathsOnly],
	)

	const selectContextFilterHistory = useCallback(
		(entry: ContextFilterHistoryEntry) => {
			invalidateFullProjectContextScan()
			setContextPathFilter(entry.pattern)
			setContextFilterTarget(entry.target)
			setContextFilterMode(entry.mode)
		},
		[invalidateFullProjectContextScan, setContextFilterMode, setContextFilterTarget, setContextPathFilter],
	)

	const deleteContextFilterHistory = useCallback(
		async (entry: ContextFilterHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				const revision = rootRevisionRef.current
				const entries = await deleteContextFilterHistoryEntry(
					configuredRootFolder,
					entry,
					contextFilterHistoryLimit,
				)
				if (
					rootFolderRef.current === configuredRootFolder &&
					rootRevisionRef.current === revision
				)
					setContextFilterHistory(entries)
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			contextFilterHistoryLimit,
			locale,
			rootFolderRef,
			rootRevisionRef,
			setContextFilterHistory,
			setNotice,
		],
	)

	return {
		closeRootFolder,
		invalidateFullProjectContextScan,
		updateContextPathFilter,
		updateContextFilterTarget,
		updateContextFilterMode,
		clearContextFilter,
		updatePathsOnly,
		selectContextFilterHistory,
		deleteContextFilterHistory,
	}
}
