import { cn } from "@/shared/utils/cn"
import type { PropsWithChildren } from "react"

export type CollapsibleRegionProps = PropsWithChildren<{
	id: string
	expanded: boolean
	className?: string
	innerClassName?: string
	labelledBy?: string
}>

export function CollapsibleRegion({
	id,
	expanded,
	className,
	innerClassName,
	labelledBy,
	children,
}: CollapsibleRegionProps) {
	return (
		<div
			id={id}
			role={labelledBy === undefined ?
				undefined :
				"region"}
			aria-labelledby={labelledBy}
			aria-hidden={!expanded}
			inert={!expanded}
			className={cn(
				"grid",
				"transition-[grid-template-rows,opacity]",
				"duration-200",
				"ease-out",
				"motion-reduce:transition-none",
				expanded ?
					[
						"grid-rows-[1fr]",
						"opacity-100",
					] :
					[
						"grid-rows-[0fr]",
						"opacity-0",
					],
				className,
			)}
		>
			<div
				className={cn(
					"min-h-0",
					"overflow-hidden",
					innerClassName,
				)}
			>
				{children}
			</div>
		</div>
	)
}
