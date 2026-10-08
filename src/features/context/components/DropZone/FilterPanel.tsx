import { FilterButton } from "./FilterButton"
import { styles } from "./style"
import type { DropZoneProps } from "./types"
import { translate } from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Input } from "@/shared/components/Input"
import { X } from "lucide-react"
import { useState } from "react"

type Props = Pick<DropZoneProps, | "locale" | "filterPattern" | "filterTarget" | "filterMode" | "filterError" | "filterHistory" |
	"pathsOnly" | "isProcessing" | "onFilterPatternChange" | "onFilterTargetChange" | "onFilterModeChange" |
	"onFilterClear" | "onFilterHistorySelect" | "onFilterHistoryDelete" | "onPathsOnlyChange"> & { filterId: string }

export function FilterPanel(props: Props) {
	const [historyOpen, setHistoryOpen] = useState(false)
	return (
		<div className={styles.filterPanel}>
			<div className={styles.filterRow}>
				<span className={styles.filterLabel}>{translate(
					props.locale,
					"context.filter.target.label",
				)}</span>
				<div className={styles.filterButtons}>
					<FilterButton value="fileName" selectedValue={props.filterTarget} label={translate(
						props.locale,
						"context.filter.target.fileName",
					)} disabled={props.isProcessing} onChange={props.onFilterTargetChange} />
					<FilterButton value="path" selectedValue={props.filterTarget} label={translate(
						props.locale,
						"context.filter.target.path",
					)} disabled={props.isProcessing} onChange={props.onFilterTargetChange} />
				</div>
			</div>
			<div className={styles.filterRow}>
				<span className={styles.filterLabel}>{translate(
					props.locale,
					"context.filter.mode.label",
				)}</span>
				<div className={styles.filterButtons}>
					<FilterButton value="contains" selectedValue={props.filterMode} label={translate(
						props.locale,
						"context.filter.mode.contains",
					)} disabled={props.isProcessing} onChange={props.onFilterModeChange} />
					<FilterButton value="exact" selectedValue={props.filterMode} label={translate(
						props.locale,
						"context.filter.mode.exact",
					)} disabled={props.isProcessing} onChange={props.onFilterModeChange} />
					<FilterButton value="regex" selectedValue={props.filterMode} label={translate(
						props.locale,
						"context.filter.mode.regex",
					)} disabled={props.isProcessing} onChange={props.onFilterModeChange} />
				</div>
			</div>
			<div className={styles.filterRow}>
				<span className={styles.filterLabel}>{translate(
					props.locale,
					"context.pathsOnly.label",
				)}</span>
				<button type="button" aria-pressed={props.pathsOnly} className={styles.filterButton({ selected: props.pathsOnly })} disabled={props.isProcessing} onClick={() => props.onPathsOnlyChange(!props.pathsOnly)}>
					{translate(
						props.locale,
						"context.pathsOnly.button",
					)}
				</button>
			</div>
			<div className={styles.filterInputRow}>
				<div className={styles.filterInputContainer}>
					<Input
						id={props.filterId}
						label={translate(
							props.locale,
							"context.filter.label",
						)}
						value={props.filterPattern}
						placeholder={translate(
							props.locale,
							"context.filter.placeholder",
						)}
						error={props.filterError ?? undefined}
						disabled={props.isProcessing}
						onFocus={() => setHistoryOpen(true)}
						onBlur={() => setHistoryOpen(false)}
						onChange={event => props.onFilterPatternChange(event.currentTarget.value)}
					/>
					{historyOpen && props.filterHistory.length > 0 && (
						<div className={styles.history}>
							<div className={styles.historyTitle}>{translate(
								props.locale,
								"context.filter.recent",
							)}</div>
							{props.filterHistory.map(entry => (
								<div key={`${entry.target}:${entry.mode}:${entry.pattern}`} className={styles.historyItem} onMouseDown={event => event.preventDefault()}>
									<button type="button" className={styles.historyValue} onClick={() => { props.onFilterHistorySelect(entry); setHistoryOpen(false) }}>
										<span className={styles.historyPattern}>{entry.pattern}</span>
										<span className={styles.historyMeta}>{translate(
											props.locale,
											entry.target === "fileName" ?
												"context.filter.target.fileName" :
												"context.filter.target.path",
										)} · {translate(
											props.locale,
											`context.filter.mode.${entry.mode}`,
										)}</span>
									</button>
									<button type="button" aria-label={translate(
										props.locale,
										"context.filter.deleteRecent",
									)} className={styles.historyDelete} onClick={() => props.onFilterHistoryDelete(entry)}><X size={12} strokeWidth={2} aria-hidden="true" /></button>
								</div>
							))}
						</div>
					)}
				</div>
				<Button variant="secondary" className={styles.clearButton} disabled={props.isProcessing || props.filterPattern.length === 0} onClick={props.onFilterClear}>{translate(
					props.locale,
					"context.filter.clear",
				)}</Button>
			</div>
		</div>
	)
}
