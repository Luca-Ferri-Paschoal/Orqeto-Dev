import type { ContextSelectionFile } from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"

export interface ContentSummaryProps {
	files: readonly ContextSelectionFile[]
	contentSize: string | null
	liveContent: boolean
	locale: Locale
	disabled?: boolean
	onCopy: () => void
	onDownload: () => void
	onClear: () => void
}

export function ContentSummary({
	files,
	contentSize,
	liveContent,
	locale,
	disabled = false,
	onCopy,
	onDownload,
	onClear,
}: ContentSummaryProps) {
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
						className={styles.actionButton}
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
						className={styles.actionButton}
						disabled={disabled || !hasContent}
						onClick={onDownload}
					>
						{translate(
							locale,
							"context.summary.download",
						)}
					</Button>

					<Button
						className={styles.actionButton}
						variant="danger"
						disabled={disabled || !hasContent}
						onClick={onClear}
					>
						{translate(
							locale,
							"context.summary.clear",
						)}
					</Button>
				</div>
			</div>
		</section>
	)
}
