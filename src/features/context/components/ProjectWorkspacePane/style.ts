import { cn } from "@/shared/utils/cn"

export const styles = {
	root: cn(
		"flex flex-col gap-3",
		"[&[hidden]]:hidden",
	),

	workspaceCard: cn(
		"rounded-xl",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"p-4",
		"shadow-sm",
	),
} as const
