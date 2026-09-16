import { cn } from "@/shared/utils/cn"

interface TabStyleParams {
	active: boolean
	dragging: boolean
}

export const styles = {
	root: cn(
		"relative flex h-9 min-w-0 items-stretch",
		"overflow-hidden rounded-lg border border-[var(--border-color)]",
		"bg-[var(--background-4)] shadow-sm",
	),

	list: cn(
		"orqeto-scroll-area relative z-10",
		"flex h-full min-w-0 flex-1 items-stretch",
		"overflow-x-auto overflow-y-hidden overscroll-x-contain",
	),

	tabSlot: cn(
		"relative flex h-full min-w-28 flex-1 basis-0 shrink items-stretch",
		"after:absolute after:right-0 after:top-2 after:bottom-2 after:w-px",
		"after:bg-[var(--border-color)]",
	),

	tab: ({ active, dragging }: TabStyleParams) => cn(
		"group relative flex h-full w-full min-w-0 items-center",
		"cursor-grab select-none",
		"transition-[background-color,color,box-shadow,border-color]",
		"duration-150",
		active ?
			[
				"z-10 rounded-md border border-[var(--border-color)]",
				"bg-[var(--background-2)]",
				"text-[var(--font-color)]",
				"shadow-sm",
			] :
			[
				"border border-transparent bg-transparent",
				"text-[var(--font-color-secondary)]",
				"hover:bg-[var(--background-3)]",
				"hover:text-[var(--font-color)]",
			],
		dragging && "cursor-grabbing opacity-45",
	),

	dropMarker: cn(
		"relative z-20 h-full w-0.5 shrink-0 self-stretch rounded-full",
		"bg-[var(--accent-button-color)] shadow-[0_0_0_1px_var(--drop-marker-outline)]",
	),

	selectButton: cn(
		"flex h-full min-w-0 flex-1 items-center",
		"px-3 text-left text-xs font-semibold",
		"max-[480px]:px-2",
		"focus-visible:outline-none",
		"disabled:cursor-not-allowed disabled:opacity-60",
	),

	label: "truncate",

	closeButton: cn(
		"mr-1.5 inline-flex size-5 shrink-0 items-center justify-center",
		"rounded text-[var(--font-color-subtle)] transition",
		"hover:bg-[var(--background-4)] hover:text-[var(--font-color-secondary)]",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed disabled:opacity-50",
	),

	addButton: cn(
		"relative z-10 inline-flex h-full w-10 shrink-0 items-center justify-center",
		"border-l border-[var(--border-color)]",
		"text-[var(--font-color-secondary)] transition",
		"hover:bg-[var(--background-3)] hover:text-[var(--font-color)]",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed disabled:opacity-50",
	),
} as const
