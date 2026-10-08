import type { ContextMode } from "../../../types"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import { ContentSummary } from "../../ContentSummary"
import { ContextExportActions } from "../../ContextExportActions"
import { DropZone } from "../../DropZone"
import { styles } from "../style"
import { translate } from "@/infra/i18n"
import type { RefObject } from "react"

interface ProjectModeContentProps {
	workspace: ContextWorkspace
	contextMode: ContextMode
	projectScope: "full" | "custom"
	contextSectionExpanded: boolean
	showFilters: boolean
	contextAddDropZoneRef: RefObject<HTMLElement | null>
	contextRemoveDropZoneRef: RefObject<HTMLElement | null>
	contextAddDropEnabled: boolean
	contextRemoveDropEnabled: boolean
	visibleDragTarget: string | null
	isProcessing: boolean
	interactionDisabled: boolean
	metadata: string | null
	busy: boolean
	generated: boolean
	setRequestedContextMode: (mode: ContextMode) => void
	onGenerate: () => void
	onCopy: () => void
	onDownload: () => void
}

export function ProjectModeContent({
	workspace,
	contextMode,
	projectScope,
	contextSectionExpanded,
	showFilters,
	contextAddDropZoneRef,
	contextRemoveDropZoneRef,
	contextAddDropEnabled,
	contextRemoveDropEnabled,
	visibleDragTarget,
	isProcessing,
	interactionDisabled,
	metadata,
	busy,
	generated,
	setRequestedContextMode,
	onGenerate,
	onCopy,
	onDownload,
}: ProjectModeContentProps) {
	return (
		<div className={styles.modeDetails}>
			<div className={styles.secondaryModeRow}>
				<span className={styles.secondaryModeLabel}>
					{translate(
						workspace.locale,
						"folder.projectScope.label",
					)}
				</span>
				<div
					className={styles.secondaryModeButtons}
					role="group"
					aria-label={translate(
						workspace.locale,
						"folder.projectScope.label",
					)}
				>
					<button
						type="button"
						aria-pressed={projectScope === "full"}
						className={styles.secondaryModeButton({ selected: projectScope === "full" })}
						disabled={interactionDisabled}
						onClick={() => setRequestedContextMode("project")}
					>
						{translate(
							workspace.locale,
							"folder.projectScope.full",
						)}
					</button>
					<button
						type="button"
						aria-pressed={projectScope === "custom"}
						className={styles.secondaryModeButton({ selected: projectScope === "custom" })}
						disabled={interactionDisabled}
						onClick={() => setRequestedContextMode("create")}
					>
						{translate(
							workspace.locale,
							"folder.projectScope.custom",
						)}
					</button>
				</div>
			</div>

			<DropZone
				addElementRef={contextAddDropZoneRef}
				removeElementRef={contextRemoveDropZoneRef}
				addEnabled={contextAddDropEnabled}
				removeEnabled={contextRemoveDropEnabled}
				isAddDragging={visibleDragTarget === "contextAdd"}
				isRemoveDragging={visibleDragTarget === "contextRemove"}
				isProcessing={isProcessing}
				locale={workspace.locale}
				filterPattern={workspace.contextPathFilter}
				filterTarget={workspace.contextFilterTarget}
				filterMode={workspace.contextFilterMode}
				filterError={workspace.contextPathFilterError}
				filterHistory={workspace.contextFilterHistory}
				pathsOnly={workspace.pathsOnly}
				detailsExpanded={contextSectionExpanded}
				embedded
				showDropTargets={contextMode === "create"}
				showFilters={showFilters}
				onFilterPatternChange={workspace.updateContextPathFilter}
				onFilterTargetChange={workspace.updateContextFilterTarget}
				onFilterModeChange={workspace.updateContextFilterMode}
				onFilterClear={workspace.clearContextFilter}
				onPathsOnlyChange={workspace.updatePathsOnly}
				onFilterHistorySelect={workspace.selectContextFilterHistory}
				onFilterHistoryDelete={entry => void workspace.deleteContextFilterHistory(entry)}
				onDetailsExpandedChange={() => undefined}
			/>

			{contextMode === "create" ?
				<ContentSummary
					files={workspace.files}
					contentSize={workspace.generatedContentSize}
					liveContent={!workspace.pathsOnly}
					locale={workspace.locale}
					disabled={interactionDisabled}
					onCopy={() => void workspace.copyGeneratedContent()}
					onDownload={() => void workspace.downloadGeneratedContent()}
					onClear={() => void workspace.clearGeneratedContent()}
				/> :
				<ContextExportActions
					locale={workspace.locale}
					metadata={metadata}
					busy={busy}
					disabled={interactionDisabled || workspace.contextPathFilterError !== null}
					generated={generated}
					generateAction="scan"
					onGenerate={onGenerate}
					onCopy={onCopy}
					onDownload={onDownload}
				/>}
		</div>
	)
}
