import type { WorkspaceConfirmationRequest } from "../../../useContextWorkspace"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import { DevIgnoreDialog } from "../../DevIgnoreDialog"
import { GitPatchPreviewDialog } from "../../GitPatchPreviewDialog"
import { OverlayDestinationDialog } from "../../OverlayDestinationDialog"
import { WorkspaceConfirmationDialog } from "../../WorkspaceConfirmationDialog"
import type { RefObject } from "react"

interface WorkspaceOverlaysProps {
	active: boolean
	workspace: ContextWorkspace
	ignoreDialogOpen: boolean
	isUpdatingProjectIgnore: boolean
	ignoreAddRef: RefObject<HTMLElement | null>
	ignoreRemoveRef: RefObject<HTMLElement | null>
	visibleDragTarget: string | null
	pendingConfirmation: WorkspaceConfirmationRequest | null
	onIgnoreDialogOpenChange: (open: boolean) => void
	onSettleConfirmation: (approved: boolean) => void
}

export function WorkspaceOverlays({
	active,
	workspace,
	ignoreDialogOpen,
	isUpdatingProjectIgnore,
	ignoreAddRef,
	ignoreRemoveRef,
	visibleDragTarget,
	pendingConfirmation,
	onIgnoreDialogOpenChange,
	onSettleConfirmation,
}: WorkspaceOverlaysProps) {
	return (
		<>
			{active && ignoreDialogOpen && workspace.rootFolder !== null && (
				<DevIgnoreDialog
					addElementRef={ignoreAddRef}
					removeElementRef={ignoreRemoveRef}
					isAddDragging={visibleDragTarget === "ignoreAdd"}
					isRemoveDragging={visibleDragTarget === "ignoreRemove"}
					disabled={isUpdatingProjectIgnore}
					locale={workspace.locale}
					onClose={() => onIgnoreDialogOpenChange(false)}
				/>
			)}
			{active && workspace.pendingGitPatch !== null && (
				<GitPatchPreviewDialog
					key={`${workspace.pendingGitPatch.patchFingerprint}:${workspace.pendingGitPatch.patchName}`}
					pendingPatch={workspace.pendingGitPatch}
					disabled={workspace.isApplying}
					locale={workspace.locale}
					onCancel={workspace.cancelPendingGitPatch}
					onConfirm={() => void workspace.confirmPendingGitPatch()}
				/>
			)}
			{active && workspace.pendingOverlay !== null && (
				<OverlayDestinationDialog
					key={`${workspace.pendingOverlay.queuePosition}:${workspace.pendingOverlay.paths.join("|")}`}
					pendingOverlay={workspace.pendingOverlay}
					disabled={workspace.isApplying}
					locale={workspace.locale}
					onCancel={workspace.cancelPendingOverlay}
					onConfirm={candidate => void workspace.confirmPendingOverlay(candidate)}
				/>
			)}
			{active && pendingConfirmation !== null && (
				<WorkspaceConfirmationDialog
					request={pendingConfirmation}
					onCancel={() => onSettleConfirmation(false)}
					onConfirm={() => onSettleConfirmation(true)}
				/>
			)}
		</>
	)
}
