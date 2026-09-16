import { cn } from "@/shared/utils/cn"

export const styles = {
	container: cn(
		"mt-3",
		"flex",
		"min-h-9",
		"items-center",
		"justify-between",
		"gap-2",
		"border-t",
		"border-[var(--border-color)]",
		"pt-3",
	),

	metadata: cn(
		"min-w-0",
		"text-[11px]",
		"font-medium",
		"text-[var(--font-color-muted)]",
	),

	actions: cn(
		"ml-auto",
		"flex",
		"shrink-0",
		"gap-1.5",
	),
} as const
