import { styles } from "./style"
import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "@/features/context/contextPathFilter"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Input } from "@/shared/components/Input"
import {
	ChevronDown,
	ChevronUp,
	FileCode2,
	X,
} from "lucide-react"
import {
	type Ref,
	useId,
	useState,
} from "react"

export interface DropZoneProps {
	addEnabled: boolean
	removeEnabled: boolean
	isAddDragging: boolean
	isRemoveDragging: boolean
	isProcessing: boolean
	locale: Locale
	filterPattern: string
	filterTarget: ContextFilterTarget
	filterMode: ContextFilterMode
	filterError: string | null
	filterHistory: readonly ContextFilterHistoryEntry[]
	pathsOnly: boolean
	detailsExpanded: boolean
	addElementRef?: Ref<HTMLElement>
	removeElementRef?: Ref<HTMLElement>
	onFilterPatternChange: (value: string) => void
	onFilterTargetChange: (value: ContextFilterTarget) => void
	onFilterModeChange: (value: ContextFilterMode) => void
	onFilterClear: () => void
	onFilterHistorySelect: (entry: ContextFilterHistoryEntry) => void
	onFilterHistoryDelete: (entry: ContextFilterHistoryEntry) => void
	onPathsOnlyChange: (value: boolean) => void
	onDetailsExpandedChange: (expanded: boolean) => void
}

interface FilterButtonProps<TValue extends string> {
	value: TValue
	selectedValue: TValue
	label: string
	disabled: boolean
	onChange: (value: TValue) => void
}

function FilterButton<TValue extends string>({
	value,
	selectedValue,
	label,
	disabled,
	onChange,
}: FilterButtonProps<TValue>) {
	return (
		<button
			type="button"
			className={styles.filterButton({
				selected: value === selectedValue,
			})}
			disabled={disabled}
			onClick={() => onChange(value)}
		>
			{label}
		</button>
	)
}

