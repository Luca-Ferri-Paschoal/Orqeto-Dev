import type { OperationUndoReference } from "../../operationOutcome"
import {
	gitApplyOutcomeFromResult,
	isContextualUndoEligible,
	undoOutcomeFromResult,
} from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	applyGitPatch,
	getProjectOverlayUndoHistory,
	undoProjectOverlay,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions>

export function usePendingGitActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { isOperationRunningRef, locale, overlayUndoHistoryLimit, pendingGitPatch, rootFolderRef, routedGitPatchResolutionRef, setIsApplying, setNotice, setOperationRevision, setPendingGitPatch, setPendingOverlay, workMode } = state
	const { cleanupActiveNativeDrop, refreshOverlayUndoHistory } = deps

	const undoApplicationIfLatest = useCallback(
		async (reference: OperationUndoReference): Promise<boolean> => {
			const configuredRootFolder = rootFolderRef.current

			if (
				configuredRootFolder === null ||
				configuredRootFolder !== reference.projectRoot ||
				isOperationRunningRef.current
			)
				return false

			const currentHistory = await getProjectOverlayUndoHistory(
				configuredRootFolder,
				overlayUndoHistoryLimit,
			)

			if (!isContextualUndoEligible(
				reference,
				currentHistory[0],
			))
				return false

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await undoProjectOverlay(
					configuredRootFolder,
					1,
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
				return true
			} catch (error) {
				await refreshOverlayUndoHistory().catch(() => undefined)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
				return false
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)
			}
		},
		[
			locale,
			overlayUndoHistoryLimit,
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

	const confirmPendingGitPatch = useCallback(
		async (): Promise<void> => {
			const currentPatch = pendingGitPatch
			const configuredRootFolder = rootFolderRef.current
			const routedResolution = routedGitPatchResolutionRef.current

			if (
				currentPatch === null ||
				configuredRootFolder === null ||
				workMode !== "git" ||
				isOperationRunningRef.current
			)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)
			setPendingGitPatch(null)

			try {
				const result = await applyGitPatch(
					configuredRootFolder,
					currentPatch.patchPath,
					currentPatch.patchFingerprint,
					overlayUndoHistoryLimit,
				)
				const outcome = gitApplyOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				await refreshOverlayUndoHistory()
				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.gitPatchAppliedSummary",
					{ patch: currentPatch.patchName },
				))

				if (routedResolution !== null) {
					routedGitPatchResolutionRef.current = null
					routedResolution.resolve(outcome.undoReference === null ?
						{
							status: "failed",
							undoReference: null,
						} :
						{
							status: "success",
							undoReference: outcome.undoReference,
						})
				}
			} catch (error) {
				await refreshOverlayUndoHistory().catch(() => undefined)
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.gitPatchApplyFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})

				if (routedResolution !== null) {
					routedGitPatchResolutionRef.current = null
					routedResolution.resolve({
						status: "failed",
						undoReference: null,
					})
				}
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)

				if (routedResolution === null)
					void cleanupActiveNativeDrop()
			}
		},
		[
			cleanupActiveNativeDrop,
			locale,
			overlayUndoHistoryLimit,
			pendingGitPatch,
			refreshOverlayUndoHistory,
			workMode,
			isOperationRunningRef,
			rootFolderRef,
			routedGitPatchResolutionRef,
			setIsApplying,
			setNotice,
			setOperationRevision,
			setPendingGitPatch,
		],
	)

	const cancelPendingGitPatch = useCallback(
		() => {
			if (pendingGitPatch === null)
				return

			const routedResolution = routedGitPatchResolutionRef.current

			setPendingGitPatch(null)

			if (routedResolution !== null) {
				routedGitPatchResolutionRef.current = null
				routedResolution.resolve({
					status: "cancelled",
					undoReference: null,
				})
				return
			}

			void cleanupActiveNativeDrop()
		},
		[
			cleanupActiveNativeDrop,
			pendingGitPatch,
			routedGitPatchResolutionRef,
			setPendingGitPatch,
		],
	)

	return {
		undoApplicationIfLatest,
		confirmPendingGitPatch,
		cancelPendingGitPatch,
	}
}
