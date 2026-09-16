import { cn } from "@/shared/utils/cn"

export const styles = {
	backdrop: cn(
		"fixed",
		"inset-0",
		"z-40",
		"flex",
		"items-center",
		"justify-center",
		"bg-[var(--overlay-background)]",
		"p-4",
		"backdrop-blur-[1px]",
	),

	dialog: cn(
		"w-full",
		"max-w-md",
		"rounded-xl",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-4",
		"shadow-2xl",
	),

	heading: cn(
		"flex",
		"items-start",
		"gap-3",
	),

	headingIcon: cn(
		"flex",
		"h-8",
		"w-8",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-lg",
		"bg-[var(--accent-background-strong)]",
		"text-[var(--accent-font-color)]",
	),

	title: cn(
		"text-sm",
		"font-bold",
		"text-[var(--font-color)]",
	),

	description: cn(
		"mt-1",
		"text-xs",
		"leading-5",
		"text-[var(--font-color-muted)]",
	),

	field: cn(
		"mt-4",
		"flex",
		"flex-col",
		"gap-1.5",
	),

	label: cn(
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	select: cn(
		"min-h-9",
		"w-full",
		"rounded-md",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"px-2.5",
		"text-[11px]",
		"text-[var(--font-color)]",
		"outline-none",
		"focus:border-[var(--focus-border-color)]",
		"focus:ring-2",
		"focus:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-60",
	),

	selectionDetails: cn(
		"mt-2",
		"min-h-8",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-3)]",
		"px-2.5",
		"py-2",
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	actions: cn(
		"mt-4",
		"flex",
		"justify-end",
		"gap-2",
	),
} as const
