import { cn } from "@/shared/utils/cn"

export const styles = {
	backdrop: cn(
		"fixed",
		"inset-0",
		"z-[100]",
		"flex",
		"items-center",
		"justify-center",
		"bg-[var(--overlay-background)]",
		"p-4",
		"backdrop-blur-[1px]",
	),

	dialog: cn(
		"w-full",
		"max-w-[22rem]",
		"rounded-xl",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-3",
		"shadow-2xl",
	),

	heading: cn(
		"flex",
		"items-start",
		"gap-2",
	),

	headingIcon: cn(
		"flex",
		"h-7",
		"w-7",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-lg",
		"bg-[var(--warning-background)]",
		"text-[var(--warning-font-color)]",
	),

	headingContent: cn(
		"min-w-0",
		"flex-1",
	),

	title: cn(
		"text-sm",
		"font-bold",
		"text-[var(--font-color)]",
	),

	message: cn(
		"mt-1",
		"max-h-28",
		"overflow-y-auto",
		"whitespace-pre-wrap",
		"[overflow-wrap:anywhere]",
		"text-xs",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	actions: cn(
		"mt-3",
		"flex",
		"justify-end",
		"gap-2",
	),
} as const
