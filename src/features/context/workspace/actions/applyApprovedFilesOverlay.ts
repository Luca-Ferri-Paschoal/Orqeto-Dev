import { requestSecretReview } from "../../components/SecretReviewDialog"
import type {
	ApplyProjectOverlayResult,
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
} from "../../types"
import { getErrorMessage } from "@/features/context/utils"
import {
	applyProjectOverlay,
	deleteProjectGeneratedDirectoriesPermanently,
	previewProjectOverlaySecrets,
} from "@/infra/desktop"
import type { Locale } from "@/infra/i18n"

export interface ApprovedFilesOverlayOptions {
	rootFolder: string
	paths: string[]
	candidate: OverlayDestinationCandidate
	plan: Pick<PrepareProjectOverlayResult, "permanentDeletePaths" | "sourceFingerprint" | "routingFingerprint">
	appendUndo: boolean
	undoHistoryLimit: number
	locale: Locale
	confirmPermanentDeletion: (paths: readonly string[]) => Promise<boolean>
}

/** A declined irreversible operation never starts the reversible stage. */
export async function applyApprovedFilesOverlay({
	rootFolder,
	paths,
	candidate,
	plan,
	appendUndo,
	undoHistoryLimit,
	locale,
	confirmPermanentDeletion,
}: ApprovedFilesOverlayOptions): Promise<ApplyProjectOverlayResult | null> {
	// Preflight must run before any reversible or irreversible mutation.
	const review = await previewProjectOverlaySecrets(
		rootFolder,
		paths,
		candidate,
		plan.sourceFingerprint,
		plan.routingFingerprint,
	)
	const approvedSecretPaths = review.files.length > 0 ?
		await requestSecretReview(
			review,
			locale,
		) :
		[]
	if (approvedSecretPaths === null)
		return null
	const permanentPaths = plan.permanentDeletePaths
	if (permanentPaths.length > 0 && !await confirmPermanentDeletion(permanentPaths))
		return null

	const result = await applyProjectOverlay(
		rootFolder,
		paths,
		candidate,
		plan.sourceFingerprint,
		plan.routingFingerprint,
		appendUndo,
		undoHistoryLimit,
		approvedSecretPaths,
		review.fingerprint,
	)
	if (permanentPaths.length === 0)
		return result

	try {
		const deleted = await deleteProjectGeneratedDirectoriesPermanently(
			rootFolder,
			permanentPaths,
		)
		return {
			...result,
			permanentDeletedFiles: deleted.deletedFiles,
			permanentDeletedDirectories: deleted.deletedDirectories,
			permanentDeletedBytes: deleted.deletedBytes,
		}
	} catch (error) {
		// Reversible changes may already have been committed. Return an explicit
		// partial/failed outcome rather than claiming that the entire Apply failed.
		return {
			...result,
			permanentDeletionError: getErrorMessage(
				error,
				locale,
			),
		}
	}
}
