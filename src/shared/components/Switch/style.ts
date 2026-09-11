import { cn } from "@/shared/utils/cn"

interface SwitchStyleParams {
	checked: boolean
}

export const styles = {
	container: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-3",
	),

	copy: cn(
		"flex",
		"min-w-0",
		"flex-col",
		"gap-0.5",
	),

	label: cn(
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	description: cn(
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	switch: ({
		checked,
	}: SwitchStyleParams) => cn(
		"relative",
		"h-5",
		"w-9",
		"shrink-0",
		"rounded-full",
		"transition",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
		"focus-visible:ring-offset-2",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
		checked ?
			"bg-[var(--button-color)]" :
			"bg-[var(--switch-off-color)]",
	),

	thumb: ({
		checked,
	}: SwitchStyleParams) => cn(
		"absolute",
		"left-0.5",
		"top-0.5",
		"h-4",
		"w-4",
		"rounded-full",
		"bg-[var(--background-2)]",
		"shadow-sm",
		"transition-transform",
		checked ?
			"translate-x-4" :
			"translate-x-0",
	),
} as const
