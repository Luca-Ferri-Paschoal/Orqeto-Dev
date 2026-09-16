import { cn } from "@/shared/utils/cn"

interface ContextModeButtonStyleParams {
	selected: boolean
}

interface ActionMenuItemStyleParams {
	selected: boolean
}

export const styles = {
	container: "relative",

	header: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-2",
	),

	title: cn(
		"text-[13px]",
		"font-bold",
		"text-[var(--font-color)]",
	),

	toggleButton: cn(
		"flex",
		"h-7",
		"w-7",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--font-color-muted)]",
		"transition-colors",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"motion-reduce:transition-none",
	),

	contextModeBar: cn(
		"mt-3",
		"flex",
		"flex-wrap",
		"gap-1",
		"border-t",
		"border-[var(--border-color)]",
		"pt-2.5",
	),

	contextModeButton: ({
		selected,
	}: ContextModeButtonStyleParams) => cn(
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

	collapseInner: cn(
		"overflow-visible",
		"pt-3",
	),

	projectControls: cn(
		"grid",
		"grid-cols-[minmax(0,1fr)_10rem]",
		"items-end",
		"gap-2",
		"max-[520px]:grid-cols-1",
	),

	pathInput: cn(
		"h-8",
		"py-0",
	),

	devIgnoreButton: cn(
		"flex",
		"h-8",
		"items-center",
		"gap-1.5",
		"rounded-md",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"px-2.5",
		"text-[10px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
		"shadow-sm",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
	),

	actionsField: cn(
		"relative",
		"block",
		"min-w-0",
	),

	actionsLabel: cn(
		"mb-1",
		"block",
		"text-[11px]",
		"font-medium",
		"text-[var(--font-color-secondary)]",
	),

	actionControl: cn(
		"relative",
		"flex",
		"h-8",
		"w-full",
	),

	actionExecuteButton: cn(
		"min-w-0",
		"flex-1",
		"truncate",
		"rounded-l-md",
		"border",
		"border-r-0",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"px-2.5",
		"text-left",
		"text-[10px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
		"shadow-sm",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:z-10",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
	),

	actionMenuButton: cn(
		"flex",
		"w-8",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-r-md",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"text-[var(--font-color-muted)]",
		"shadow-sm",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:z-10",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
	),

	actionMenu: cn(
		"absolute",
		"right-0",
		"top-full",
		"z-50",
		"mt-1",
		"min-w-full",
		"overflow-hidden",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-1",
		"shadow-xl",
	),

	actionMenuItem: ({
		selected,
	}: ActionMenuItemStyleParams) => cn(
		"block",
		"w-full",
		"rounded",
		"px-2",
		"py-1.5",
		"text-left",
		"text-[10px]",
		"font-medium",
		"transition-colors",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		selected ?
			[
				"bg-[var(--background-3)]",
				"text-[var(--font-color)]",
			] :
			[
				"text-[var(--font-color-secondary)]",
				"hover:bg-[var(--background-3)]",
				"hover:text-[var(--font-color)]",
			],
	),
} as const
