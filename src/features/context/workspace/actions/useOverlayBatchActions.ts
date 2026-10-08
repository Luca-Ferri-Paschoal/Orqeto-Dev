import type { UseContextWorkspaceOptions } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { formatApplyStatusDetail } from "../utils"
import { createOverlayBatchCompletionNotice } from "./createOverlayBatchCompletionNotice"
import { requestPermanentDeletionApproval } from "./requestPermanentDeletionApproval"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getProjectAppliedSourceHistoryMatch } from "@/infra/desktop"
import {
	translate,
	translateCount,
} from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions>

export function useOverlayBatchActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
	deps: Dependencies,
) {
	const { hasAppliedCurrentOverlayBatchRef, locale, overlayBatchStatsRef, overlayUndoHistoryLimit, pendingOverlayQueueIndexRef, pendingOverlayQueueRef, rootFolderRef, setNotice, setPendingOverlay } = state
	const { requestConfirmation } = options
	const { cleanupActiveNativeDrop, refreshOverlayUndoHistory } = deps

	const updateOverlayBatchNotice = useCallback(
		(pendingFiles: number) => {
			const stats = overlayBatchStatsRef.current
			const failureDetail = stats.firstFailure === null ?
				null :
				translate(
					locale,
					"workspace.applyBatchFailureDetail",
					{ error: stats.firstFailure },
				)

			if (pendingFiles > 0) {
				const details = [
					formatApplyStatusDetail(
						locale,
						"status.apply.created",
						stats.createdFiles,
						stats.createdDirectories,
					),
					formatApplyStatusDetail(
						locale,
						"status.apply.edited",
						stats.editedFiles,
						stats.editedDirectories,
					),
					formatApplyStatusDetail(
						locale,
						"status.apply.deleted",
						stats.deletedFiles,
						stats.deletedDirectories,
					),
					formatApplyStatusDetail(
						locale,
						"status.apply.unchanged",
						stats.unchangedFiles,
						stats.unchangedDirectories,
					),
					...(stats.protectedSecretFiles > 0 ?
						[translate(
							locale,
							"status.apply.protectedSecrets",
							{
								files: stats.protectedSecretFiles,
								secrets: stats.detectedSecrets,
							},
						)] :
						[]),
					translate(
						locale,
						"status.apply.pending",
						{ count: pendingFiles },
					),
				]

				if (stats.rejectedFiles > 0) {
					details.push(translate(
						locale,
						"status.apply.rejected",
						{ count: stats.rejectedFiles },
					))
				}
				if (stats.skippedFiles > 0) {
					details.push(translate(
						locale,
						"status.apply.skipped",
						{ count: stats.skippedFiles },
					))
				}
				if (failureDetail !== null)
					details.push(failureDetail)

				setNotice({
					kind: stats.rejectedFiles > 0 || stats.skippedFiles > 0 || stats.protectedSecretFiles > 0 ?
						"warning" :
						"info",
					message: translate(
						locale,
						"workspace.applyBatchPendingSummary",
					),
					details,
				})
				return
			}

			setNotice(createOverlayBatchCompletionNotice(
				locale,
				rootFolderRef.current,
				stats,
			))
		},
		[locale, overlayBatchStatsRef, rootFolderRef, setNotice],
	)

	const recordOverlayFailure = useCallback(
		(
			message: string,
			rejectedFiles = 1,
		) => {
			const stats = overlayBatchStatsRef.current

			stats.rejectedFiles += rejectedFiles

			if (stats.firstFailure === null)
				stats.firstFailure = message
		},
		[overlayBatchStatsRef],
	)

	const recordOverlaySkip = useCallback(
		(skippedFiles: number) => {
			overlayBatchStatsRef.current.skippedFiles += skippedFiles
		},
		[overlayBatchStatsRef],
	)

	const advancePendingOverlay = useCallback(
		() => {
			const nextIndex = pendingOverlayQueueIndexRef.current + 1
			const queue = pendingOverlayQueueRef.current

			pendingOverlayQueueIndexRef.current = nextIndex

			const next = queue[nextIndex]

			if (next === undefined) {
				pendingOverlayQueueRef.current = []
				pendingOverlayQueueIndexRef.current = 0
				hasAppliedCurrentOverlayBatchRef.current = false
				setPendingOverlay(null)
				updateOverlayBatchNotice(0)
				void refreshOverlayUndoHistory()
				void cleanupActiveNativeDrop()
				return
			}

			setPendingOverlay({
				...next,
				queuePosition: nextIndex + 1,
				queueTotal: queue.length,
			})
			updateOverlayBatchNotice(queue
				.slice(nextIndex)
				.reduce(
					(
						total,
						item,
					) => total + item.fileCount + item.deleteCount,
					0,
				))
		},
		[
			cleanupActiveNativeDrop,
			refreshOverlayUndoHistory,
			updateOverlayBatchNotice,
			hasAppliedCurrentOverlayBatchRef,
			pendingOverlayQueueIndexRef,
			pendingOverlayQueueRef,
			setPendingOverlay,
		],
	)

	const confirmPermanentDeletion = useCallback(
		(paths: readonly string[]) => requestPermanentDeletionApproval(
			locale,
			requestConfirmation,
			paths,
		),
		[locale, requestConfirmation],
	)

	const confirmHistoricalReapply = useCallback(
		async (sourceFingerprint: string): Promise<"continue" | "cancelled"> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return "continue"

			const match = await getProjectAppliedSourceHistoryMatch(
				configuredRootFolder,
				sourceFingerprint,
				overlayUndoHistoryLimit,
			)

			if (match.kind === "latest")
				return "continue"

			if (match.kind !== "older" || match.applicationsAgo === null)
				return "continue"

			const confirmed = await requestConfirmation({
				title: translate(
					locale,
					"workspace.reapplyWarningTitle",
				),
				message: translateCount(
					locale,
					match.applicationsAgo,
					"workspace.reapplyWarning.one",
					"workspace.reapplyWarning.other",
				),
				confirmLabel: translate(
					locale,
					"workspace.reapplyWarningConfirm",
				),
				cancelLabel: translate(
					locale,
					"workspace.reapplyWarningCancel",
				),
			})

			return confirmed ?
				"continue" :
				"cancelled"
		},
		[
			locale,
			overlayUndoHistoryLimit,
			requestConfirmation,
			rootFolderRef,
		],
	)

	return {
		updateOverlayBatchNotice,
		recordOverlayFailure,
		recordOverlaySkip,
		advancePendingOverlay,
		confirmHistoricalReapply,
		confirmPermanentDeletion,
	}
}
