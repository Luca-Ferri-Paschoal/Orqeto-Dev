import { filesApplyOutcomeFromResult } from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { AppNotice } from "../../types"
import type { OverlayBatchStats } from "../types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function createOverlayBatchCompletionNotice(
	locale: Locale,
	rootFolder: string | null,
	stats: OverlayBatchStats,
): AppNotice {
	const failureDetail = stats.firstFailure === null ?
		null :
		translate(
			locale,
			"workspace.applyBatchFailureDetail",
			{ error: stats.firstFailure },
		)
	const failures = [
		...(failureDetail === null ?
			[] :
			[failureDetail]),
		...(stats.permanentDeletionError === null ?
			[] :
			[stats.permanentDeletionError]),
	]
	const changedFiles = stats.createdFiles +
		stats.editedFiles +
		stats.deletedFiles +
		stats.permanentDeletedFiles
	const outcome = filesApplyOutcomeFromResult(
		rootFolder,
		{
			operationId: stats.operationId,
			appliedAtUnixMs: null,
			addedFiles: stats.createdFiles,
			replacedFiles: stats.editedFiles,
			deletedFiles: stats.deletedFiles,
			unchangedFiles: stats.unchangedFiles,
			addedDirectories: stats.createdDirectories,
			replacedDirectories: stats.editedDirectories,
			deletedDirectories: stats.deletedDirectories,
			unchangedDirectories: stats.unchangedDirectories,
			protectedSecretFiles: stats.protectedSecretFiles,
			detectedSecrets: stats.detectedSecrets,
			permanentDeletedFiles: stats.permanentDeletedFiles,
			permanentDeletedDirectories: stats.permanentDeletedDirectories,
		},
		{
			rejectedFiles: stats.rejectedFiles,
			skippedFiles: stats.skippedFiles,
			failures,
		},
	)
	const messageKey = stats.protectedSecretFiles > 0 ?
		changedFiles > 0 ?
			"workspace.overlayAppliedPartialProtected" :
			"workspace.overlayProtectedOnly" :
		changedFiles === 0 && stats.unchangedFiles > 0 && failures.length === 0 ?
			"workspace.applyAlreadyApplied" :
			"workspace.applyBatchDoneSummary"

	return createOperationOutcomeNotice(
		locale,
		outcome,
		messageKey,
	)
}
