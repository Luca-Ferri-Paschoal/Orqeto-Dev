import { filesApplyOutcomeFromResult } from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { OverlayDestinationCandidate } from "../../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { applyApprovedFilesOverlay } from "./applyApprovedFilesOverlay"
import type { useOverlayBatchActions } from "./useOverlayBatchActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useOverlayBatchActions>

export function usePendingOverlayActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { hasAppliedCurrentOverlayBatchRef, isOperationRunningRef, locale, overlayBatchStatsRef, overlayUndoHistoryLimit, pendingOverlay, rootFolderRef, routedOverlayResolutionRef, setIsApplying, setNotice, setOperationRevision, setPendingOverlay } = state
	const { refreshOverlayUndoHistory, recordOverlayFailure, recordOverlaySkip, advancePendingOverlay, confirmPermanentDeletion } = deps

	const confirmPendingOverlay = useCallback(
		async (candidate: OverlayDestinationCandidate) => {
			const currentPendingOverlay = pendingOverlay
			const configuredRootFolder = rootFolderRef.current
			const routedResolution = routedOverlayResolutionRef.current

			if (
				currentPendingOverlay === null ||
				configuredRootFolder === null ||
				isOperationRunningRef.current
			)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)
			setPendingOverlay(null)

			if (routedResolution !== null) {
				try {
					const result = await applyApprovedFilesOverlay({
						rootFolder: configuredRootFolder,
						paths: currentPendingOverlay.paths,
						candidate,
						plan: currentPendingOverlay,
						appendUndo: routedResolution.appendUndo,
						undoHistoryLimit: overlayUndoHistoryLimit,
						locale,
						confirmPermanentDeletion,
					})
					if (result === null) {
						routedOverlayResolutionRef.current = null
						routedResolution.resolve({ status: "cancelled", undoReference: null })
						return
					}
					const outcome = filesApplyOutcomeFromResult(
						configuredRootFolder,
						result,
					)

					await refreshOverlayUndoHistory()
					routedOverlayResolutionRef.current = null
					const changedFiles = result.addedFiles + result.replacedFiles + result.deletedFiles
					const messageKey = result.permanentDeletionError !== undefined ?
						"workspace.permanentDeletionIncomplete" :
						result.protectedSecretFiles > 0 ?
							changedFiles > 0 || result.deletedDirectories > 0 ?
								"workspace.overlayAppliedPartialProtected" :
								"workspace.overlayProtectedOnly" :
							(result.permanentDeletedFiles ?? 0) > 0 && changedFiles === 0 && result.deletedDirectories === 0 ?
								"workspace.permanentDeletionCompleted" :
								outcome.status === "no_op" ?
									"workspace.applyAlreadyApplied" :
									"workspace.overlayAppliedSummary"
					setNotice(createOperationOutcomeNotice(
						locale,
						outcome,
						messageKey,
						messageKey === "workspace.overlayAppliedSummary" ?
							{ destination: candidate.destinationRelativePath } :
							{},
					))

					if (
						outcome.status === "no_op" ||
						outcome.status === "failed" ||
						outcome.status === "blocked" ||
						outcome.status === "cancelled"
					) {
						routedResolution.resolve({
							status: outcome.status,
							undoReference: null,
						})
					} else {
						routedResolution.resolve({
							status: "success",
							undoReference: outcome.undoReference,
						})
					}
				} catch (error) {
					routedOverlayResolutionRef.current = null
					setNotice({
						kind: "error",
						message: translate(
							locale,
							"workspace.applyItemFailed",
							{
								source: currentPendingOverlay.sourceLabel,
								error: getErrorMessage(
									error,
									locale,
								),
							},
						),
					})
					routedResolution.resolve({
						status: "failed",
						undoReference: null,
					})
				} finally {
					isOperationRunningRef.current = false
					setOperationRevision(revision => revision + 1)
					setIsApplying(false)
				}

				return
			}

			try {
				const result = await applyApprovedFilesOverlay({
					rootFolder: configuredRootFolder,
					paths: currentPendingOverlay.paths,
					candidate,
					plan: currentPendingOverlay,
					appendUndo: hasAppliedCurrentOverlayBatchRef.current,
					undoHistoryLimit: overlayUndoHistoryLimit,
					locale,
					confirmPermanentDeletion,
				})
				if (result === null) {
					recordOverlaySkip(currentPendingOverlay.fileCount + currentPendingOverlay.deleteCount)
					return
				}
				const changed = result.addedFiles + result.replacedFiles + result.deletedFiles + result.deletedDirectories > 0

				if (changed)
					hasAppliedCurrentOverlayBatchRef.current = true

				overlayBatchStatsRef.current.createdFiles += result.addedFiles
				overlayBatchStatsRef.current.editedFiles += result.replacedFiles
				overlayBatchStatsRef.current.deletedFiles += result.deletedFiles
				overlayBatchStatsRef.current.unchangedFiles += result.unchangedFiles
				overlayBatchStatsRef.current.createdDirectories += result.addedDirectories
				overlayBatchStatsRef.current.editedDirectories += result.replacedDirectories
				overlayBatchStatsRef.current.deletedDirectories += result.deletedDirectories
				overlayBatchStatsRef.current.unchangedDirectories += result.unchangedDirectories
				overlayBatchStatsRef.current.protectedSecretFiles += result.protectedSecretFiles
				overlayBatchStatsRef.current.detectedSecrets += result.detectedSecrets
				overlayBatchStatsRef.current.permanentDeletedFiles += result.permanentDeletedFiles ?? 0
				overlayBatchStatsRef.current.permanentDeletedDirectories += result.permanentDeletedDirectories ?? 0
				overlayBatchStatsRef.current.permanentDeletionError ??= result.permanentDeletionError ?? null
			} catch (error) {
				recordOverlayFailure(
					translate(
						locale,
						"workspace.applyItemFailed",
						{
							source: currentPendingOverlay.sourceLabel,
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
					currentPendingOverlay.fileCount +
					currentPendingOverlay.deleteCount,
				)
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)
				advancePendingOverlay()
			}
		},
		[
			advancePendingOverlay,
			confirmPermanentDeletion,
			locale,
			overlayUndoHistoryLimit,
			pendingOverlay,
			recordOverlayFailure,
			recordOverlaySkip,
			refreshOverlayUndoHistory,
			hasAppliedCurrentOverlayBatchRef,
			isOperationRunningRef,
			overlayBatchStatsRef,
			rootFolderRef,
			routedOverlayResolutionRef,
			setIsApplying,
			setNotice,
			setOperationRevision,
			setPendingOverlay,
		],
	)

	const cancelPendingOverlay = useCallback(
		() => {
			const currentPendingOverlay = pendingOverlay

			if (currentPendingOverlay === null)
				return

			const routedResolution = routedOverlayResolutionRef.current

			if (routedResolution !== null) {
				setPendingOverlay(null)
				routedOverlayResolutionRef.current = null
				routedResolution.resolve({
					status: "cancelled",
					undoReference: null,
				})
				return
			}

			recordOverlaySkip(currentPendingOverlay.fileCount +
				currentPendingOverlay.deleteCount)
			advancePendingOverlay()
		},
		[
			advancePendingOverlay,
			pendingOverlay,
			recordOverlaySkip,
			routedOverlayResolutionRef,
			setPendingOverlay,
		],
	)

	return {
		confirmPendingOverlay,
		cancelPendingOverlay,
	}
}
