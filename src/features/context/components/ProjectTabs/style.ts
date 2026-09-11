import { cn } from "@/shared/utils/cn"

interface TabStyleParams {
	active: boolean
	dragging: boolean
}

export const styles = {
	root: cn(
		"flex min-w-0 items-end gap-1",
		"rounded-xl border border-[var(--border-color)]",
		"bg-[var(--background-4)] px-1.5 pt-1.5",
		"shadow-sm",
	),

	list: cn(
		"flex min-w-0 flex-1 items-end gap-1",
		"overflow-x-auto overscroll-x-contain",
		"[scrollbar-width:thin]",
	),

	tabSlot: cn("relative flex min-w-20 max-w-48 shrink items-end"),

	tab: ({ active, dragging }: TabStyleParams) => cn(
		"group flex h-8 min-w-20 max-w-48 shrink items-center",
		"cursor-grab select-none",
		"rounded-t-lg border border-b-0",
		"transition",
		active ?
			[
				"border-[var(--border-color-strong)] bg-[var(--background-2)]",
				"text-[var(--font-color)]",
			] :
			[
				"border-transparent bg-[var(--background-3)]",
				"text-[var(--font-color-secondary)] hover:bg-[var(--background-3)]",
			],
		dragging && "cursor-grabbing opacity-45",
	),

	dropMarker: cn(
		"h-7 w-0.5 shrink-0 self-center rounded-full",
		"bg-[var(--accent-button-color)] shadow-[0_0_0_1px_var(--drop-marker-outline)]",
	),

	selectButton: cn(
		"flex h-full min-w-0 flex-1 items-center",
		"px-2.5 text-left text-xs font-semibold",
		"max-[480px]:px-2",
		"focus-visible:outline-none",
		"disabled:cursor-not-allowed disabled:opacity-60",
	),

	label: "truncate",

	closeButton: cn(
		"mr-1 inline-flex size-5 shrink-0 items-center justify-center",
		"rounded text-[var(--font-color-subtle)] transition",
		"hover:bg-[var(--background-4)] hover:text-[var(--font-color-secondary)]",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed disabled:opacity-50",
	),

	addButton: cn(
		"mb-1 inline-flex size-7 shrink-0 items-center justify-center",
		"rounded-md text-[var(--font-color-secondary)] transition",
		"hover:bg-[var(--background-2)] hover:text-[var(--font-color)]",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed disabled:opacity-50",
	),
} as const
