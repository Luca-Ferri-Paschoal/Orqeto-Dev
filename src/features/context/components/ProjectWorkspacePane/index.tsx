import { ApplyDropZone } from "../ApplyDropZone"
import { useNativeWorkspaceDrop } from "./hooks/useNativeWorkspaceDrop"
import { useProjectIgnoreController } from "./hooks/useProjectIgnoreController"
import { useProjectWorkspaceMode } from "./hooks/useProjectWorkspaceMode"
import { useWorkspaceConfirmation } from "./hooks/useWorkspaceConfirmation"
import { useWorkspaceContextActions } from "./hooks/useWorkspaceContextActions"
import { useWorkspaceInteractionState } from "./hooks/useWorkspaceInteractionState"
import { useWorkspaceRegistration } from "./hooks/useWorkspaceRegistration"
import { WorkspaceFolderSection } from "./sections/WorkspaceFolderSection"
import { WorkspaceOverlays } from "./sections/WorkspaceOverlays"
import { styles } from "./style"
import type { ProjectWorkspacePaneProps } from "./types"
import { translate } from "@/infra/i18n"
import { LoadingOverlay } from "@/shared/components/LoadingOverlay"
import { Notice } from "@/shared/components/Notice"
import {
	useCallback,
	useRef,
} from "react"

export type { ProjectWorkspaceHandle } from "./types"

