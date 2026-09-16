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
		"max-w-xl",
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

	headingContent: "min-w-0",

	title: cn(
		"text-sm",
		"font-bold",
		"text-[var(--font-color)]",
	),

	description: cn(
		"mt-1",
		"break-all",
		"text-xs",
		"leading-5",
		"text-[var(--font-color-muted)]",
	),

	summary: cn(
		"mt-4",
		"flex",
		"flex-wrap",
		"gap-1.5",
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
		"[&>span]:rounded-md",
		"[&>span]:border",
		"[&>span]:border-[var(--border-color)]",
		"[&>span]:bg-[var(--background-3)]",
		"[&>span]:px-2",
		"[&>span]:py-1",
	),

	breakdown: cn(
		"mt-2",
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	changes: cn(
		"mt-3",
		"max-h-64",
		"space-y-1",
		"orqeto-scroll-area",
		"overflow-y-auto",
		"rounded-lg",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-3)]",
		"p-1.5",
	),

	change: cn(
		"grid",
		"grid-cols-[3.25rem_minmax(0,1fr)_auto]",
		"items-center",
		"gap-2",
		"rounded-md",
		"bg-[var(--background-2)]",
		"px-2",
		"py-1.5",
		"text-[10px]",
	),

	kind: cn(
		"font-bold",
		"uppercase",
		"tracking-wide",
		"text-[var(--accent-font-color)]",
	),

	path: cn(
		"min-w-0",
		"truncate",
		"font-mono",
		"text-[var(--font-color-secondary)]",
	),

	lineStats: cn(
		"shrink-0",
		"font-mono",
		"text-[var(--font-color-muted)]",
	),

	safetyNote: cn(
		"mt-3",
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
