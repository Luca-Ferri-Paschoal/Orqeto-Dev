import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { getErrorMessage } from "@/features/context/utils"
import { stopProjectLogSession } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions>

export function useTabCloseActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { isGeneratingCommitContextRef, isOperationRunningRef, locale, pendingGitPatch, pendingOverlay, rootFolderRef, setNotice } = state
	const { cleanupActiveNativeDrop } = deps

	const prepareForTabClose = useCallback(
		async (): Promise<boolean> => {
			if (
				isOperationRunningRef.current ||
				isGeneratingCommitContextRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.tabBusy",
					),
				})
				return false
			}

			try {
				if (rootFolderRef.current !== null)
					await stopProjectLogSession(rootFolderRef.current)
				await cleanupActiveNativeDrop()
				return true
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
				return false
			}
		},
		[
			cleanupActiveNativeDrop,
			locale,
			pendingGitPatch,
			pendingOverlay,
			rootFolderRef,
			isGeneratingCommitContextRef,
			isOperationRunningRef,
			setNotice,
		],
	)

	return {
		prepareForTabClose,
	}
}
