import { cn } from "@/shared/utils/cn"

interface CollapseRegionStyleParams {
	expanded: boolean
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
		"transition",
		"hover:bg-[var(--background-3)]",
		"hover:text-[var(--font-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"motion-reduce:transition-none",
	),

	collapseRegion: ({
		expanded,
	}: CollapseRegionStyleParams) => cn(
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

	collapseInner: cn(
		"min-h-0",
		"overflow-hidden",
		"pt-2",
	),

	actions: cn(
		"mt-2",
		"flex",
		"flex-wrap",
		"gap-1.5",
	),
} as const
