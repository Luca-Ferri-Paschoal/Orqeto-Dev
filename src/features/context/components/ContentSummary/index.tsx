import { formatByteSize } from "../../formatGeneratedContent"
import type {
	ContextHistoryEntry,
	ContextSelectionFile,
} from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import {
	ChevronDown,
	ChevronUp,
	Copy,
	Download,
	Trash2,
} from "lucide-react"
import {
	useId,
	useMemo,
	useState,
} from "react"

export interface ContentSummaryProps {
	files: readonly ContextSelectionFile[]
	contentSize: string | null
	liveContent: boolean
	history: readonly ContextHistoryEntry[]
	locale: Locale
	disabled?: boolean
	onCopy: () => void
	onDownload: () => void
	onClear: () => void
	onHistoryCopy: (entry: ContextHistoryEntry) => void
	onHistoryDownload: (entry: ContextHistoryEntry) => void
	onHistoryDelete: (entry: ContextHistoryEntry) => void
}

export function ContentSummary({
	files,
	contentSize,
	liveContent,
	history,
	locale,
	disabled = false,
	onCopy,
	onDownload,
	onClear,
	onHistoryCopy,
	onHistoryDownload,
	onHistoryDelete,
}: ContentSummaryProps) {
	const [historyExpanded, setHistoryExpanded] = useState(false)
	const historyId = useId()
	const hasContent = files.length > 0
	const description = !hasContent ?
		translate(
			locale,
			"context.summary.none",
		) :
		liveContent ?
			translateCount(
				locale,
				files.length,
				"context.summary.live.one",
				"context.summary.live.other",
			) :
			translateCount(
				locale,
				files.length,
				"context.summary.one",
				"context.summary.other",
				{
					size: contentSize ?? "—",
				},
			)
	const dateFormatter = useMemo(
		() => new Intl.DateTimeFormat(
			locale,
			{
				dateStyle: "short",
				timeStyle: "short",
			},
		),
		[locale],
	)

	return (
		<section className={styles.container}>
			<div className={styles.topRow}>
				<div className={styles.summary}>
					<h2 className={styles.title}>
						{translate(
							locale,
							"context.summary.title",
						)}
					</h2>
					<p className={styles.description}>
						{description}
					</p>
				</div>

				<div className={styles.actions}>
					<Button
						className={styles.copyButton}
						variant="secondary"
						disabled={disabled || !hasContent}
						onClick={onCopy}
					>
						{translate(
							locale,
							"context.summary.copy",
						)}
					</Button>

					<Button
						className={styles.downloadButton}
						disabled={disabled || !hasContent}
						onClick={onDownload}
					>
						{translate(
							locale,
							"context.summary.download",
						)}
					</Button>

					<Button
						className={styles.clearButton}
						variant="danger"
						disabled={disabled || !hasContent}
						onClick={onClear}
					>
						{translate(
							locale,
							"context.summary.clear",
						)}
					</Button>

					<button
						type="button"
						className={styles.historyToggle}
						aria-expanded={historyExpanded}
						aria-controls={historyId}
						disabled={disabled || history.length === 0}
						onClick={() => setHistoryExpanded(value => !value)}
					>
						<span>
							{translate(
								locale,
								"context.history.toggle",
							)}
							{history.length > 0 && ` (${history.length})`}
						</span>
						{historyExpanded ?
							<ChevronUp
								size={13}
								aria-hidden="true"
							/> :
							<ChevronDown
								size={13}
								aria-hidden="true"
							/>}
					</button>
				</div>
			</div>

			<div
				id={historyId}
				aria-hidden={!historyExpanded}
				inert={!historyExpanded}
				className={styles.historyRegion({
					expanded: historyExpanded,
				})}
			>
				<div className={styles.historyRegionInner}>
					<div className={styles.historyList}>
						{history.length === 0 ?
							<p className={styles.historyEmpty}>
								{translate(
									locale,
									"context.history.empty",
								)}
							</p> :
							history.map(entry => (
								<div
									key={entry.id}
									className={styles.historyItem}
								>
									<div className={styles.historyInfo}>
										<span className={styles.historyDate}>
											{dateFormatter.format(entry.createdAt)}
										</span>
										<span className={styles.historyMeta}>
											{translateCount(
												locale,
												entry.fileCount,
												"context.history.one",
												"context.history.other",
												{
													size: formatByteSize(entry.byteCount),
												},
											)}
										</span>
									</div>

									<div className={styles.historyActions}>
										<button
											type="button"
											className={styles.historyAction}
											aria-label={translate(
												locale,
												"context.history.copy",
											)}
											title={translate(
												locale,
												"context.history.copy",
											)}
											disabled={disabled}
											onClick={() => onHistoryCopy(entry)}
										>
											<Copy
												size={13}
												aria-hidden="true"
											/>
										</button>

										<button
											type="button"
											className={styles.historyAction}
											aria-label={translate(
												locale,
												"context.history.download",
											)}
											title={translate(
												locale,
												"context.history.download",
											)}
											disabled={disabled}
											onClick={() => onHistoryDownload(entry)}
										>
											<Download
												size={13}
												aria-hidden="true"
											/>
										</button>

										<button
											type="button"
											className={styles.historyDelete}
											aria-label={translate(
												locale,
												"context.history.delete",
											)}
											title={translate(
												locale,
												"context.history.delete",
											)}
											disabled={disabled}
											onClick={() => onHistoryDelete(entry)}
										>
											<Trash2
												size={13}
												aria-hidden="true"
											/>
										</button>
									</div>
								</div>
							))}
					</div>
				</div>
			</div>
		</section>
	)
}
