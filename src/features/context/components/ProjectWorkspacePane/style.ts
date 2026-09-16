import { cn } from "@/shared/utils/cn"

interface SecondaryModeButtonStyleParams {
	selected: boolean
}

export const styles = {
	root: cn("[&[hidden]]:hidden"),

	content: cn(
		"flex",
		"flex-col",
		"gap-3",
	),

	workspaceCard: cn(
		"rounded-xl",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-4",
		"shadow-sm",
	),

	modeDetails: cn(
		"mt-3",
		"border-t",
		"border-[var(--border-color)]",
		"pt-3",
	),

	secondaryModeRow: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-2",
		"max-[460px]:items-start",
	),

	secondaryModeLabel: cn(
		"shrink-0",
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	secondaryModeButtons: cn(
		"flex",
		"min-w-0",
		"flex-wrap",
		"justify-end",
		"gap-1",
	),

	secondaryModeButton: ({
		selected,
	}: SecondaryModeButtonStyleParams) => cn(
		"min-h-7",
		"rounded-md",
		"border",
		"px-2.5",
		"py-1",
		"text-[10px]",
		"font-semibold",
		"transition-colors",
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
				"hover:text-[var(--font-color)]",
			],
	),
} as const
