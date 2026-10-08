import type { OperationUndoReference } from "../../operationOutcome"
import type {
	ContextMode,
	FolderAction,
	GitPatchPreview,
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
	ProjectSection,
} from "../../types"
import type {
	ContextWorkspacePreferences,
	PreparedApplyOutcome,
} from "../../useContextWorkspace"

export interface ProjectWorkspaceHandle {
	addExternalContext: (paths: string[]) => Promise<void>
	addExternalContextAndCopy: (paths: string[]) => Promise<void>
	removeExternalContext: (paths: string[]) => Promise<void>
	addExternalIgnore: (paths: string[]) => Promise<void>
	removeExternalIgnore: (paths: string[]) => Promise<void>
	openExternalRoot: (path: string) => Promise<boolean>
	prepareForTabClose: () => Promise<boolean>
	canAcceptRoutedApply: () => boolean
	applyPreparedOverlay: (
		paths: string[],
		candidate: OverlayDestinationCandidate,
		sourceFingerprint: string,
		routingFingerprint: string,
		appendUndo: boolean,
	) => Promise<PreparedApplyOutcome>
	beginPreparedOverlayResolution: (
		paths: string[],
		sourceLabel: string,
		plan: PrepareProjectOverlayResult,
		appendUndo: boolean,
	) => Promise<PreparedApplyOutcome>
	beginPreparedGitPatch: (
		patchPath: string,
		preview: GitPatchPreview,
	) => Promise<PreparedApplyOutcome>
	undoApplicationIfLatest: (reference: OperationUndoReference) => Promise<boolean>
	cancelContextOperation: () => void
}

export interface ProjectWorkspacePaneProps {
	tabId: string
	active: boolean
	interactionBlocked: boolean
	routingBusy: boolean
	routingDecisionPending: boolean
	vscodeAvailable: boolean
	initialRootFolder: string | null
	folderSectionExpanded: boolean
	folderAction: FolderAction
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
	ignoreDialogOpen: boolean
	folderPickerReferenceRoot: string | null
	preferences: ContextWorkspacePreferences
	onRootFolderChange: (rootFolder: string | null) => Promise<boolean>
	onFolderActionChange: (action: FolderAction) => void
	onSectionExpandedChange: (
		section: ProjectSection,
		expanded: boolean,
	) => void
	onContextModeChange: (
		tabId: string,
		mode: ContextMode,
	) => void
	onBusyStateChange: (
		tabId: string,
		busy: boolean,
	) => void
	onRegister: (
		tabId: string,
		handle: ProjectWorkspaceHandle | null,
	) => void
	onIgnoreDialogOpenChange: (open: boolean) => void
	onApplyDrop: (
		tabId: string,
		paths: string[],
		temporaryRoot: string | null,
	) => void
}
