import type { ContextHistoryPlacement } from "."
import { cn } from "@/shared/utils/cn"

interface HistoryPlacementStyleParams {
	placement: ContextHistoryPlacement
}

interface HistoryRegionStyleParams extends HistoryPlacementStyleParams {
	expanded: boolean
}

export const styles = {
	container: ({
		placement,
	}: HistoryPlacementStyleParams) => cn(
		"flex",
		"flex-col",
		placement === "header" ?
			[
				"static",
				"shrink-0",
			] :
			[
				"relative",
				"mt-2.5",
			],
	),

	toggle: ({
		placement,
	}: HistoryPlacementStyleParams) => cn(
		"inline-flex",
		"w-fit",
		"items-center",
		"gap-1",
		"rounded-md",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-45",
		placement === "header" ?
			[
				"min-h-7",
				"px-2",
				"text-[9px]",
			] :
			[
				"min-h-8",
				"px-2.5",
				"text-[11px]",
			],
	),

	region: ({
		expanded,
		placement,
	}: HistoryRegionStyleParams) => cn(
		"grid",
		"transition-[grid-template-rows,opacity]",
		"duration-200",
		"ease-out",
		"motion-reduce:transition-none",
		placement === "header" && [
			"absolute",
			"left-0",
			"right-0",
			"top-9",
			"z-50",
		],
		expanded ?
			[
				"grid-rows-[1fr]",
				"pointer-events-auto",
				"opacity-100",
			] :
			[
				"grid-rows-[0fr]",
				"pointer-events-none",
				"opacity-0",
			],
	),

	regionInner: cn(
		"min-h-0",
		"overflow-hidden",
	),

	list: ({
		placement,
	}: HistoryPlacementStyleParams) => cn(
		"flex",
		"max-h-56",
		"flex-col",
		"gap-1",
		"orqeto-scroll-area",
		"overflow-y-auto",
		"rounded-lg",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-3)]",
		"p-1.5",
		placement === "header" ?
			[
				"mt-1.5",
				"shadow-xl",
			] :
			"mt-2",
	),

	empty: cn(
		"px-2",
		"py-2",
		"text-[10px]",
		"text-[var(--font-color-muted)]",
	),

	item: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-2",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"px-2",
		"py-1.5",
	),

	info: cn(
		"flex",
		"min-w-0",
		"flex-col",
	),

	date: cn(
		"truncate",
		"text-[10px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	meta: cn(
		"text-[9px]",
		"text-[var(--font-color-subtle)]",
	),

	actions: cn(
		"flex",
		"shrink-0",
		"items-center",
		"gap-0.5",
	),

	action: cn(
		"inline-flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--font-color-muted)]",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-45",
	),

	deleteAction: cn(
		"inline-flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--font-color-subtle)]",
		"transition",
		"hover:bg-[var(--danger-background)]",
		"hover:text-[var(--danger-font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--danger-focus-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-45",
	),
} as const
