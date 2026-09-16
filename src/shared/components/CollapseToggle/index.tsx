import { cn } from "@/shared/utils/cn"
import { ChevronDown } from "lucide-react"

interface CollapseToggleProps {
	controlsId: string
	expanded: boolean
	label: string
	className?: string
	size?: number
	onToggle: () => void
}

export function CollapseToggle({
	controlsId,
	expanded,
	label,
	className,
	size = 15,
	onToggle,
}: CollapseToggleProps) {
	return (
		<button
			type="button"
			aria-controls={controlsId}
			aria-expanded={expanded}
			aria-label={label}
			title={label}
			className={className}
			onClick={onToggle}
		>
			<ChevronDown
				size={size}
				strokeWidth={2}
				aria-hidden="true"
				className={cn(
					"transition-transform",
					"duration-200",
					"ease-out",
					"motion-reduce:transition-none",
					expanded && "rotate-180",
				)}
			/>
		</button>
	)
}
