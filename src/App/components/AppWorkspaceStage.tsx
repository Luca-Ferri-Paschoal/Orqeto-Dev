import type { AppController } from "../controllers/useAppController"
import { styles } from "../style"
import { AppRecoveryNotice } from "./AppRecoveryNotice"
import { ProjectWorkspacePane } from "@/features/context/components/ProjectWorkspacePane"
import { Notice } from "@/shared/components/Notice"

export function AppWorkspaceStage({ controller }: { controller: AppController }) {
	const { appSettings, preferences, state } = controller
	const displayedNotice = state.globalNotice ?? appSettings.notice
	return (
		<div className={styles.workspaceStage}>
			{state.recoveryBlocked && (
				<AppRecoveryNotice
					locale={appSettings.locale}
					busy={state.isDiscardingRecovery}
					onDiscard={controller.discardBlockedRecovery}
				/>
			)}
			{displayedNotice && (
				<Notice
					kind={displayedNotice.kind}
					message={displayedNotice.message}
					details={displayedNotice.details}
				/>
			)}
			{state.tabs.map(tab => (
				<ProjectWorkspacePane
					key={tab.id}
					tabId={tab.id}
					active={tab.id === state.activeTabId}
					interactionBlocked={state.isSettingsOpen}
					routingBusy={state.routingApplyTabId === tab.id}
					routingDecisionPending={false}
					vscodeAvailable={state.vscodeAvailable}
					initialRootFolder={tab.rootFolder}
					folderSectionExpanded={appSettings.folderSectionExpanded}
					folderAction={appSettings.folderAction}
					contextSectionExpanded={appSettings.contextSectionExpanded}
					applySectionExpanded={appSettings.applySectionExpanded}
					ignoreDialogOpen={state.ignoreDialogTabId === tab.id}
					folderPickerReferenceRoot={state.lastRootFolder}
					preferences={preferences}
					onRootFolderChange={rootFolder => controller.handleRootFolderChange(
						tab.id,
						rootFolder,
					)}
					onFolderActionChange={action => void appSettings.updateFolderAction(action)}
					onSectionExpandedChange={(
						section,
						expanded,
					) => void controller.handleSectionExpandedChange(
						section,
						expanded,
					)}
					onContextModeChange={controller.updateWorkspaceContextMode}
					onBusyStateChange={controller.updateWorkspaceBusyState}
					onRegister={controller.registerWorkspace}
					onIgnoreDialogOpenChange={open => controller.updateIgnoreDialogState(
						tab.id,
						open,
					)}
					onApplyDrop={(sourceTabId, paths, temporaryRoot) => void controller.routeApplyDrop(
						sourceTabId,
						paths,
						temporaryRoot,
					)}
				/>
			))}
		</div>
	)
}
