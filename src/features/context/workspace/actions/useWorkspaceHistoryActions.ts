import { getGeneratedContentByteCount } from "../../formatGeneratedContent"
import type {
	ContextHistoryKind,
	OverlayUndoHistoryEntry,
	ProjectValidationCommandKind,
} from "../../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { getErrorMessage } from "@/features/context/utils"
import {
	getContextFilterHistory,
	getContextHistory,
	saveContextHistoryEntry,
} from "@/infra/configDatabase"
import {
	cleanupNativeDrop,
	getProjectOverlayUndoHistory,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import {
	useCallback,
	useEffect,
} from "react"

export function useWorkspaceHistoryActions(state: WorkspaceState) {
	const { autoCopyGeneratedReports, activeNativeDropRootRef, contextFilterHistoryLimit, contextHistoryLimit, deferredWorkModeCleanupRef, handledWorkModeRef, hasAppliedCurrentOverlayBatchRef, isOperationRunningRef, locale, operationRevision, overlayUndoHistoryLimit, pendingOverlayQueueIndexRef, pendingOverlayQueueRef, rootFolderRef, rootRevisionRef, routedGitPatchResolutionRef, routedOverlayResolutionRef, setContextFilterHistory, setContextHistory, setNotice, setOverlayUndoHistory, setPendingGitPatch, setPendingOverlay, setPreparedValidationCommandContexts, workMode } = state

	const loadFilterHistory = useCallback(
		async (path: string | null): Promise<void> => {
			const revision = rootRevisionRef.current

			if (path === null) {
				if (rootFolderRef.current === null)
					setContextFilterHistory([])
				return
			}

			const entries = await getContextFilterHistory(
				path,
				contextFilterHistoryLimit,
			)
			if (rootFolderRef.current === path && rootRevisionRef.current === revision)
				setContextFilterHistory(entries)
		},
		[contextFilterHistoryLimit, rootFolderRef, rootRevisionRef, setContextFilterHistory],
	)

	const loadContextHistory = useCallback(
		async (path: string | null): Promise<void> => {
			const revision = rootRevisionRef.current

			if (path === null) {
				if (rootFolderRef.current === null)
					setContextHistory([])
				return
			}

			const entries = await getContextHistory(
				path,
				contextHistoryLimit,
			)
			if (rootFolderRef.current === path && rootRevisionRef.current === revision)
				setContextHistory(entries)
		},
		[contextHistoryLimit, rootFolderRef, rootRevisionRef, setContextHistory],
	)

	const cleanupActiveNativeDrop = useCallback(
		async (): Promise<void> => {
			const path = activeNativeDropRootRef.current

			if (path === null)
				return

			activeNativeDropRootRef.current = null
			await cleanupNativeDrop(path).catch(() => undefined)
		},
		[activeNativeDropRootRef],
	)

	useEffect(
		() => {
			const workModeChanged = handledWorkModeRef.current !== workMode

			if (!workModeChanged && !deferredWorkModeCleanupRef.current)
				return

			if (isOperationRunningRef.current) {
				deferredWorkModeCleanupRef.current = true
				return
			}

			handledWorkModeRef.current = workMode
			deferredWorkModeCleanupRef.current = false
			routedOverlayResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedOverlayResolutionRef.current = null
			routedGitPatchResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedGitPatchResolutionRef.current = null
			pendingOverlayQueueRef.current = []
			pendingOverlayQueueIndexRef.current = 0
			hasAppliedCurrentOverlayBatchRef.current = false
			setPendingOverlay(null)
			setPendingGitPatch(null)
			void cleanupActiveNativeDrop()
		},
		[
			activeNativeDropRootRef,
			cleanupActiveNativeDrop,
			deferredWorkModeCleanupRef,
			handledWorkModeRef,
			hasAppliedCurrentOverlayBatchRef,
			isOperationRunningRef,
			operationRevision,
			pendingOverlayQueueIndexRef,
			pendingOverlayQueueRef,
			routedGitPatchResolutionRef,
			routedOverlayResolutionRef,
			setPendingGitPatch,
			setPendingOverlay,
			workMode,
		],
	)

	const refreshOverlayUndoHistory = useCallback(
		async (): Promise<OverlayUndoHistoryEntry[]> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				setOverlayUndoHistory([])
				return []
			}

			const revision = rootRevisionRef.current
			const entries = await getProjectOverlayUndoHistory(
				configuredRootFolder,
				overlayUndoHistoryLimit,
			)

			if (
				rootFolderRef.current === configuredRootFolder &&
				rootRevisionRef.current === revision
			)
				setOverlayUndoHistory(entries)
			return entries
		},
		[overlayUndoHistoryLimit, rootFolderRef, rootRevisionRef, setOverlayUndoHistory],
	)

	const archiveContextSnapshot = useCallback(
		async (
			content: string,
			fileCount: number,
			kind: ContextHistoryKind = "custom",
		): Promise<boolean> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null || content.length === 0)
				return true

			try {
				const revision = rootRevisionRef.current
				const entries = await saveContextHistoryEntry(
					configuredRootFolder,
					{
						kind,
						content,
						fileCount,
						byteCount: getGeneratedContentByteCount(content),
						createdAt: Date.now(),
					},
					contextHistoryLimit,
				)
				if (
					rootFolderRef.current === configuredRootFolder &&
					rootRevisionRef.current === revision
				)
					setContextHistory(entries)
				return true
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistorySaveFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
				return false
			}
		},
		[
			contextHistoryLimit,
			locale,
			rootFolderRef,
			rootRevisionRef,
			setContextHistory,
			setNotice,
		],
	)

	const publishValidationCommandContext = useCallback(
		async (
			kind: ProjectValidationCommandKind,
			content: string,
		): Promise<{
			autoCopied: boolean
			autoCopyErrorMessage: string | null
		} | null> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return null

			setPreparedValidationCommandContexts(current => ({
				...current,
				[kind]: {
					rootFolder: configuredRootFolder,
					locale,
					kind,
					content,
					byteCount: getGeneratedContentByteCount(content),
				},
			}))

			if (!await archiveContextSnapshot(
				content,
				0,
				kind,
			))
				return null

			if (!autoCopyGeneratedReports) {
				return {
					autoCopied: false,
					autoCopyErrorMessage: null,
				}
			}

			try {
				await writeText(content)
				return {
					autoCopied: true,
					autoCopyErrorMessage: null,
				}
			} catch (error) {
				return {
					autoCopied: false,
					autoCopyErrorMessage: getErrorMessage(
						error,
						locale,
					),
				}
			}
		},
		[
			archiveContextSnapshot,
			autoCopyGeneratedReports,
			locale,
			rootFolderRef,
			setPreparedValidationCommandContexts,
		],
	)

	return {
		loadFilterHistory,
		loadContextHistory,
		cleanupActiveNativeDrop,
		refreshOverlayUndoHistory,
		archiveContextSnapshot,
		publishValidationCommandContext,
	}
}
