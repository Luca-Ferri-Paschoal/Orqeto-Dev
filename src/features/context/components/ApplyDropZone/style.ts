import { cn } from "@/shared/utils/cn"

interface ApplyDropZoneStyleParams {
	enabled: boolean
	isDragging: boolean
}

export const styles = {
	container: cn(
		"relative",
		"flex",
		"flex-col",
		"rounded-xl",
		"border",
		"border-[var(--accent-border-color)]",
		"bg-[var(--background-2)]",
		"p-3",
		"shadow-sm",
	),

	toggleButton: cn(
		"absolute",
		"right-3",
		"top-3",
		"z-10",
		"flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"border",
		"border-[var(--accent-border-color)]",
		"bg-[var(--background-2)]",
		"text-[var(--accent-font-color)]",
		"shadow-sm",
		"backdrop-blur-sm",
		"transition",
		"hover:bg-[var(--accent-background)]",
		"hover:text-[var(--accent-font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--accent-focus-color)]",
		"motion-reduce:transition-none",
	),

	collapseInner: cn(
		"min-h-0",
		"overflow-hidden",
		"pb-2.5",
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
		"bg-[var(--accent-button-color)]",
		"text-[var(--button-font-color)]",
	),

	headerContent: cn(
		"min-w-0",
		"flex-1",
	),

	titleRow: cn(
		"flex",
		"flex-wrap",
		"items-center",
		"gap-1.5",
	),

	modeBadge: cn(
		"rounded-full",
		"border",
		"border-[var(--accent-border-color)]",
		"bg-[var(--accent-background)]",
		"px-1.5",
		"py-0.5",
		"text-[9px]",
		"font-bold",
		"uppercase",
		"tracking-wide",
		"text-[var(--accent-font-color)]",
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

	zone: ({
		enabled,
		isDragging,
	}: ApplyDropZoneStyleParams) => cn(
		"flex",
		"min-h-28",
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
		enabled ?
			[
				"border-[var(--accent-border-color)]",
				"bg-[var(--accent-background)]",
			] :
			[
				"border-[var(--border-color)]",
				"bg-[var(--background-3)]",
				"opacity-70",
			],
		isDragging && enabled ?
			[
				"border-[var(--accent-border-strong-color)]",
				"bg-[var(--accent-background-strong)]",
				"shadow-md",
			] :
			undefined,
	),

	icon: cn(
		"flex",
		"h-6",
		"w-6",
		"items-center",
		"justify-center",
		"rounded-md",
		"bg-[var(--accent-button-color)]",
		"text-xs",
		"font-light",
		"text-[var(--button-font-color)]",
	),

	title: cn(
		"text-[12px]",
		"font-bold",
		"text-[var(--font-color)]",
	),

	undoCollapseInner: cn(
		"min-h-0",
		"overflow-hidden",
	),

	undoControls: cn(
		"mt-2.5",
		"flex",
		"items-center",
		"gap-2",
	),

	undoHistory: cn(
		"min-w-0",
		"flex-1",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"px-2",
		"py-1.5",
		"text-[10px]",
		"text-[var(--font-color-secondary)]",
		"outline-none",
		"disabled:cursor-not-allowed",
		"disabled:bg-[var(--background-3)]",
		"disabled:text-[var(--font-color-subtle)]",
	),

	undoButton: cn(
		"shrink-0",
		"gap-1.5",
		"text-[11px]",
	),
} as const
