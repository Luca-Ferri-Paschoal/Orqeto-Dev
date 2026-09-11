import type { OverlayUndoHistoryEntry } from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import {
	ChevronDown,
	ChevronUp,
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
	isDragging: boolean
	isApplying: boolean
	undoHistory: OverlayUndoHistoryEntry[]
	locale: Locale
	detailsExpanded: boolean
	elementRef?: Ref<HTMLElement>
	onDetailsExpandedChange: (expanded: boolean) => void
	onUndo: (steps: number) => void
}

export function ApplyDropZone({
	enabled,
	isDragging,
	isApplying,
	undoHistory,
	locale,
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

	function handleUndoSelection(event: ChangeEvent<HTMLSelectElement>): void {
		const steps = Number(event.target.value)

		if (Number.isInteger(steps) && steps >= 1)
			setSelectedUndoSteps(steps)
	}

	return (
		<section className={styles.container}>
			<button
				type="button"
				aria-controls={detailsId}
				aria-expanded={detailsExpanded}
				aria-label={toggleLabel}
				title={toggleLabel}
				className={styles.toggleButton}
				onClick={() => onDetailsExpandedChange(!detailsExpanded)}
			>
				{detailsExpanded ?
					(
						<ChevronUp
							size={15}
							strokeWidth={2}
							aria-hidden="true"
						/>
					) :
					(
						<ChevronDown
							size={15}
							strokeWidth={2}
							aria-hidden="true"
						/>
					)}
			</button>

			<div
				id={detailsId}
				aria-hidden={!detailsExpanded}
				inert={!detailsExpanded}
				className={styles.collapseRegion({
					expanded: detailsExpanded,
				})}
			>
				<div className={styles.collapseInner}>
					<header className={styles.header}>
						<div className={styles.headerIcon}>
							<FolderInput
								size={15}
								strokeWidth={2}
								aria-hidden="true"
							/>
						</div>

						<div>
							<h2 className={styles.sectionTitle}>
								{sectionName}
							</h2>
							<p className={styles.sectionDescription}>
								{translate(
									locale,
									"apply.section.description",
								)}
							</p>
						</div>
					</header>
				</div>
			</div>

			<section
				ref={elementRef}
				aria-label={translate(
					locale,
					"apply.drop.aria",
				)}
				className={styles.zone({
					enabled,
					isDragging,
				})}
			>
				<div className={styles.icon}>
					{isApplying ?
						"…" :
						(
							<FolderInput
								size={15}
								strokeWidth={2}
								aria-hidden="true"
							/>
						)}
				</div>

				<h3 className={styles.title}>
					{translate(
						locale,
						"apply.drop.compact",
					)}
				</h3>
			</section>

			<div
				aria-hidden={!detailsExpanded}
				inert={!detailsExpanded}
				className={styles.collapseRegion({
					expanded: detailsExpanded,
				})}
			>
				<div className={styles.undoCollapseInner}>
					<div className={styles.undoControls}>
						<select
							aria-label={translate(
								locale,
								"apply.undo.historyAria",
							)}
							className={styles.undoHistory}
							disabled={!canUndo || isApplying || !enabled}
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
										{translate(
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
										)}
									</option>
								))}
						</select>

						<Button
							variant="secondary"
							className={styles.undoButton}
							disabled={!canUndo || isApplying || !enabled}
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
				</div>
			</div>
		</section>
	)
}
