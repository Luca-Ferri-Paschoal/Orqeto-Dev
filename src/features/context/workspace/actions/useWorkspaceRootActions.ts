import type { UseContextWorkspaceOptions } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	findProjectForRoot,
	folderExists,
	openFolderInExplorer,
	openFolderInVscode,
	stopProjectLogSession,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { dirname } from "@tauri-apps/api/path"
import { open } from "@tauri-apps/plugin-dialog"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceCoreStateActions> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useWorkspaceRootActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
	deps: Dependencies,
) {
	const { hasAppliedCurrentOverlayBatchRef, isOperationRunningRef, locale, openExplorerOnProjectOpen, pendingGitPatch, pendingOverlay, pendingOverlayQueueIndexRef, pendingOverlayQueueRef, rootFolderRef, setIsProcessing, setNotice, setOperationRevision, setOverlayUndoHistory, setPendingGitPatch, setPendingOverlay } = state
	const { folderPickerReferenceRoot, onRootFolderChange } = options
	const { replaceFiles, updateRootFolderState, loadFilterHistory, loadContextHistory, cleanupActiveNativeDrop, refreshOverlayUndoHistory, invalidateMissingRootFolder } = deps

	const configureRootFolder = useCallback(
		async (
			path: string,
			noticeMessage: string | null,
		): Promise<boolean> => {
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
				return false
			}

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				if (!await folderExists(path)) {
					setNotice({
						kind: "error",
						message: translate(
							locale,
							"workspace.requestedRootUnavailable",
						),
					})
					return false
				}

				const previousRootFolder = rootFolderRef.current
				const sameConfiguredProject = previousRootFolder !== null &&
					previousRootFolder !== path &&
					await findProjectForRoot(
						[previousRootFolder],
						path,
					) === 0
				const nextRootFolder = sameConfiguredProject ?
					previousRootFolder :
					path
				const folderChanged = previousRootFolder !== nextRootFolder

				if (folderChanged && previousRootFolder !== null)
					await stopProjectLogSession(previousRootFolder)

				if (folderChanged && !await onRootFolderChange(nextRootFolder))
					return false

				updateRootFolderState(nextRootFolder)

				if (folderChanged) {
					await cleanupActiveNativeDrop()
					replaceFiles([])
					pendingOverlayQueueRef.current = []
					pendingOverlayQueueIndexRef.current = 0
					hasAppliedCurrentOverlayBatchRef.current = false
					setPendingOverlay(null)
					setPendingGitPatch(null)
					setOverlayUndoHistory([])
				}

				await loadFilterHistory(nextRootFolder)
				await loadContextHistory(nextRootFolder)
				await refreshOverlayUndoHistory()

				if (noticeMessage !== null) {
					setNotice({
						kind: "success",
						message: noticeMessage,
					})
				} else if (folderChanged)
					setNotice(null)

				if (openExplorerOnProjectOpen)
					await openFolderInExplorer(nextRootFolder)

				return true
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsProcessing(false)
			}
		},
		[
			cleanupActiveNativeDrop,
			loadContextHistory,
			loadFilterHistory,
			locale,
			refreshOverlayUndoHistory,
			onRootFolderChange,
			openExplorerOnProjectOpen,
			pendingGitPatch,
			pendingOverlay,
			replaceFiles,
			updateRootFolderState,
			hasAppliedCurrentOverlayBatchRef,
			isOperationRunningRef,
			pendingOverlayQueueIndexRef,
			pendingOverlayQueueRef,
			rootFolderRef,
			setIsProcessing,
			setNotice,
			setOperationRevision,
			setOverlayUndoHistory,
			setPendingGitPatch,
			setPendingOverlay,
		],
	)

	const openConfiguredFolder = useCallback(
		async () => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				if (await invalidateMissingRootFolder())
					return

				await openFolderInExplorer(configuredRootFolder)
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
			invalidateMissingRootFolder,
			locale,
			rootFolderRef,
			setNotice,
		],
	)

	const openConfiguredFolderInVscode = useCallback(
		async () => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				if (await invalidateMissingRootFolder())
					return

				await openFolderInVscode(configuredRootFolder)
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
			invalidateMissingRootFolder,
			locale,
			rootFolderRef,
			setNotice,
		],
	)

	const selectRootFolder = useCallback(
		async () => {
			try {
				const currentRootFolder = rootFolderRef.current
				const referenceRootFolder = currentRootFolder ?? folderPickerReferenceRoot
				const defaultPath = referenceRootFolder === null ?
					undefined :
					await dirname(referenceRootFolder)
				const selectedPath = await open({
					directory: true,
					multiple: false,
					defaultPath,
					title: translate(
						locale,
						rootFolderRef.current === null ?
							"dialog.selectRoot" :
							"dialog.changeRoot",
					),
				})

				if (selectedPath === null)
					return

				if (typeof selectedPath !== "string") {
					throw new Error(translate(
						locale,
						"workspace.invalidFolderPicker",
					))
				}

				await configureRootFolder(
					selectedPath,
					translate(
						locale,
						"workspace.rootConfigured",
					),
				)
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
			configureRootFolder,
			folderPickerReferenceRoot,
			locale,
			rootFolderRef,
			setNotice,
		],
	)

	return {
		configureRootFolder,
		openConfiguredFolder,
		openConfiguredFolderInVscode,
		selectRootFolder,
	}
}
