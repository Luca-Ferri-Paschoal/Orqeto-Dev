import { cn } from "@/shared/utils/cn"

interface DropZoneStyleParams {
	enabled: boolean
	isDragging: boolean
	variant: "add" | "remove"
}

interface DropZoneIconStyleParams {
	variant: "add" | "remove"
}

interface FilterButtonStyleParams {
	selected: boolean
}

interface CollapseRegionStyleParams {
	expanded: boolean
}

export const styles = {
	container: cn(
		"relative",
		"flex",
		"flex-col",
		"rounded-xl",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-3",
		"shadow-sm",
	),

	toggleButton: cn(
		"absolute",
		"right-3",
		"top-3",
		"z-40",
		"flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"text-[var(--font-color-muted)]",
		"shadow-sm",
		"backdrop-blur-sm",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"motion-reduce:transition-none",
	),

	collapseRegion: ({
		expanded,
	}: CollapseRegionStyleParams) => cn(
		"relative",
		"z-20",
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
	),

	collapseInner: ({
		expanded,
	}: CollapseRegionStyleParams) => cn(
		"relative",
		"z-20",
		"flex",
		"min-h-0",
		"flex-col",
		"gap-2.5",
		"pb-2.5",
		expanded ?
			"overflow-visible" :
			"overflow-hidden",
	),

	header: cn(
		"flex",
		"items-start",
		"gap-2.5",
		"pr-9",
	),

	headerIcon: cn(
		"flex",
		"h-7",
		"w-7",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-lg",
		"bg-[var(--button-color)]",
		"text-[var(--button-font-color)]",
	),

	sectionTitle: cn(
		"text-[13px]",
		"font-bold",
		"text-[var(--font-color)]",
	),

	sectionDescription: cn(
		"mt-0.5",
		"text-[11px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	filterPanel: cn(
		"relative",
		"z-20",
		"flex",
		"flex-col",
		"gap-2",
		"rounded-lg",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-3)]",
		"p-2.5",
	),

	filterRow: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-2",
	),

	filterLabel: cn(
		"shrink-0",
		"text-[10px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	filterButtons: cn(
		"flex",
		"min-w-0",
		"flex-wrap",
		"justify-end",
		"gap-1",
	),

	filterButton: ({
		selected,
	}: FilterButtonStyleParams) => cn(
		"rounded-md",
		"border",
		"px-2",
		"py-0.5",
		"text-[10px]",
		"font-semibold",
		"transition",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
		selected ?
			[
				"border-[var(--button-color)]",
				"bg-[var(--button-color)]",
				"text-[var(--button-font-color)]",
			] :
			[
				"border-[var(--border-color-strong)]",
				"bg-[var(--background-2)]",
				"text-[var(--font-color-secondary)]",
				"hover:bg-[var(--background-3)]",
			],
	),

	filterInputRow: cn(
		"flex",
		"items-end",
		"gap-1.5",
	),

	filterInputContainer: cn(
		"relative",
		"min-w-0",
		"flex-1",
	),

	clearButton: cn(
		"mb-px",
		"shrink-0",
		"px-2.5",
		"text-[10px]",
	),

	history: cn(
		"absolute",
		"inset-x-0",
		"top-full",
		"z-30",
		"mt-1",
		"max-h-48",
		"overflow-y-auto",
		"rounded-lg",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-1",
		"shadow-xl",
	),

	historyTitle: cn(
		"px-2",
		"py-1",
		"text-[9px]",
		"font-bold",
		"uppercase",
		"tracking-wide",
		"text-[var(--font-color-subtle)]",
	),

	historyItem: cn(
		"flex",
		"items-center",
		"gap-1",
		"rounded-md",
		"hover:bg-[var(--background-3)]",
	),

	historyValue: cn(
		"flex",
		"min-w-0",
		"flex-1",
		"flex-col",
		"items-start",
		"px-2",
		"py-1.5",
		"text-left",
	),

	historyPattern: cn(
		"max-w-full",
		"truncate",
		"text-[11px]",
		"font-medium",
		"text-[var(--font-color-secondary)]",
	),

	historyMeta: cn(
		"text-[9px]",
		"text-[var(--font-color-subtle)]",
	),

	historyDelete: cn(
		"mr-1",
		"flex",
		"h-6",
		"w-6",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--font-color-subtle)]",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color-secondary)]",
	),

	zones: cn(
		"grid",
		"grid-cols-[minmax(0,7fr)_minmax(6.75rem,3fr)]",
		"gap-2",
	),

	zone: ({
		enabled,
		isDragging,
		variant,
	}: DropZoneStyleParams) => cn(
		"relative",
		"z-0",
		"flex",
		"min-h-28",
		"min-w-0",
		"items-center",
		"justify-center",
		"gap-2",
		"rounded-lg",
		"border-2",
		"border-dashed",
		"px-2.5",
		"py-2",
		"text-center",
		"transition",
		!enabled ?
			[
				"border-[var(--border-color)]",
				"bg-[var(--background-3)]",
				"opacity-70",
			] :
			variant === "remove" ?
				[
					"border-[var(--danger-border-color)]",
					"bg-[var(--danger-background)]",
				] :
				[
					"border-[var(--border-color-strong)]",
					"bg-[var(--background-3)]",
				],
		isDragging && enabled ?
			variant === "remove" ?
				[
					"border-[var(--danger-border-strong-color)]",
					"bg-[var(--danger-background-hover)]",
					"shadow-md",
				] :
				[
					"border-[var(--button-color)]",
					"bg-[var(--background-2)]",
					"shadow-md",
				] :
			undefined,
	),

	icon: ({
		variant,
	}: DropZoneIconStyleParams) => cn(
		"flex",
		"h-6",
		"w-6",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-xs",
		"font-bold",
		"text-[var(--button-font-color)]",
		variant === "remove" ?
			"bg-[var(--danger-button-color)]" :
			"bg-[var(--button-color)]",
	),

	title: cn(
		"min-w-0",
		"text-[11px]",
		"font-bold",
		"leading-4",
		"text-[var(--font-color)]",
	),
} as const
