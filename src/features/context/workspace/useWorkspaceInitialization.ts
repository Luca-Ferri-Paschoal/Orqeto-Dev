import type { UseContextWorkspaceOptions } from "./types"
import type { WorkspaceState } from "./useWorkspaceState"
import { getErrorMessage } from "@/features/context/utils"
import {
	folderExists,
	getOverlayRecoveryStatus,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useEffect } from "react"

type InitializationActions = {
	loadContextHistory: (path: string | null) => Promise<void>
	loadFilterHistory: (path: string | null) => Promise<void>
	refreshOverlayUndoHistory: () => Promise<unknown>
	updateRootFolderState: (value: string | null) => void
}

export function useWorkspaceInitialization(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
	actions: InitializationActions,
): void {
	const {
		locale,
		rootFolderRef,
		setIsReady,
		setNotice,
	} = state
	const { onRootFolderChange } = options
	const {
		loadContextHistory,
		loadFilterHistory,
		refreshOverlayUndoHistory,
		updateRootFolderState,
	} = actions

	useEffect(() => {
		let cancelled = false

		async function initialize(): Promise<void> {
			try {
				const root = rootFolderRef.current
				if (root !== null && !await folderExists(root)) {
					await onRootFolderChange(null)
					updateRootFolderState(null)
					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.savedRootMissing",
						),
					})
				}
				if (cancelled)
					return
				await loadFilterHistory(rootFolderRef.current)
				await loadContextHistory(rootFolderRef.current)
				// Undo history is restored on the backend worker. Wait asynchronously so
				// we never display an empty/incomplete history during startup.
				await getOverlayRecoveryStatus()
				if (cancelled)
					return
				await refreshOverlayUndoHistory()
			} catch (error) {
				if (!cancelled) {
					setNotice({
						kind: "error",
						message: getErrorMessage(
							error,
							locale,
						),
					})
				}
			} finally {
				if (!cancelled)
					setIsReady(true)
			}
		}

		void initialize()
		return () => {
			cancelled = true
		}
	}, [
		loadContextHistory,
		loadFilterHistory,
		locale,
		onRootFolderChange,
		refreshOverlayUndoHistory,
		rootFolderRef,
		setIsReady,
		setNotice,
		updateRootFolderState,
	])
}
