import { cn } from "@/shared/utils/cn"

interface InputStyleParams {
	hasError: boolean
	className?: string
}

interface FeedbackStyleParams {
	hasError: boolean
}

export const styles = {
	container: "w-full",

	label: cn(
		"mb-1",
		"block",
		"text-[11px]",
		"font-medium",
		"text-[var(--font-color-secondary)]",
	),

	control: cn(
		"flex",
		"w-full",
		"items-center",
		"gap-2",
	),

	input: ({
		hasError,
		className,
	}: InputStyleParams) => cn(
		"min-w-0",
		"flex-1",
		"rounded-md",
		"border",
		"bg-[var(--background-2)]",
		"px-3",
		"py-1.5",
		"text-[11px]",
		"text-[var(--font-color)]",
		"shadow-sm",
		"placeholder:text-[var(--font-color-subtle)]",
		"transition",
		"focus:border-[var(--focus-border-color)]",
		"focus:outline-none",
		"focus:ring-2",
		"focus:ring-[var(--focus-ring-color)]",
		hasError ?
			[
				"border-[var(--danger-border-strong-color)]",
				"focus:border-[var(--danger-border-strong-color)]",
				"focus:ring-[var(--danger-focus-color)]",
			] :
			"border-[var(--border-color-strong)]",
		className,
	),

	suffix: cn(
		"shrink-0",
		"text-xs",
		"font-medium",
		"text-[var(--font-color-secondary)]",
	),

	feedback: ({
		hasError,
	}: FeedbackStyleParams) => cn(
		"mt-1",
		"text-[10px]",
		hasError ?
			"text-[var(--danger-font-color)]" :
			"text-[var(--font-color-muted)]",
	),
} as const
