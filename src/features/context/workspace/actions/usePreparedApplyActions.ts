import { filesApplyOutcomeFromResult } from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type {
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
} from "../../types"
import type { PreparedApplyOutcome } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { applyApprovedFilesOverlay } from "./applyApprovedFilesOverlay"
import type { useOverlayBatchActions } from "./useOverlayBatchActions"
import { usePreparedGitPatchAction } from "./usePreparedGitPatchAction"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import { prepareProjectOverlay } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useOverlayBatchActions>

export function usePreparedApplyActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { isOperationRunningRef, locale, overlayUndoHistoryLimit, pendingGitPatch, pendingOverlay, rootFolderRef, routedOverlayResolutionRef, setIsApplying, setNotice, setOperationRevision, setPendingOverlay } = state
	const { refreshOverlayUndoHistory, confirmHistoricalReapply, confirmPermanentDeletion } = deps

	const applyPreparedOverlay = useCallback(
		async (
			paths: string[],
			candidate: OverlayDestinationCandidate,
			sourceFingerprint: string,
			routingFingerprint: string,
			appendUndo: boolean,
		): Promise<PreparedApplyOutcome> => {
			const configuredRootFolder = rootFolderRef.current

			if (
				configuredRootFolder === null ||
				isOperationRunningRef.current
			) {
				return {
					status: "failed",
					undoReference: null,
				}
			}

			isOperationRunningRef.current = true

			try {
				const historicalReapply = await confirmHistoricalReapply(sourceFingerprint)

				if (historicalReapply === "cancelled") {
					return {
						status: "cancelled",
						undoReference: null,
					}
				}

				const plan = await prepareProjectOverlay(
					configuredRootFolder,
					paths,
				)
				if (plan.sourceFingerprint !== sourceFingerprint || plan.routingFingerprint !== routingFingerprint) {
					throw new Error(translate(
						locale,
						"workspace.permanentDeletionSourceChanged",
					))
				}
				setIsApplying(true)
				const result = await applyApprovedFilesOverlay({
					rootFolder: configuredRootFolder,
					paths,
					candidate,
					plan,
					appendUndo,
					undoHistoryLimit: overlayUndoHistoryLimit,
					locale,
					confirmPermanentDeletion,
				})
				if (result === null)
					return { status: "cancelled", undoReference: null }
				const outcome = filesApplyOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				await refreshOverlayUndoHistory()
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

				if (outcome.status === "no_op" || outcome.status === "failed") {
					return {
						status: outcome.status === "no_op" ?
							"no_op" :
							"failed",
						undoReference: null,
					}
				}

				return {
					status: "success",
					undoReference: outcome.undoReference,
				}
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
				return {
					status: "failed",
					undoReference: null,
				}
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)
			}
		},
		[
			confirmHistoricalReapply,
			confirmPermanentDeletion,
			locale,
			overlayUndoHistoryLimit,
			refreshOverlayUndoHistory,
			isOperationRunningRef,
			rootFolderRef,
			setIsApplying,
			setNotice,
			setOperationRevision,
		],
	)

	const beginPreparedOverlayResolution = useCallback(
		async (
			paths: string[],
			sourceLabel: string,
			plan: PrepareProjectOverlayResult,
			appendUndo: boolean,
		): Promise<PreparedApplyOutcome> => {
			if (
				plan.candidates.length === 0 ||
				plan.ambiguityLimitExceeded ||
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				return {
					status: "failed",
					undoReference: null,
				}
			}

			try {
				const historicalReapply = await confirmHistoricalReapply(plan.sourceFingerprint)

				if (historicalReapply === "cancelled") {
					return {
						status: "cancelled",
						undoReference: null,
					}
				}
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
				return {
					status: "failed",
					undoReference: null,
				}
			}

			if (
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				return {
					status: "failed",
					undoReference: null,
				}
			}

			routedOverlayResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})

			setPendingOverlay({
				paths,
				sourceLabel,
				sourceFingerprint: plan.sourceFingerprint,
				routingFingerprint: plan.routingFingerprint,
				fileCount: plan.fileCount,
				deleteCount: plan.deleteCount,
				permanentDeletePaths: plan.permanentDeletePaths,
				candidates: plan.candidates,
				queuePosition: 1,
				queueTotal: 1,
			})
			setNotice({
				kind: "info",
				message: translate(
					locale,
					"workspace.chooseDestination",
				),
			})

			return new Promise(resolve => {
				routedOverlayResolutionRef.current = {
					appendUndo,
					resolve,
				}
			})
		},
		[
			confirmHistoricalReapply,
			locale,
			pendingGitPatch,
			pendingOverlay,
			isOperationRunningRef,
			routedOverlayResolutionRef,
			setNotice,
			setPendingOverlay,
		],
	)

	const { beginPreparedGitPatch } = usePreparedGitPatchAction(
		state,
		deps,
	)

	return {
		applyPreparedOverlay,
		beginPreparedOverlayResolution,
		beginPreparedGitPatch,
	}
}
