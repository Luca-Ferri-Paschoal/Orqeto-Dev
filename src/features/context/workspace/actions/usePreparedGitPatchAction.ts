import type { GitPatchPreview } from "../../types"
import type { PreparedApplyOutcome } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { getErrorMessage } from "@/features/context/utils"
import { useCallback } from "react"

type Dependencies = {
	confirmHistoricalReapply: (fingerprint: string) => Promise<"continue" | "cancelled">
}

export function usePreparedGitPatchAction(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const {
		isOperationRunningRef,
		locale,
		pendingGitPatch,
		pendingOverlay,
		routedGitPatchResolutionRef,
		setNotice,
		setPendingGitPatch,
		workMode,
	} = state
	const { confirmHistoricalReapply } = deps

	const beginPreparedGitPatch = useCallback(
		async (
			patchPath: string,
			preview: GitPatchPreview,
		): Promise<PreparedApplyOutcome> => {
			if (
				workMode !== "git" ||
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
				const historicalReapply = await confirmHistoricalReapply(preview.patchFingerprint)
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

			routedGitPatchResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			setPendingGitPatch({ patchPath, ...preview })
			setNotice(null)
			return new Promise(resolve => {
				routedGitPatchResolutionRef.current = { resolve }
			})
		},
		[
			confirmHistoricalReapply,
			isOperationRunningRef,
			locale,
			pendingGitPatch,
			pendingOverlay,
			routedGitPatchResolutionRef,
			setNotice,
			setPendingGitPatch,
			workMode,
		],
	)

	return { beginPreparedGitPatch }
}
