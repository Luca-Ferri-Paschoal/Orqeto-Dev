import { cn } from "@/shared/utils/cn"

interface HistoryRegionStyleParams {
	expanded: boolean
}

export const styles = {
	container: cn(
		"mt-3",
		"flex",
		"flex-col",
		"border-t",
		"border-[var(--border-color)]",
		"pt-3",
	),

	topRow: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-2",
		"max-[480px]:items-start",
	),

	summary: cn(
		"min-w-0",
		"flex-1",
	),

	title: cn(
		"text-[13px]",
		"font-bold",
		"text-[var(--font-color)]",
	),

	description: cn(
		"mt-0.5",
		"text-[11px]",
		"text-[var(--font-color-muted)]",
	),

	actions: cn(
		"flex",
		"flex-wrap",
		"items-center",
		"justify-end",
		"gap-1.5",
		"max-[480px]:grid",
		"max-[480px]:w-max",
		"max-[480px]:shrink-0",
		"max-[480px]:grid-cols-[max-content_max-content]",
		"max-[480px]:items-stretch",
	),

	copyButton: cn(
		"max-[480px]:order-1",
		"max-[480px]:px-2",
	),

	downloadButton: cn(
		"max-[480px]:order-3",
		"max-[480px]:px-2",
	),

	clearButton: cn(
		"max-[480px]:order-2",
		"max-[480px]:px-2",
	),

	historyToggle: cn(
		"inline-flex",
		"min-h-8",
		"self-stretch",
		"items-center",
		"gap-1",
		"rounded-md",
		"max-[480px]:order-4",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"px-2.5",
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-45",
	),

	historyRegion: ({
		expanded,
	}: HistoryRegionStyleParams) => cn(
		"grid",
		"transition-[grid-template-rows,opacity]",
		"duration-200",
		"ease-out",
		"motion-reduce:transition-none",
		expanded ?
			[
				"grid-rows-[1fr]",
				"opacity-100",
			] :
			[
				"grid-rows-[0fr]",
				"opacity-0",
			],
	),

	historyRegionInner: cn(
		"min-h-0",
		"overflow-hidden",
	),

	historyList: cn(
		"mt-2.5",
		"flex",
		"max-h-56",
		"flex-col",
		"gap-1",
		"overflow-y-auto",
		"rounded-lg",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-3)]",
		"p-1.5",
	),

	historyEmpty: cn(
		"px-2",
		"py-2",
		"text-[10px]",
		"text-[var(--font-color-muted)]",
	),

	historyItem: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-2",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"px-2",
		"py-1.5",
	),

	historyInfo: cn(
		"flex",
		"min-w-0",
		"flex-col",
	),

	historyDate: cn(
		"truncate",
		"text-[10px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	historyMeta: cn(
		"text-[9px]",
		"text-[var(--font-color-subtle)]",
	),

	historyActions: cn(
		"flex",
		"shrink-0",
		"items-center",
		"gap-0.5",
	),

	historyAction: cn(
		"inline-flex",
		"h-7",
		"w-7",
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
		"disabled:opacity-45",
	),

	historyDelete: cn(
		"inline-flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--font-color-subtle)]",
		"transition",
		"hover:bg-[var(--danger-background)]",
		"hover:text-[var(--danger-font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--danger-focus-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-45",
	),
} as const
