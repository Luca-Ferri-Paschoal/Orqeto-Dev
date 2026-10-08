import type {
	ContextMode,
	FolderAction,
} from "../../../types"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import { CommitContextSection } from "../../CommitContextSection"
import { ContextHistoryPanel } from "../../ContextHistoryPanel"
import {
	type ContextSectionMode,
	FolderSettings,
} from "../../FolderSettings"
import { ProjectLogsPanel } from "../../ProjectLogsPanel"
import { styles } from "../style"
import { ProjectModeContent } from "./ProjectModeContent"
import { ValidationModeContent } from "./ValidationModeContent"
import type { RefObject } from "react"

interface WorkspaceFolderSectionProps {
	workspace: ContextWorkspace
	contextMode: ContextMode
	projectScope: "full" | "custom"
	validationMode: ContextMode
	lintFixAvailable: boolean
	testAvailable: boolean
	logsAvailable: boolean
	folderAction: FolderAction
	folderSectionExpanded: boolean
	contextSectionExpanded: boolean
	vscodeAvailable: boolean
	projectIgnoreFileExists: boolean | null
	interactionDisabled: boolean
	active: boolean
	contextAddDropZoneRef: RefObject<HTMLElement | null>
	contextRemoveDropZoneRef: RefObject<HTMLElement | null>
	contextAddDropEnabled: boolean
	contextRemoveDropEnabled: boolean
	visibleDragTarget: string | null
	isProcessing: boolean
	metadata: string | null
	busy: boolean
	generated: boolean
	hasGenerateStep: boolean
	onFolderActionChange: (action: FolderAction) => void
	onFolderExpandedChange: (expanded: boolean) => void
	onContextModeChange: (mode: ContextSectionMode) => void
	onProjectScopeChange: (mode: ContextMode) => void
	onDevIgnore: () => void
	onGenerate: () => void
	onGenerateDiagnostic: (mode: "typecheck" | "eslint") => void
	onLintFix: () => void
	onTest: () => void
	onCopy: () => void
	onDownload: () => void
	requestConfirmation: (request: { title: string; message: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>
}

export function WorkspaceFolderSection({
	workspace,
	contextMode,
	projectScope,
	validationMode,
	lintFixAvailable,
	testAvailable,
	logsAvailable,
	folderAction,
	folderSectionExpanded,
	contextSectionExpanded,
	vscodeAvailable,
	projectIgnoreFileExists,
	interactionDisabled,
	active,
	contextAddDropZoneRef,
	contextRemoveDropZoneRef,
	contextAddDropEnabled,
	contextRemoveDropEnabled,
	visibleDragTarget,
	isProcessing,
	metadata,
	busy,
	generated,
	onFolderActionChange,
	onFolderExpandedChange,
	onContextModeChange,
	onProjectScopeChange,
	onDevIgnore,
	onGenerate,
	onGenerateDiagnostic,
	onLintFix,
	onTest,
	onCopy,
	onDownload,
	requestConfirmation,
}: WorkspaceFolderSectionProps) {
	return (
		<section className={styles.workspaceCard}>
			<FolderSettings
				rootFolder={workspace.rootFolder}
				locale={workspace.locale}
				disabled={interactionDisabled}
				isGitRepository={workspace.isGitRepository}
				hasTypecheckContext={workspace.diagnosticCapabilities.typecheck}
				hasLintFixAction={lintFixAvailable}
				hasEslintContext={workspace.diagnosticCapabilities.eslint}
				hasTestAction={testAvailable}
				hasProjectLogs={logsAvailable}
				contextMode={contextMode}
				projectIgnoreExists={projectIgnoreFileExists}
				vscodeAvailable={vscodeAvailable}
				expanded={folderSectionExpanded}
				selectedAction={folderAction}
				headerAccessory={workspace.rootFolder === null ?
					undefined :
					(
						<ContextHistoryPanel
							history={workspace.contextHistory}
							locale={workspace.locale}
							disabled={interactionDisabled}
							placement="header"
							onCopy={entry => void workspace.copyContextHistory(entry)}
							onDownload={entry => void workspace.downloadContextHistory(entry)}
							onDelete={entry => void workspace.deleteContextHistory(entry)}
						/>
					)}
				onSelectedActionChange={onFolderActionChange}
				onExpandedChange={onFolderExpandedChange}
				onContextModeChange={onContextModeChange}
				onSelectFolder={() => void workspace.selectRootFolder()}
				onOpenFolder={() => void workspace.openConfiguredFolder()}
				onOpenVscode={() => void workspace.openConfiguredFolderInVscode()}
				onCloseFolder={() => void workspace.closeRootFolder()}
				onDevIgnore={onDevIgnore}
			>
				{workspace.rootFolder !== null && (contextMode === "create" || contextMode === "project") && (
					<ProjectModeContent
						workspace={workspace}
						contextMode={contextMode}
						projectScope={projectScope}
						contextSectionExpanded={contextSectionExpanded}
						showFilters={folderSectionExpanded}
						contextAddDropZoneRef={contextAddDropZoneRef}
						contextRemoveDropZoneRef={contextRemoveDropZoneRef}
						contextAddDropEnabled={contextAddDropEnabled}
						contextRemoveDropEnabled={contextRemoveDropEnabled}
						visibleDragTarget={visibleDragTarget}
						isProcessing={isProcessing}
						interactionDisabled={interactionDisabled}
						metadata={metadata}
						busy={busy}
						generated={generated}
						setRequestedContextMode={onProjectScopeChange}
						onGenerate={onGenerate}
						onCopy={onCopy}
						onDownload={onDownload}
					/>
				)}
				{workspace.rootFolder !== null && contextMode === "commit" && (
					<CommitContextSection
						key={workspace.rootFolder}
						workspace={workspace}
						rootFolder={workspace.rootFolder}
						active={active}
						disabled={interactionDisabled}
						metadata={metadata}
						busy={busy}
						generated={generated}
						onGenerate={onGenerate}
						onCopy={onCopy}
						onDownload={onDownload}
					/>
				)}
				{workspace.rootFolder !== null && ["typecheck", "lintfix", "eslint", "test"].includes(contextMode) && (
					<ValidationModeContent
						workspace={workspace}
						validationMode={validationMode}
						lintFixAvailable={lintFixAvailable}
						testAvailable={testAvailable}
						interactionDisabled={interactionDisabled}
						metadata={metadata}
						busy={busy}
						generated={generated}
						onGenerateDiagnostic={onGenerateDiagnostic}
						onLintFix={onLintFix}
						onTest={onTest}
						onCopy={onCopy}
						onDownload={onDownload}
					/>
				)}
				{active && workspace.rootFolder !== null && contextMode === "logs" && workspace.diagnosticCapabilities.developmentLogCommand !== null && (
					<ProjectLogsPanel
						rootFolder={workspace.rootFolder}
						locale={workspace.locale}
						command={workspace.diagnosticCapabilities.developmentLogCommand}
						clearAfterCopy={workspace.clearLogsAfterCopy}
						disabled={interactionDisabled}
						active={active}
						requestConfirmation={requestConfirmation}
						onError={message => workspace.publishNotice({ kind: "error", message })}
					/>
				)}
			</FolderSettings>
		</section>
	)
}
