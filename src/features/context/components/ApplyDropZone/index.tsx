import type {
	OverlayUndoHistoryEntry,
	WorkMode,
} from "../../types"
import { styles } from "./style"
import { getUndoHistoryLabel } from "./undoHistory"
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
				dateStyle: "short",
				timeStyle: "short",
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
