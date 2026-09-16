import type {
	OverlayUndoHistoryEntry,
	WorkMode,
} from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { CollapseToggle } from "@/shared/components/CollapseToggle"
import { CollapsibleRegion } from "@/shared/components/CollapsibleRegion"
import {
	FileDiff,
	FolderInput,
	Undo2,
} from "lucide-react"
import {
	type ChangeEvent,
	type Ref,
	useId,
	useMemo,
	useState,
} from "react"

interface ApplyDropZoneProps {
	enabled: boolean
	undoEnabled: boolean
	isDragging: boolean
	isApplying: boolean
	undoHistory: OverlayUndoHistoryEntry[]
	locale: Locale
	workMode: WorkMode
	detailsExpanded: boolean
	elementRef?: Ref<HTMLElement>
	onDetailsExpandedChange: (expanded: boolean) => void
	onUndo: (steps: number) => void
}

function getUndoHistoryLabel(
	entry: OverlayUndoHistoryEntry,
	locale: Locale,
	historyTimeFormatter: Intl.DateTimeFormat,
): string {
	if (entry.sourceKind === "git") {
		return translate(
			locale,
			entry.steps === 1 ?
				"apply.undo.historyGitLatest" :
				"apply.undo.historyGitPrevious",
			{
				steps: entry.steps,
				patch: entry.sourceLabel ?? ".patch",
				added: entry.addedFiles,
				replaced: entry.replacedFiles,
				deleted: entry.deletedFiles,
				addedLines: entry.addedLines ?? 0,
				deletedLines: entry.deletedLines ?? 0,
				time: historyTimeFormatter.format(entry.appliedAtUnixMs),
			},
		)
	}

	return translate(
		locale,
		entry.steps === 1 ?
			"apply.undo.historyLatest" :
			"apply.undo.historyPrevious",
		{
			steps: entry.steps,
			added: entry.addedFiles,
			replaced: entry.replacedFiles,
			deleted: entry.deletedFiles,
			time: historyTimeFormatter.format(entry.appliedAtUnixMs),
		},
	)
}

export function ApplyDropZone({
	enabled,
	undoEnabled,
	isDragging,
	isApplying,
	undoHistory,
	locale,
	workMode,
	detailsExpanded,
	elementRef,
	onDetailsExpandedChange,
	onUndo,
}: ApplyDropZoneProps) {
	const [selectedUndoSteps, setSelectedUndoSteps] = useState(1)
	const detailsId = useId()
	const historyTimeFormatter = useMemo(
		() => new Intl.DateTimeFormat(
			locale,
			{
				hour: "2-digit",
				minute: "2-digit",
			},
		),
		[locale],
	)
	const sectionName = translate(
		locale,
		"apply.section.title",
	)
	const toggleLabel = translate(
		locale,
		detailsExpanded ?
			"section.collapse" :
			"section.expand",
		{
			section: sectionName,
		},
	)
	const canUndo = undoHistory.length > 0
	const effectiveUndoSteps = canUndo ?
		Math.min(
			selectedUndoSteps,
			undoHistory.length,
		) :
		1
	const isGitMode = workMode === "git"
	const modeLabel = translate(
		locale,
		isGitMode ?
			"apply.mode.git" :
			"apply.mode.files",
	)
	const sectionDescription = translate(
		locale,
		isGitMode ?
			"apply.section.description.git" :
			"apply.section.description.files",
	)
	const dropLabel = translate(
		locale,
		isGitMode ?
			"apply.drop.gitCompact" :
			"apply.drop.compact",
	)

	function handleUndoSelection(event: ChangeEvent<HTMLSelectElement>): void {
		const steps = Number(event.target.value)

		if (Number.isInteger(steps) && steps >= 1)
			setSelectedUndoSteps(steps)
	}

	return (
		<section className={styles.container}>
			<CollapseToggle
				controlsId={detailsId}
				expanded={detailsExpanded}
				label={toggleLabel}
				className={styles.toggleButton}
				onToggle={() => onDetailsExpandedChange(!detailsExpanded)}
			/>

			<CollapsibleRegion
				id={detailsId}
				expanded={detailsExpanded}
				innerClassName={styles.collapseInner}
			>
				<header className={styles.header}>
					<div className={styles.headerIcon}>
						{isGitMode ?
							(
								<FileDiff
									size={15}
									strokeWidth={2}
									aria-hidden="true"
								/>
							) :
							(
								<FolderInput
									size={15}
									strokeWidth={2}
									aria-hidden="true"
								/>
							)}
					</div>

					<div className={styles.headerContent}>
						<div className={styles.titleRow}>
							<h2 className={styles.sectionTitle}>
								{sectionName}
							</h2>
							<span className={styles.modeBadge}>
								{modeLabel}
							</span>
						</div>
						<p className={styles.sectionDescription}>
							{sectionDescription}
						</p>
					</div>
				</header>
			</CollapsibleRegion>

			<section
				ref={elementRef}
				aria-label={translate(
					locale,
					isGitMode ?
						"apply.drop.aria.git" :
						"apply.drop.aria.files",
				)}
				className={styles.zone({
					enabled,
					isDragging,
				})}
			>
				<div className={styles.icon}>
					{isApplying ?
						"…" :
						isGitMode ?
							(
								<FileDiff
									size={15}
									strokeWidth={2}
									aria-hidden="true"
								/>
							) :
							(
								<FolderInput
									size={15}
									strokeWidth={2}
									aria-hidden="true"
								/>
							)}
				</div>

				<h3 className={styles.title}>
					{dropLabel}
				</h3>
			</section>

			<CollapsibleRegion
				id={`${detailsId}-undo`}
				expanded={detailsExpanded}
				innerClassName={styles.undoCollapseInner}
			>
				<div className={styles.undoControls}>
					<select
						aria-label={translate(
							locale,
							"apply.undo.historyAria",
						)}
						className={styles.undoHistory}
						disabled={!canUndo || isApplying || !undoEnabled}
						value={effectiveUndoSteps}
						onChange={handleUndoSelection}
					>
						{undoHistory.length === 0 ?
							(
								<option value={1}>
									{translate(
										locale,
										"apply.undo.empty",
									)}
								</option>
							) :
							undoHistory.map(entry => (
								<option
									key={entry.steps}
									value={entry.steps}
								>
									{getUndoHistoryLabel(
										entry,
										locale,
										historyTimeFormatter,
									)}
								</option>
							))}
					</select>

					<Button
						variant="secondary"
						className={styles.undoButton}
						disabled={!canUndo || isApplying || !undoEnabled}
						onClick={() => onUndo(effectiveUndoSteps)}
					>
						<Undo2
							size={12}
							strokeWidth={2}
							aria-hidden="true"
						/>
						{translate(
							locale,
							"apply.undo",
						)}
					</Button>
				</div>
			</CollapsibleRegion>
		</section>
	)
}
