import { createClientOperationId } from "../../operationOutcome"
import type { OverlayQueueItem } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { getPathLabel } from "../utils"
import { applyApprovedFilesOverlay } from "./applyApprovedFilesOverlay"
import {
	getErrorMessage,
	isGitPatchPath,
} from "@/features/context/utils"
import {
	cleanupNativeDrop,
	prepareProjectOverlay,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"

type Dependencies = {
	cleanupActiveNativeDrop: () => Promise<void>
	confirmHistoricalReapply: (fingerprint: string) => Promise<"continue" | "cancelled">
	confirmPermanentDeletion: (paths: readonly string[]) => Promise<boolean>
	invalidateMissingRootFolder: () => Promise<boolean>
	recordOverlayFailure: (
		message: string,
		rejectedFiles?: number,
	) => void
	recordOverlaySkip: (skippedFiles: number) => void
	refreshOverlayUndoHistory: () => Promise<unknown>
	updateOverlayBatchNotice: (remainingFiles: number) => void
}

export async function applyFilesDrop(
	state: WorkspaceState,
	deps: Dependencies,
	configuredRootFolder: string,
	uniquePaths: string[],
	nativeDropRoot: string | null,
): Promise<void> {
	const {
		activeNativeDropRootRef,
		hasAppliedCurrentOverlayBatchRef,
		isOperationRunningRef,
		locale,
		overlayBatchStatsRef,
		overlayUndoHistoryLimit,
		pendingOverlayQueueIndexRef,
		pendingOverlayQueueRef,
		setIsApplying,
		setNotice,
		setOperationRevision,
		setPendingGitPatch,
		setPendingOverlay,
	} = state
	if (uniquePaths.some(isGitPatchPath)) {
		if (nativeDropRoot !== null)
			await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
		setNotice({
			kind: "warning",
			message: translate(
				locale,
				"workspace.filesModePatchRejected",
			),
		})
		return
	}

	await deps.cleanupActiveNativeDrop()
	activeNativeDropRootRef.current = nativeDropRoot
	isOperationRunningRef.current = true
	setIsApplying(true)
	pendingOverlayQueueRef.current = []
	pendingOverlayQueueIndexRef.current = 0
	hasAppliedCurrentOverlayBatchRef.current = false
	setPendingOverlay(null)
	setPendingGitPatch(null)
	overlayBatchStatsRef.current = {
		operationId: createClientOperationId("files_apply"),
		createdFiles: 0,
		editedFiles: 0,
		deletedFiles: 0,
		unchangedFiles: 0,
		createdDirectories: 0,
		editedDirectories: 0,
		deletedDirectories: 0,
		unchangedDirectories: 0,
		protectedSecretFiles: 0,
		detectedSecrets: 0,
		permanentDeletedFiles: 0,
		permanentDeletedDirectories: 0,
		permanentDeletionError: null,
		rejectedFiles: 0,
		skippedFiles: 0,
		firstFailure: null,
	}

	try {
		if (await deps.invalidateMissingRootFolder())
			return
		const pendingItems: OverlayQueueItem[] = []
		for (const path of uniquePaths) {
			const sourceLabel = getPathLabel(path)
			try {
				const itemPaths = [path]
				const plan = await prepareProjectOverlay(
					configuredRootFolder,
					itemPaths,
				)
				if (plan.fileCount === 0 && plan.deleteCount === 0) {
					deps.recordOverlayFailure(translate(
						locale,
						"workspace.noApplyFilesForItem",
						{ source: sourceLabel },
					))
					continue
				}
				if (plan.ambiguityLimitExceeded) {
					deps.recordOverlayFailure(
						translate(locale, "workspace.applyTooAmbiguous", {
							source: sourceLabel,
							count: plan.candidateCount,
							limit: plan.ambiguityLimit,
						}),
						plan.fileCount + plan.deleteCount,
					)
					continue
				}
				const historicalReapply = await deps.confirmHistoricalReapply(plan.sourceFingerprint)
				if (historicalReapply === "cancelled") {
					deps.recordOverlaySkip(plan.fileCount + plan.deleteCount)
					continue
				}
				const recommendedCandidate = plan.recommendedCandidateIndex === null ?
					null :
					plan.candidates[plan.recommendedCandidateIndex] ?? null
				if (recommendedCandidate !== null) {
					const result = await applyApprovedFilesOverlay({
						rootFolder: configuredRootFolder,
						paths: itemPaths,
						candidate: recommendedCandidate,
						plan,
						appendUndo: hasAppliedCurrentOverlayBatchRef.current,
						undoHistoryLimit: overlayUndoHistoryLimit,
						locale,
						confirmPermanentDeletion: deps.confirmPermanentDeletion,
					})
					if (result === null) {
						deps.recordOverlaySkip(plan.fileCount + plan.deleteCount)
						continue
					}
					if (result.addedFiles + result.replacedFiles + result.deletedFiles + result.deletedDirectories > 0)
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
					continue
				}
				pendingItems.push({
					paths: itemPaths,
					sourceLabel,
					sourceFingerprint: plan.sourceFingerprint,
					routingFingerprint: plan.routingFingerprint,
					fileCount: plan.fileCount,
					deleteCount: plan.deleteCount,
					permanentDeletePaths: plan.permanentDeletePaths,
					candidates: plan.candidates,
				})
			} catch (error) {
				deps.recordOverlayFailure(translate(locale, "workspace.applyItemFailed", {
					source: sourceLabel,
					error: getErrorMessage(
						error,
						locale,
					),
				}))
			}
		}
		pendingOverlayQueueRef.current = pendingItems
		pendingOverlayQueueIndexRef.current = 0
		const firstPending = pendingItems[0]
		if (firstPending !== undefined)
			setPendingOverlay({ ...firstPending, queuePosition: 1, queueTotal: pendingItems.length })

		deps.updateOverlayBatchNotice(pendingItems.reduce(
			(
				total,
				item,
			) => total + item.fileCount + item.deleteCount,
			0,
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
		setIsApplying(false)
		if (pendingOverlayQueueRef.current.length === 0) {
			void deps.refreshOverlayUndoHistory()
			void deps.cleanupActiveNativeDrop()
		}
	}
}
