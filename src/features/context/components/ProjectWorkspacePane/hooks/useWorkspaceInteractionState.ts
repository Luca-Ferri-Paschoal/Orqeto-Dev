import type { ContextWorkspace } from "../../../useContextWorkspace"
import { useEffect } from "react"

interface UseWorkspaceInteractionStateOptions {
	tabId: string
	workspace: ContextWorkspace
	interactionBlocked: boolean
	routingBusy: boolean
	ignoreDialogOpen: boolean
	isUpdatingProjectIgnore: boolean
	hasConfirmation: boolean
	onBusyStateChange: (
		tabId: string,
		busy: boolean,
	) => void
}

export function useWorkspaceInteractionState({
	tabId,
	workspace,
	interactionBlocked,
	routingBusy,
	ignoreDialogOpen,
	isUpdatingProjectIgnore,
	hasConfirmation,
	onBusyStateChange,
}: UseWorkspaceInteractionStateOptions) {
	const cancelled = workspace.cancelledContextOperationKind
	const isProcessing = workspace.isProcessing && cancelled !== "create" && cancelled !== "custom"
	const isGeneratingCommitContext = workspace.isGeneratingCommitContext && cancelled !== "commit"
	const isGeneratingProjectContext = workspace.isGeneratingProjectContext && cancelled !== "project"
	const isInspectingProjectContext = workspace.isInspectingProjectContext && cancelled !== "project"
	const diagnosticContextKind = workspace.diagnosticContextKind === cancelled ?
		null :
		workspace.diagnosticContextKind
	const isGeneratingDerivedContext = isGeneratingCommitContext ||
		isGeneratingProjectContext ||
		isInspectingProjectContext ||
		diagnosticContextKind !== null ||
		workspace.validationCommandKind !== null ||
		workspace.isFixingLint
	const isInteractionBusy = !workspace.isReady ||
		hasConfirmation ||
		isProcessing ||
		workspace.isApplying ||
		isGeneratingDerivedContext ||
		isUpdatingProjectIgnore
	const isTabBusy = isInteractionBusy || routingBusy

	useEffect(() => {
		onBusyStateChange(
			tabId,
			isTabBusy || interactionBlocked,
		)
	}, [interactionBlocked, isTabBusy, onBusyStateChange, tabId])

	const dropBaseEnabled = !interactionBlocked &&
		!routingBusy &&
		!ignoreDialogOpen &&
		workspace.rootFolder !== null &&
		workspace.isReady &&
		!isProcessing &&
		!workspace.isApplying &&
		!isGeneratingDerivedContext
	const decisionFree = workspace.pendingOverlay === null && workspace.pendingGitPatch === null

	return {
		applyDropEnabled: dropBaseEnabled && decisionFree,
		canCancelTabOperation: !routingBusy &&
			!workspace.isCancellableContextOperationCancelled &&
			workspace.cancellableContextOperationKind !== null,
		contextDropEnabled: dropBaseEnabled && workspace.contextPathFilterError === null,
		diagnosticContextKind,
		isGeneratingCommitContext,
		isGeneratingProjectContext,
		isInspectingProjectContext,
		isInteractionBusy,
		isProcessing,
		isTabBusy,
		undoEnabled: dropBaseEnabled && decisionFree,
	}
}
