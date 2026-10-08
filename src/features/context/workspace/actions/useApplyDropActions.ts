import type { WorkspaceState } from "../useWorkspaceState"
import { applyFilesDrop } from "./applyDropFiles"
import { prepareGitDrop } from "./applyDropGit"
import type { useOverlayBatchActions } from "./useOverlayBatchActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { cleanupNativeDrop } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useWorkspaceHistoryActions> &
	ReturnType<typeof useWorkspaceMaterializationActions> &
	ReturnType<typeof useOverlayBatchActions>

export function useApplyDropActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const {
		isOperationRunningRef,
		locale,
		rootFolderRef,
		setNotice,
		workMode,
	} = state

	const applyDroppedPaths = useCallback(async (
		paths: string[],
		nativeDropRoot: string | null = null,
	) => {
		if (isOperationRunningRef.current) {
			if (nativeDropRoot !== null)
				await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
			setNotice({
				kind: "info",
				message: translate(
					locale,
					"workspace.applyBusy",
				),
			})
			return
		}
		const configuredRootFolder = rootFolderRef.current
		if (configuredRootFolder === null) {
			if (nativeDropRoot !== null)
				await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
			setNotice({
				kind: "warning",
				message: translate(
					locale,
					"workspace.selectRootForApply",
				),
			})
			return
		}
		const uniquePaths = [...new Set(paths)]
		if (uniquePaths.length === 0) {
			if (nativeDropRoot !== null)
				await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)
			return
		}
		if (workMode === "git") {
			await prepareGitDrop(
				state,
				deps,
				configuredRootFolder,
				uniquePaths,
				nativeDropRoot,
			)
			return
		}
		await applyFilesDrop(
			state,
			deps,
			configuredRootFolder,
			uniquePaths,
			nativeDropRoot,
		)
	}, [deps, isOperationRunningRef, locale, rootFolderRef, setNotice, state, workMode])

	return { applyDroppedPaths }
}