export function ProjectWorkspacePane(props: ProjectWorkspacePaneProps) {
	const {
		tabId,
		active,
		interactionBlocked,
		routingBusy,
		routingDecisionPending,
		ignoreDialogOpen,
		vscodeAvailable,
		initialRootFolder,
		folderSectionExpanded,
		folderAction,
		contextSectionExpanded,
		applySectionExpanded,
		folderPickerReferenceRoot,
		preferences,
		onRootFolderChange,
		onFolderActionChange,
		onSectionExpandedChange,
		onContextModeChange,
		onBusyStateChange,
		onRegister,
		onIgnoreDialogOpenChange,
		onApplyDrop,
	} = props
	const confirmation = useWorkspaceConfirmation()
	const {
		workspace,
		workspaceRef,
		contextMode,
		contextModeRef,
		setRequestedContextMode,
		lintFixAvailable,
		testAvailable,
		logsAvailable,
	} = useProjectWorkspaceMode({
		tabId,
		active,
		initialRootFolder,
		folderPickerReferenceRoot,
		preferences,
		onRootFolderChange,
		onContextModeChange,
		requestConfirmation: confirmation.requestConfirmation,
	})
	const {
		addDropZoneRef: ignoreAddDropZoneRef,
		dialogOpenRef: ignoreDialogOpenRef,
		fileExists: projectIgnoreFileExists,
		handleDevIgnore,
		isUpdating: isUpdatingProjectIgnore,
		isUpdatingRef: isUpdatingProjectIgnoreRef,
		removeDropZoneRef: ignoreRemoveDropZoneRef,
		updateIgnorePaths,
		updateIgnorePathsRef,
	} = useProjectIgnoreController({
		active,
		ignoreDialogOpen,
		onIgnoreDialogOpenChange,
		workspace,
		workspaceRef,
	})
	const interaction = useWorkspaceInteractionState({
		tabId,
		workspace,
		interactionBlocked,
		routingBusy,
		ignoreDialogOpen,
		isUpdatingProjectIgnore,
		hasConfirmation: confirmation.pendingConfirmation !== null,
		onBusyStateChange,
	})

	useWorkspaceRegistration({
		tabId,
		onRegister,
		workspaceRef,
		contextModeRef,
		setRequestedContextMode,
		ignoreDialogOpenRef,
		isUpdatingProjectIgnoreRef,
		updateIgnorePathsRef,
	})

	const contextAddDropZoneRef = useRef<HTMLElement | null>(null)
	const contextRemoveDropZoneRef = useRef<HTMLElement | null>(null)
	const applyDropZoneRef = useRef<HTMLElement | null>(null)
	const contextDropEnabled = contextMode === "create" && interaction.contextDropEnabled
	const onApply = useCallback((paths: string[], temporaryRoot: string | null) => {
		onApplyDrop(
			tabId,
			paths,
			temporaryRoot,
		)
	}, [onApplyDrop, tabId])
	const visibleDragTarget = useNativeWorkspaceDrop({
		active,
		interactionBlocked,
		routingBusy,
		ignoreDialogOpen,
		isUpdatingProjectIgnore,
		pendingDecision: workspace.pendingOverlay !== null || workspace.pendingGitPatch !== null,
		contextAddEnabled: contextDropEnabled,
		contextRemoveEnabled: contextDropEnabled,
		applyEnabled: interaction.applyDropEnabled,
		contextAddRef: contextAddDropZoneRef,
		contextRemoveRef: contextRemoveDropZoneRef,
		applyRef: applyDropZoneRef,
		ignoreAddRef: ignoreAddDropZoneRef,
		ignoreRemoveRef: ignoreRemoveDropZoneRef,
		onContextAdd: workspace.addDroppedPaths,
		onContextRemove: workspace.removeDroppedPaths,
		onIgnoreUpdate: updateIgnorePaths,
		onApply,
	})
	const actions = useWorkspaceContextActions(
		workspace,
		contextMode,
		lintFixAvailable,
		{
			isGeneratingCommitContext: interaction.isGeneratingCommitContext,
			isGeneratingProjectContext: interaction.isGeneratingProjectContext,
			isInspectingProjectContext: interaction.isInspectingProjectContext,
			diagnosticContextKind: interaction.diagnosticContextKind,
		},
		setRequestedContextMode,
	)
	const interactionDisabled = interaction.isInteractionBusy || routingBusy || interactionBlocked
	const suppressLoadingOverlay = routingDecisionPending ||
		confirmation.pendingConfirmation !== null ||
		workspace.pendingOverlay !== null ||
		workspace.pendingGitPatch !== null

	return (
		<div
			hidden={!active}
			className={styles.root}
			aria-busy={interaction.isTabBusy}
		>
			<div
				inert={interaction.isTabBusy}
				className={styles.content}
			>
				{workspace.notice && (
					<Notice
						kind={workspace.notice.kind}
						message={workspace.notice.message}
						details={workspace.notice.details}
					/>
				)}
				<WorkspaceFolderSection
					workspace={workspace}
					contextMode={contextMode}
					projectScope={actions.projectScope}
					validationMode={actions.validationMode}
					lintFixAvailable={lintFixAvailable}
					testAvailable={testAvailable}
					logsAvailable={logsAvailable}
					folderAction={folderAction}
					folderSectionExpanded={folderSectionExpanded}
					contextSectionExpanded={contextSectionExpanded}
					vscodeAvailable={vscodeAvailable}
					projectIgnoreFileExists={projectIgnoreFileExists}
					interactionDisabled={interactionDisabled}
					active={active}
					contextAddDropZoneRef={contextAddDropZoneRef}
					contextRemoveDropZoneRef={contextRemoveDropZoneRef}
					contextAddDropEnabled={contextDropEnabled}
					contextRemoveDropEnabled={contextDropEnabled}
					visibleDragTarget={visibleDragTarget}
					isProcessing={interaction.isProcessing}
					metadata={actions.metadata}
					busy={actions.busy}
					generated={actions.generated}
					hasGenerateStep={actions.hasGenerateStep}
					onFolderActionChange={onFolderActionChange}
					onFolderExpandedChange={expanded => onSectionExpandedChange(
						"folder",
						expanded,
					)}
					onContextModeChange={actions.changeMode}
					onProjectScopeChange={setRequestedContextMode}
					onDevIgnore={() => void handleDevIgnore()}
					onGenerate={actions.generate}
					onGenerateDiagnostic={actions.generateDiagnostic}
					onLintFix={actions.runLintFix}
					onTest={actions.runTests}
					onCopy={actions.copy}
					onDownload={actions.download}
					requestConfirmation={confirmation.requestConfirmation}
				/>
				<ApplyDropZone
					elementRef={applyDropZoneRef}
					enabled={interaction.applyDropEnabled}
					undoEnabled={interaction.undoEnabled}
					isDragging={visibleDragTarget === "apply"}
					isApplying={workspace.isApplying}
					undoHistory={workspace.pendingOverlay === null && workspace.pendingGitPatch === null ?
						workspace.overlayUndoHistory :
						[]}
					locale={workspace.locale}
					workMode={workspace.workMode}
					detailsExpanded={applySectionExpanded}
					onDetailsExpandedChange={expanded => onSectionExpandedChange(
						"apply",
						expanded,
					)}
					onUndo={steps => void workspace.undoOverlay(steps)}
				/>
			</div>
			<WorkspaceOverlays
				active={active}
				workspace={workspace}
				ignoreDialogOpen={ignoreDialogOpen}
				isUpdatingProjectIgnore={isUpdatingProjectIgnore}
				ignoreAddRef={ignoreAddDropZoneRef}
				ignoreRemoveRef={ignoreRemoveDropZoneRef}
				visibleDragTarget={visibleDragTarget}
				pendingConfirmation={confirmation.pendingConfirmation}
				onIgnoreDialogOpenChange={onIgnoreDialogOpenChange}
				onSettleConfirmation={confirmation.settleConfirmation}
			/>
			{!suppressLoadingOverlay && (
				<LoadingOverlay
					active={interaction.isTabBusy}
					scope="container"
					label={translate(
						workspace.locale,
						"app.loading",
					)}
					cancelLabel={translate(
						workspace.locale,
						"app.loading.cancel",
					)}
					onCancel={interaction.canCancelTabOperation ?
						workspace.cancelCancellableContextOperation :
						undefined}
				/>
			)}
		</div>
	)
}