export function DropZone({
	addEnabled,
	removeEnabled,
	isAddDragging,
	isRemoveDragging,
	isProcessing,
	locale,
	filterPattern,
	filterTarget,
	filterMode,
	filterError,
	filterHistory,
	pathsOnly,
	detailsExpanded,
	addElementRef,
	removeElementRef,
	onFilterPatternChange,
	onFilterTargetChange,
	onFilterModeChange,
	onFilterClear,
	onFilterHistorySelect,
	onFilterHistoryDelete,
	onPathsOnlyChange,
	onDetailsExpandedChange,
}: DropZoneProps) {
	const [historyOpen, setHistoryOpen] = useState(false)
	const detailsId = useId()
	const sectionName = translate(
		locale,
		"context.create.title",
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
				<div className={styles.collapseInner({ expanded: detailsExpanded })}>
					<header className={styles.header}>
						<div className={styles.headerIcon}>
							<FileCode2
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
									"context.create.description",
								)}
							</p>
						</div>
					</header>

					<div className={styles.filterPanel}>
						<div className={styles.filterRow}>
							<span className={styles.filterLabel}>
								{translate(
									locale,
									"context.filter.target.label",
								)}
							</span>
							<div className={styles.filterButtons}>
								<FilterButton
									value="fileName"
									selectedValue={filterTarget}
									label={translate(
										locale,
										"context.filter.target.fileName",
									)}
									disabled={isProcessing}
									onChange={onFilterTargetChange}
								/>
								<FilterButton
									value="path"
									selectedValue={filterTarget}
									label={translate(
										locale,
										"context.filter.target.path",
									)}
									disabled={isProcessing}
									onChange={onFilterTargetChange}
								/>
							</div>
						</div>

						<div className={styles.filterRow}>
							<span className={styles.filterLabel}>
								{translate(
									locale,
									"context.filter.mode.label",
								)}
							</span>
							<div className={styles.filterButtons}>
								<FilterButton
									value="contains"
									selectedValue={filterMode}
									label={translate(
										locale,
										"context.filter.mode.contains",
									)}
									disabled={isProcessing}
									onChange={onFilterModeChange}
								/>
								<FilterButton
									value="exact"
									selectedValue={filterMode}
									label={translate(
										locale,
										"context.filter.mode.exact",
									)}
									disabled={isProcessing}
									onChange={onFilterModeChange}
								/>
								<FilterButton
									value="regex"
									selectedValue={filterMode}
									label={translate(
										locale,
										"context.filter.mode.regex",
									)}
									disabled={isProcessing}
									onChange={onFilterModeChange}
								/>
							</div>
						</div>

						<div className={styles.filterRow}>
							<span className={styles.filterLabel}>
								{translate(
									locale,
									"context.pathsOnly.label",
								)}
							</span>
							<button
								type="button"
								aria-pressed={pathsOnly}
								className={styles.filterButton({
									selected: pathsOnly,
								})}
								disabled={isProcessing}
								onClick={() => onPathsOnlyChange(!pathsOnly)}
							>
								{translate(
									locale,
									"context.pathsOnly.button",
								)}
							</button>
						</div>

						<div className={styles.filterInputRow}>
							<div className={styles.filterInputContainer}>
								<Input
									id={`${detailsId}-filter`}
									label={translate(
										locale,
										"context.filter.label",
									)}
									value={filterPattern}
									placeholder={translate(
										locale,
										"context.filter.placeholder",
									)}
									error={filterError ?? undefined}
									disabled={isProcessing}
									onFocus={() => setHistoryOpen(true)}
									onBlur={() => setHistoryOpen(false)}
									onChange={event => onFilterPatternChange(event.currentTarget.value)}
								/>

								{historyOpen && filterHistory.length > 0 && (
									<div className={styles.history}>
										<div className={styles.historyTitle}>
											{translate(
												locale,
												"context.filter.recent",
											)}
										</div>

										{filterHistory.map(entry => (
											<div
												key={`${entry.target}:${entry.mode}:${entry.pattern}`}
												className={styles.historyItem}
												onMouseDown={(event: { preventDefault: () => void }) => event.preventDefault()}
											>
												<button
													type="button"
													className={styles.historyValue}
													onClick={() => {
														onFilterHistorySelect(entry)
														setHistoryOpen(false)
													}}
												>
													<span className={styles.historyPattern}>
														{entry.pattern}
													</span>
													<span className={styles.historyMeta}>
														{translate(
															locale,
															entry.target === "fileName" ?
																"context.filter.target.fileName" :
																"context.filter.target.path",
														)} · {translate(
															locale,
															`context.filter.mode.${entry.mode}`,
														)}
													</span>
												</button>

												<button
													type="button"
													aria-label={translate(
														locale,
														"context.filter.deleteRecent",
													)}
													className={styles.historyDelete}
													onClick={() => onFilterHistoryDelete(entry)}
												>
													<X
														size={12}
														strokeWidth={2}
														aria-hidden="true"
													/>
												</button>
											</div>
										))}
									</div>
								)}
							</div>

							<Button
								variant="secondary"
								className={styles.clearButton}
								disabled={isProcessing || filterPattern.length === 0}
								onClick={onFilterClear}
							>
								{translate(
									locale,
									"context.filter.clear",
								)}
							</Button>
						</div>
					</div>
				</div>
			</div>

			<div className={styles.zones}>
				<section
					ref={addElementRef}
					aria-label={translate(
						locale,
						"context.drop.aria",
					)}
					className={styles.zone({
						enabled: addEnabled,
						isDragging: isAddDragging,
						variant: "add",
					})}
				>
					<div className={styles.icon({ variant: "add" })}>
						{isProcessing ?
							"…" :
							"+"}
					</div>

					<h3 className={styles.title}>
						{translate(
							locale,
							"context.drop.compact",
						)}
					</h3>
				</section>

				<section
					ref={removeElementRef}
					aria-label={translate(
						locale,
						"context.remove.aria",
					)}
					className={styles.zone({
						enabled: removeEnabled,
						isDragging: isRemoveDragging,
						variant: "remove",
					})}
				>
					<div className={styles.icon({ variant: "remove" })}>
						−
					</div>

					<h3 className={styles.title}>
						{translate(
							locale,
							"context.remove.compact",
						)}
					</h3>
				</section>
			</div>
		</section>
	)
}
