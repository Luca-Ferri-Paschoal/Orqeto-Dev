import type { ContextMode } from "../../../types"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import type { ProjectWorkspaceHandle } from "../types"
import { translate } from "@/infra/i18n"
import type {
	Dispatch,
	MutableRefObject,
	SetStateAction,
} from "react"
import { useEffect } from "react"

interface UseWorkspaceRegistrationOptions {
	tabId: string
	onRegister: (
		tabId: string,
		handle: ProjectWorkspaceHandle | null,
	) => void
	workspaceRef: MutableRefObject<ContextWorkspace>
	contextModeRef: MutableRefObject<ContextMode>
	setRequestedContextMode: Dispatch<SetStateAction<ContextMode>>
	ignoreDialogOpenRef: MutableRefObject<boolean>
	isUpdatingProjectIgnoreRef: MutableRefObject<boolean>
	updateIgnorePathsRef: MutableRefObject<(
		paths: string[],
		ignorePaths: boolean,
		externalAction?: boolean,
	) => Promise<void>>
}

export function useWorkspaceRegistration({
	tabId,
	onRegister,
	workspaceRef,
	contextModeRef,
	setRequestedContextMode,
	ignoreDialogOpenRef,
	isUpdatingProjectIgnoreRef,
	updateIgnorePathsRef,
}: UseWorkspaceRegistrationOptions): void {
	useEffect(() => {
		onRegister(tabId, {
			addExternalContext: async paths => {
				if (ignoreDialogOpenRef.current) {
					throw new Error(translate(
						workspaceRef.current.locale,
						"workspace.externalContextUnavailableInIgnore",
					))
				}
				contextModeRef.current = "create"
				setRequestedContextMode("create")
				await workspaceRef.current.addDroppedPaths(
					paths,
					false,
					true,
				)
			},
			addExternalContextAndCopy: async paths => {
				if (ignoreDialogOpenRef.current) {
					throw new Error(translate(
						workspaceRef.current.locale,
						"workspace.externalContextCopyUnavailableInIgnore",
					))
				}
				contextModeRef.current = "create"
				setRequestedContextMode("create")
				await workspaceRef.current.addDroppedPaths(
					paths,
					true,
					true,
				)
			},
			removeExternalContext: async paths => {
				if (ignoreDialogOpenRef.current) {
					throw new Error(translate(
						workspaceRef.current.locale,
						"workspace.externalContextUnavailableInIgnore",
					))
				}
				contextModeRef.current = "create"
				setRequestedContextMode("create")
				await workspaceRef.current.removeDroppedPaths(
					paths,
					true,
				)
			},
			addExternalIgnore: paths => updateIgnorePathsRef.current(
				paths,
				true,
				true,
			),
			removeExternalIgnore: paths => updateIgnorePathsRef.current(
				paths,
				false,
				true,
			),
			openExternalRoot: path => {
				if (isUpdatingProjectIgnoreRef.current)
					return Promise.resolve(false)
				const currentWorkspace = workspaceRef.current
				return currentWorkspace.configureRootFolder(
					path,
					translate(
						currentWorkspace.locale,
						"workspace.openedExternally",
					),
				)
			},
			prepareForTabClose: async () => {
				if (isUpdatingProjectIgnoreRef.current)
					return false
				return workspaceRef.current.prepareForTabClose()
			},
			canAcceptRoutedApply: () => {
				const currentWorkspace = workspaceRef.current
				return currentWorkspace.rootFolder !== null &&
					!ignoreDialogOpenRef.current &&
					!isUpdatingProjectIgnoreRef.current &&
					currentWorkspace.isReady &&
					!currentWorkspace.isProcessing &&
					!currentWorkspace.isApplying &&
					!currentWorkspace.isGeneratingCommitContext &&
					!currentWorkspace.isGeneratingProjectContext &&
					currentWorkspace.diagnosticContextKind === null &&
					currentWorkspace.pendingOverlay === null &&
					currentWorkspace.pendingGitPatch === null
			},
			applyPreparedOverlay: (...args) => workspaceRef.current.applyPreparedOverlay(...args),
			beginPreparedOverlayResolution: (...args) => workspaceRef.current.beginPreparedOverlayResolution(...args),
			beginPreparedGitPatch: (...args) => workspaceRef.current.beginPreparedGitPatch(...args),
			undoApplicationIfLatest: reference => workspaceRef.current.undoApplicationIfLatest(reference),
			cancelContextOperation: () => workspaceRef.current.cancelCancellableContextOperation(),
		})

		return () => {
			onRegister(
				tabId,
				null,
			)
		}
	}, [
		contextModeRef,
		ignoreDialogOpenRef,
		isUpdatingProjectIgnoreRef,
		onRegister,
		setRequestedContextMode,
		tabId,
		updateIgnorePathsRef,
		workspaceRef,
	])
}
