import type {
	AppliedSourceHistoryMatch,
	ApplyProjectOverlayResult,
	OverlayDestinationCandidate,
	OverlayUndoHistoryEntry,
	PrepareProjectOverlayResult,
	SecretReviewResult,
	UndoProjectOverlayResult,
} from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export interface OverlayRecoveryStatus { blocked: boolean }
export const getOverlayRecoveryStatus = () => invoke<OverlayRecoveryStatus>("overlay_recovery_status")
export const discardOverlayRecoveryState = () => invoke<OverlayRecoveryStatus>("discard_overlay_recovery_state")
export const prepareProjectOverlay = (
	rootFolder: string,
	paths: string[],
) => invoke<PrepareProjectOverlayResult>(
	"prepare_project_overlay",
	{ rootFolder, paths },
)
export const previewProjectOverlaySecrets = (
	rootFolder: string,
	paths: string[],
	candidate: OverlayDestinationCandidate,
	expectedSourceFingerprint: string,
	expectedRoutingFingerprint: string,
) => invoke<SecretReviewResult>("preview_project_overlay_secrets", {
	rootFolder,
	paths,
	destinationRelativePath: candidate.destinationRelativePath,
	sourcePrefix: candidate.sourcePrefix,
	expectedSourceFingerprint,
	expectedRoutingFingerprint,
})

export const applyProjectOverlay = (
	rootFolder: string,
	paths: string[],
	candidate: OverlayDestinationCandidate,
	expectedSourceFingerprint: string,
	expectedRoutingFingerprint: string,
	appendUndo: boolean,
	undoHistoryLimit: number,
	approvedSecretPaths: string[] = [],
	expectedSecretReviewFingerprint: string | null = null,
) => invoke<ApplyProjectOverlayResult>("apply_project_overlay", {
	rootFolder,
	paths,
	destinationRelativePath: candidate.destinationRelativePath,
	sourcePrefix: candidate.sourcePrefix,
	expectedSourceFingerprint,
	expectedRoutingFingerprint,
	appendUndo,
	undoHistoryLimit,
	approvedSecretPaths,
	expectedSecretReviewFingerprint,
})
export const getProjectOverlayUndoHistory = (
	rootFolder: string,
	undoHistoryLimit: number,
) => invoke<OverlayUndoHistoryEntry[]>(
	"project_overlay_undo_history",
	{ rootFolder, undoHistoryLimit },
)
export const getProjectAppliedSourceHistoryMatch = (
	rootFolder: string,
	sourceFingerprint: string,
	undoHistoryLimit: number,
) => invoke<AppliedSourceHistoryMatch>(
	"project_overlay_source_history_match",
	{ rootFolder, sourceFingerprint, undoHistoryLimit },
)
export const undoProjectOverlay = (
	rootFolder: string,
	steps: number,
) => invoke<UndoProjectOverlayResult>(
	"undo_project_overlay",
	{ rootFolder, steps },
)
export async function discardProjectOverlayUndo(rootFolder: string): Promise<void> {
	await invoke(
		"discard_project_overlay_undo",
		{ rootFolder },
	)
}

export interface PermanentDeleteResult {
	deletedFiles: number
	deletedDirectories: number
	deletedBytes: number
}

export const deleteProjectGeneratedDirectoriesPermanently = (
	rootFolder: string,
	relativePaths: readonly string[],
) => invoke<PermanentDeleteResult>("delete_project_generated_directories_permanently", {
	rootFolder,
	relativePaths,
	confirmed: true,
})
