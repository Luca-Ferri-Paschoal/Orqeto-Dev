import { styles } from "./style"
import { CollapsibleRegion } from "@/shared/components/CollapsibleRegion"
import { cn } from "@/shared/utils/cn"
import { ChevronDown } from "lucide-react"
import type { PropsWithChildren } from "react"

export type CollapsiblePanelProps = PropsWithChildren<{
	id: string
	label: string
	open: boolean
	className?: string
	onToggle: () => void
}>

export function CollapsiblePanel({
	id,
	label,
	open,
	className,
	onToggle,
	children,
}: CollapsiblePanelProps) {
	const triggerId = `${id}-trigger`
	const contentId = `${id}-content`

	return (
		<section className={cn(
			styles.panel({ open }),
			className,
		)}
		>
			<button
				id={triggerId}
				type="button"
				className={styles.trigger({ open })}
				aria-expanded={open}
				aria-controls={contentId}
				onClick={onToggle}
			>
				<span className={styles.label}>{label}</span>
				<ChevronDown
					className={styles.chevron({ open })}
					strokeWidth={2}
					aria-hidden="true"
				/>
			</button>

			<CollapsibleRegion
				id={contentId}
				expanded={open}
				labelledBy={triggerId}
			>
				<div className={styles.content}>
					{children}
				</div>
			</CollapsibleRegion>
		</section>
	)
}
