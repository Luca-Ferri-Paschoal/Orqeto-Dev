import { formatByteSize } from "../../formatGeneratedContent"
import type { ContextHistoryEntry } from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import {
	ChevronDown,
	ChevronUp,
	Copy,
	Download,
	Trash2,
} from "lucide-react"
import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react"

export type ContextHistoryPlacement = "section" | "header"

export interface ContextHistoryPanelProps {
	history: readonly ContextHistoryEntry[]
	locale: Locale
	disabled?: boolean
	placement?: ContextHistoryPlacement
	onCopy: (entry: ContextHistoryEntry) => void
	onDownload: (entry: ContextHistoryEntry) => void
	onDelete: (entry: ContextHistoryEntry) => void
}

function historyKindLabel(
	entry: ContextHistoryEntry,
	locale: Locale,
): string {
	const key = (() => {
		switch (entry.kind) {
			case "project":
				return "context.history.kind.project"
			case "commit":
				return "context.history.kind.commit"
			case "typecheck":
				return "context.history.kind.typecheck"
			case "lintfix":
				return "context.history.kind.lintfix"
			case "eslint":
				return "context.history.kind.eslint"
			case "test":
				return "context.history.kind.test"
			default:
				return "context.history.kind.custom"
		}
	})()

	return translate(
		locale,
		key,
	)
}

export function ContextHistoryPanel({
	history,
	locale,
	disabled = false,
	placement = "section",
	onCopy,
	onDownload,
	onDelete,
}: ContextHistoryPanelProps) {
	const [expanded, setExpanded] = useState(false)
	const historyId = useId()
	const containerRef = useRef<HTMLDivElement>(null)
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

	const isExpanded = expanded && history.length > 0

	useEffect(
		() => {
			if (!isExpanded || placement !== "header")
				return

			function handlePointerDown(event: PointerEvent): void {
				const target = event.target

				if (target instanceof Node && !containerRef.current?.contains(target))
					setExpanded(false)
			}

			function handleKeyDown(event: KeyboardEvent): void {
				if (event.key === "Escape")
					setExpanded(false)
			}

			document.addEventListener(
				"pointerdown",
				handlePointerDown,
			)
			document.addEventListener(
				"keydown",
				handleKeyDown,
			)

			return () => {
				document.removeEventListener(
					"pointerdown",
					handlePointerDown,
				)
				document.removeEventListener(
					"keydown",
					handleKeyDown,
				)
			}
		},
		[
			isExpanded,
			placement,
		],
	)

	return (
		<div
			ref={containerRef}
			className={styles.container({ placement })}
		>
			<button
				type="button"
				className={styles.toggle({ placement })}
				aria-expanded={isExpanded}
				aria-controls={historyId}
				disabled={disabled || history.length === 0}
				onClick={() => setExpanded(value => !value)}
			>
				<span>
					{translate(
						locale,
						"context.history.toggle",
					)}
					{history.length > 0 && ` (${history.length})`}
				</span>
				{isExpanded ?
					<ChevronUp
						size={13}
						aria-hidden="true"
					/> :
					<ChevronDown
						size={13}
						aria-hidden="true"
					/>}
			</button>

			<div
				id={historyId}
				aria-hidden={!isExpanded}
				inert={!isExpanded}
				className={styles.region({
					expanded: isExpanded,
					placement,
				})}
			>
				<div className={styles.regionInner}>
					<div className={styles.list({ placement })}>
						{history.length === 0 ?
							<p className={styles.empty}>
								{translate(
									locale,
									"context.history.empty",
								)}
							</p> :
							history.map(entry => (
								<div
									key={entry.id}
									className={styles.item}
								>
									<div className={styles.info}>
										<span className={styles.date}>
											{dateFormatter.format(entry.createdAt)}
										</span>
										<span className={styles.meta}>
											{historyKindLabel(
												entry,
												locale,
											)}
											{" · "}
											{entry.fileCount > 0 ?
												translateCount(
													locale,
													entry.fileCount,
													"context.history.one",
													"context.history.other",
													{
														size: formatByteSize(entry.byteCount),
													},
												) :
												formatByteSize(entry.byteCount)}
										</span>
									</div>

									<div className={styles.actions}>
										<button
											type="button"
											className={styles.action}
											aria-label={translate(
												locale,
												"context.history.copy",
											)}
											title={translate(
												locale,
												"context.history.copy",
											)}
											disabled={disabled}
											onClick={() => onCopy(entry)}
										>
											<Copy
												size={13}
												aria-hidden="true"
											/>
										</button>

										<button
											type="button"
											className={styles.action}
											aria-label={translate(
												locale,
												"context.history.download",
											)}
											title={translate(
												locale,
												"context.history.download",
											)}
											disabled={disabled}
											onClick={() => onDownload(entry)}
										>
											<Download
												size={13}
												aria-hidden="true"
											/>
										</button>

										<button
											type="button"
											className={styles.deleteAction}
											aria-label={translate(
												locale,
												"context.history.delete",
											)}
											title={translate(
												locale,
												"context.history.delete",
											)}
											disabled={disabled}
											onClick={() => {
												if (history.length === 1)
													setExpanded(false)

												onDelete(entry)
											}}
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
		</div>
	)
}
