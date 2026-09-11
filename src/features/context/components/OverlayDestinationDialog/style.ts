import { cn } from "@/shared/utils/cn"

interface CandidateStyleParams {
	selected: boolean
}

export const styles = {
	backdrop: cn(
		"fixed",
		"inset-0",
		"z-40",
		"flex",
		"items-center",
		"justify-center",
		"bg-[var(--overlay-background)]",
		"p-4",
		"backdrop-blur-[1px]",
	),

	dialog: cn(
		"w-full",
		"max-w-lg",
		"rounded-xl",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-4",
		"shadow-2xl",
	),

	heading: cn(
		"flex",
		"items-start",
		"gap-3",
	),

	headingIcon: cn(
		"flex",
		"h-8",
		"w-8",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-lg",
		"bg-[var(--accent-background-strong)]",
		"text-[var(--accent-font-color)]",
	),

	title: cn(
		"text-sm",
		"font-bold",
		"text-[var(--font-color)]",
	),

	description: cn(
		"mt-1",
		"text-xs",
		"leading-5",
		"text-[var(--font-color-muted)]",
	),

	candidates: cn(
		"mt-4",
		"max-h-64",
		"space-y-2",
		"overflow-y-auto",
	),

	candidate: ({ selected }: CandidateStyleParams) => cn(
		"flex",
		"w-full",
		"items-start",
		"gap-2.5",
		"rounded-lg",
		"border",
		"px-3",
		"py-2.5",
		"text-left",
		"transition",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--accent-focus-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-60",
		selected ?
			[
				"border-[var(--accent-border-strong-color)]",
				"bg-[var(--accent-background)]",
				"text-[var(--accent-font-color)]",
			] :
			[
				"border-[var(--border-color)]",
				"bg-[var(--background-2)]",
				"text-[var(--font-color-secondary)]",
				"hover:bg-[var(--background-3)]",
			],
	),

	candidateContent: cn(
		"min-w-0",
		"flex-1",
	),

	candidatePath: cn(
		"block",
		"break-all",
		"text-xs",
	),

	candidateDetails: cn(
		"mt-1",
		"block",
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	actions: cn(
		"mt-4",
		"flex",
		"justify-end",
		"gap-2",
	),
} as const
