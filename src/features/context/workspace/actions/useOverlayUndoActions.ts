import { undoOutcomeFromResult } from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import { undoProjectOverlay } from "@/infra/desktop"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions>

export function useOverlayUndoActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { isOperationRunningRef, locale, overlayUndoHistory, rootFolderRef, setIsApplying, setNotice, setOperationRevision, setPendingGitPatch, setPendingOverlay } = state
	const { refreshOverlayUndoHistory } = deps

	const undoOverlay = useCallback(
		async (steps: number) => {
			if (
				isOperationRunningRef.current ||
				steps < 1 ||
				steps > overlayUndoHistory.length
			)
				return

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await undoProjectOverlay(
					configuredRootFolder,
					steps,
				)
				const outcome = undoOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				await refreshOverlayUndoHistory()
				setPendingOverlay(null)
				setPendingGitPatch(null)
				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.undoDone",
					{
						batches: result.undoneBatches,
						restored: result.restoredFiles,
						removed: result.removedFiles,
					},
				))
			} catch (error) {
				await refreshOverlayUndoHistory().catch(() => undefined)
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
				setIsApplying(false)
			}
		},
		[
			locale,
			overlayUndoHistory.length,
			refreshOverlayUndoHistory,
			isOperationRunningRef,
			rootFolderRef,
			setIsApplying,
			setNotice,
			setOperationRevision,
			setPendingGitPatch,
			setPendingOverlay,
		],
	)

	return {
		undoOverlay,
	}
}
