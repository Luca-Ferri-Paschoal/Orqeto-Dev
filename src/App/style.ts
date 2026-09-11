import { cn } from "@/shared/utils/cn"

export const styles = {
	page: cn(
		"min-h-screen",
		"bg-[var(--background-1)]",
		"px-3",
		"py-3",
	),

	shell: cn(
		"mx-auto",
		"flex",
		"w-full",
		"max-w-3xl",
		"flex-col",
		"gap-3",
	),

	header: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-3",
		"rounded-xl",
		"bg-[var(--header-background)]",
		"px-4",
		"py-3",
		"text-[var(--button-font-color)]",
		"shadow-sm",
	),

	title: cn(
		"text-lg",
		"font-black",
		"tracking-tight",
	),

	headerActions: cn(
		"flex",
		"items-center",
		"gap-1.5",
	),

	version: cn(
		"rounded-full",
		"border",
		"border-[var(--header-border-color)]",
		"px-2",
		"py-0.5",
		"text-[10px]",
		"font-semibold",
		"text-[var(--header-muted-color)]",
	),

	settingsButton: cn(
		"inline-flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--header-muted-color)]",
		"transition",
		"hover:bg-[var(--button-hover-color)]",
		"hover:text-[var(--button-font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
	),
} as const
