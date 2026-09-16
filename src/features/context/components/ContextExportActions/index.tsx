import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"

export interface ContextExportActionsProps {
	locale: Locale
	metadata?: string | null
	busy?: boolean
	disabled?: boolean
	generated?: boolean
	onGenerate?: () => void
	onCopy: () => void
	onDownload: () => void
}

export function ContextExportActions({
	locale,
	metadata = null,
	busy = false,
	disabled = false,
	generated = true,
	onGenerate,
	onCopy,
	onDownload,
}: ContextExportActionsProps) {
	const hasGenerateStep = onGenerate !== undefined
	const exportDisabled = disabled || busy || !generated

	return (
		<section className={styles.container}>
			{metadata !== null && (
				<span className={styles.metadata}>
					{metadata}
				</span>
			)}

			<div className={styles.actions}>
				{onGenerate !== undefined && (
					<Button
						variant="secondary"
						disabled={disabled || busy}
						onClick={onGenerate}
					>
						{translate(
							locale,
							busy ?
								"folder.contextExport.generating" :
								"folder.contextExport.generate",
						)}
					</Button>
				)}

				<Button
					variant="secondary"
					disabled={exportDisabled}
					onClick={onCopy}
				>
					{!hasGenerateStep && busy ?
						translate(
							locale,
							"folder.contextExport.generating",
						) :
						translate(
							locale,
							"context.summary.copy",
						)}
				</Button>

				<Button
					disabled={exportDisabled}
					onClick={onDownload}
				>
					{!hasGenerateStep && busy ?
						translate(
							locale,
							"folder.contextExport.generating",
						) :
						translate(
							locale,
							"context.summary.download",
						)}
				</Button>
			</div>
		</section>
	)
}
