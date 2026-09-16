import { cn } from "@/shared/utils/cn"

interface ZoneStyleParams {
	isDragging: boolean
	variant: "add" | "remove"
}

interface IconStyleParams {
	variant: "add" | "remove"
}

export const styles = {
	backdrop: cn(
		"fixed",
		"inset-0",
		"z-[90]",
		"flex",
		"items-center",
		"justify-center",
		"bg-black/45",
		"p-4",
		"backdrop-blur-[2px]",
	),

	dialog: cn(
		"w-full",
		"max-w-2xl",
		"rounded-xl",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-1)]",
		"p-4",
		"shadow-2xl",
		"focus:outline-none",
	),

	header: cn(
		"mb-3",
		"flex",
		"items-start",
		"justify-between",
		"gap-3",
	),

	headerText: "min-w-0",

	title: cn(
		"text-[14px]",
		"font-bold",
		"text-[var(--font-color)]",
	),

	description: cn(
		"mt-1",
		"max-w-xl",
		"text-[11px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	closeButton: cn(
		"flex",
		"h-8",
		"w-8",
		"shrink-0",
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
		"disabled:opacity-50",
	),

	zones: cn(
		"grid",
		"grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
		"gap-2.5",
	),

	zone: ({
		isDragging,
		variant,
	}: ZoneStyleParams) => cn(
		"flex",
		"min-h-44",
		"min-w-0",
		"flex-col",
		"items-center",
		"justify-center",
		"rounded-xl",
		"border-2",
		"border-dashed",
		"px-4",
		"py-5",
		"text-center",
		"transition",
		variant === "remove" ?
			[
				"border-[var(--danger-border-color)]",
				"bg-[var(--danger-background)]",
			] :
			[
				"border-[var(--border-color-strong)]",
				"bg-[var(--background-2)]",
			],
		isDragging && [
			"scale-[1.01]",
			"border-[var(--focus-border-color)]",
			"ring-2",
			"ring-[var(--focus-ring-color)]",
		],
		"motion-reduce:transition-none",
	),

	icon: ({ variant }: IconStyleParams) => cn(
		"mb-2",
		"flex",
		"h-10",
		"w-10",
		"items-center",
		"justify-center",
		"rounded-xl",
		variant === "remove" ?
			"text-[var(--danger-font-color)]" :
			"text-[var(--button-color)]",
	),

	zoneTitle: cn(
		"text-[12px]",
		"font-bold",
		"text-[var(--font-color)]",
	),

	zoneDescription: cn(
		"mt-1",
		"max-w-xs",
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),
} as const
