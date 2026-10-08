import { formatGeneratedContent } from "../../formatGeneratedContent"
import type { OperationCounter } from "../../operationOutcome"
import { createOperationOutcome } from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { ContextSelectionFile } from "../../types"
import type { MaterializedContextResult } from "../types"
import type { UseContextWorkspaceOptions } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { countAffectedDirectories } from "../utils"
import type { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	folderExists,
	materializeContextFiles,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceCoreStateActions> & ReturnType<typeof useWorkspaceHistoryActions>

export function useWorkspaceMaterializationActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
	deps: Dependencies,
) {
	const { contextSelectionRevisionRef, filesRef, hasAppliedCurrentOverlayBatchRef, isOperationRunningRef, locale, pathsOnly, pendingOverlayQueueIndexRef, pendingOverlayQueueRef, rootFolderRef, rootRevisionRef, routedGitPatchResolutionRef, routedOverlayResolutionRef, setContextFilterHistory, setContextHistory, setIsProcessing, setNotice, setOperationRevision, setOverlayUndoHistory, setPendingGitPatch, setPendingOverlay, workMode } = state
	const { onRootFolderChange } = options
	const { replaceFiles, updateRootFolderState, cleanupActiveNativeDrop, archiveContextSnapshot } = deps

	const materializeSelectedContext = useCallback(
		async (selection: readonly ContextSelectionFile[] = filesRef.current): Promise<MaterializedContextResult | null> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null || selection.length === 0)
				return null

			const rootRevision = rootRevisionRef.current
			const selectionRevision = contextSelectionRevisionRef.current
			const relativePaths = selection.map(file => file.relativePath)
			const result = await materializeContextFiles(
				configuredRootFolder,
				relativePaths,
				pathsOnly,
			)

			if (
				rootFolderRef.current !== configuredRootFolder ||
				rootRevisionRef.current !== rootRevision ||
				contextSelectionRevisionRef.current !== selectionRevision
			) {
				throw new Error(translate(
					locale,
					"workspace.contextChangedDuringExport",
				))
			}

			return {
				content: formatGeneratedContent(
					result.files,
					locale,
					workMode,
				),
				fileCount: result.files.length,
				directoryCount: countAffectedDirectories(
					result.files.map(file => file.relativePath),
					["./"],
				),
				skippedFiles: result.skippedFiles.length,
				skippedDirectories: countAffectedDirectories(
					result.skippedFiles.map(file => file.relativePath),
					["./"],
				),
			}
		},
		[
			locale,
			pathsOnly,
			workMode,
			contextSelectionRevisionRef,
			filesRef,
			rootFolderRef,
			rootRevisionRef,
		],
	)

	const copyContextToClipboard = useCallback(
		async (
			content: string,
			fileCount: number,
			clearAfterCopy: boolean,
		): Promise<boolean> => {
			await writeText(content)

			if (!await archiveContextSnapshot(
				content,
				fileCount,
				"custom",
			))
				return false

			if (clearAfterCopy)
				replaceFiles([])
			return true
		},
		[
			archiveContextSnapshot,
			replaceFiles,
		],
	)

	const clearGeneratedContent = useCallback(
		async (): Promise<void> => {
			if (isOperationRunningRef.current || filesRef.current.length === 0)
				return

			isOperationRunningRef.current = true
			setIsProcessing(true)
			const selectedCount = filesRef.current.length

			try {
				const materialized = await materializeSelectedContext()
				const hasUnavailableItems = materialized !== null && materialized.skippedFiles > 0

				if (
					!hasUnavailableItems &&
					materialized !== null &&
					materialized.content.length > 0 &&
					!await archiveContextSnapshot(
						materialized.content,
						materialized.fileCount,
						"custom",
					)
				)
					return

				replaceFiles([])
				const counters: OperationCounter[] = [{
					kind: "removed",
					files: selectedCount,
					directories: 0,
				}]

				if (hasUnavailableItems) {
					counters.push({
						kind: "unavailable",
						files: materialized.skippedFiles,
						directories: materialized.skippedDirectories,
					})
				}

				const outcome = createOperationOutcome({
					operationType: "context_remove",
					projectRoot: rootFolderRef.current,
					status: hasUnavailableItems ?
						"partial" :
						"success",
					counters,
				})

				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					hasUnavailableItems ?
						"workspace.contextClearedUnavailable" :
						"workspace.contextCleared",
				))
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
			archiveContextSnapshot,
			locale,
			materializeSelectedContext,
			replaceFiles,
			filesRef,
			isOperationRunningRef,
			rootFolderRef,
			setIsProcessing,
			setNotice,
			setOperationRevision,
		],
	)

	const invalidateMissingRootFolder = useCallback(
		async (): Promise<boolean> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return true

			if (await folderExists(configuredRootFolder))
				return false

			await onRootFolderChange(null)
			await cleanupActiveNativeDrop()
			routedOverlayResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedOverlayResolutionRef.current = null
			routedGitPatchResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedGitPatchResolutionRef.current = null
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
			setNotice({
				kind: "warning",
				message: translate(
					locale,
					"workspace.rootMissing",
				),
			})

			return true
		},
		[
			cleanupActiveNativeDrop,
			locale,
			onRootFolderChange,
			replaceFiles,
			updateRootFolderState,
			hasAppliedCurrentOverlayBatchRef,
			pendingOverlayQueueIndexRef,
			pendingOverlayQueueRef,
			rootFolderRef,
			routedGitPatchResolutionRef,
			routedOverlayResolutionRef,
			setContextFilterHistory,
			setContextHistory,
			setNotice,
			setOverlayUndoHistory,
			setPendingGitPatch,
			setPendingOverlay,
		],
	)

	return {
		materializeSelectedContext,
		copyContextToClipboard,
		clearGeneratedContent,
		invalidateMissingRootFolder,
	}
}
