import type { NoticeKind } from "."
import { cn } from "@/shared/utils/cn"

interface NoticeStyleParams {
	kind: NoticeKind
}

const kindStyles: Record<NoticeKind, string> = {
	info: cn(
		"border-[var(--accent-border-color)]",
		"bg-[var(--accent-background)]",
		"text-[var(--accent-font-color)]",
	),
	success: cn(
		"border-[var(--success-border-color)]",
		"bg-[var(--success-background)]",
		"text-[var(--success-font-color)]",
	),
	warning: cn(
		"border-[var(--warning-border-color)]",
		"bg-[var(--warning-background)]",
		"text-[var(--warning-font-color)]",
	),
	error: cn(
		"border-[var(--danger-border-color)]",
		"bg-[var(--danger-background)]",
		"text-[var(--danger-font-color)]",
	),
}

export const styles = {
	notice: ({
		kind,
	}: NoticeStyleParams) => cn(
		"rounded-md",
		"border",
		"px-3",
		"py-2",
		"text-[11px]",
		"leading-4",
		kindStyles[kind],
	),
} as const
