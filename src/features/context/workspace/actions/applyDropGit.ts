import type { WorkspaceState } from "../useWorkspaceState"
import {
	getErrorMessage,
	isGitPatchPath,
} from "@/features/context/utils"
import {
	cleanupNativeDrop,
	getGitPatchSourceFingerprint,
	getProjectAppliedSourceHistoryMatch,
	prepareGitPatch,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"

type Dependencies = {
	cleanupActiveNativeDrop: () => Promise<void>
	confirmHistoricalReapply: (fingerprint: string) => Promise<"continue" | "cancelled">
	invalidateMissingRootFolder: () => Promise<boolean>
}

export async function prepareGitDrop(
	state: WorkspaceState,
	deps: Dependencies,
	configuredRootFolder: string,
	uniquePaths: string[],
	nativeDropRoot: string | null,
): Promise<void> {
	const {
		activeNativeDropRootRef,
		hasAppliedCurrentOverlayBatchRef,
		isGitRepository,
		isOperationRunningRef,
		locale,
		overlayUndoHistoryLimit,
		pendingOverlayQueueIndexRef,
		pendingOverlayQueueRef,
		setIsApplying,
		setNotice,
		setOperationRevision,
		setPendingGitPatch,
		setPendingOverlay,
	} = state
	if (!isGitRepository) {
		if (nativeDropRoot !== null)
			await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
		setNotice({
			kind: "warning",
			message: translate(
				locale,
				"workspace.gitModeRequiresRepository",
			),
		})
		return
	}
	if (uniquePaths.length !== 1) {
		if (nativeDropRoot !== null)
			await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
		setNotice({
			kind: "warning",
			message: translate(
				locale,
				"workspace.gitModeSinglePatch",
			),
		})
		return
	}
	const patchPath = uniquePaths[0]
	if (patchPath === undefined || !isGitPatchPath(patchPath)) {
		if (nativeDropRoot !== null)
			await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
		setNotice({
			kind: "warning",
			message: translate(
				locale,
				"workspace.gitModePatchOnly",
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
	let previewReady = false

	try {
		if (await deps.invalidateMissingRootFolder())
			return
		const patchFingerprint = await getGitPatchSourceFingerprint(patchPath)
		const historyMatch = await getProjectAppliedSourceHistoryMatch(
			configuredRootFolder,
			patchFingerprint,
			overlayUndoHistoryLimit,
		)
		if (historyMatch.kind === "latest" && historyMatch.currentlyApplied) {
			setNotice({
				kind: "info",
				message: translate(
					locale,
					"workspace.applyAlreadyApplied",
				),
			})
			return
		}
		if (historyMatch.kind === "older") {
			const historicalReapply = await deps.confirmHistoricalReapply(patchFingerprint)
			if (historicalReapply === "cancelled")
				return
		}
		const preview = await prepareGitPatch(
			configuredRootFolder,
			patchPath,
		)
		setPendingGitPatch({ patchPath, ...preview })
		setNotice(null)
		previewReady = true
	} catch (error) {
		setNotice({
			kind: "error",
			message: translate(locale, "workspace.gitPatchValidationFailed", {
				error: getErrorMessage(
					error,
					locale,
				),
			}),
		})
	} finally {
		isOperationRunningRef.current = false
		setOperationRevision(revision => revision + 1)
		setIsApplying(false)
		if (!previewReady)
			void deps.cleanupActiveNativeDrop()
	}
}
