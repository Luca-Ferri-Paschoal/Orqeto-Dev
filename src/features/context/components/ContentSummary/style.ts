import { cn } from "@/shared/utils/cn"

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
		"max-[480px]:flex-col",
		"max-[480px]:items-stretch",
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
		"flex-nowrap",
		"items-center",
		"justify-end",
		"gap-1.5",
		"max-[480px]:w-full",
	),

	actionButton: cn(
		"max-[480px]:min-w-0",
		"max-[480px]:flex-1",
		"max-[480px]:px-2",
	),
} as const
