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
	notice: ({ kind }: NoticeStyleParams) => cn(
		"rounded-md",
		"border",
		"px-3",
		"py-2.5",
		"text-[11px]",
		"leading-4",
		kindStyles[kind],
	),
	summary: cn(
		"flex",
		"flex-wrap",
		"items-center",
		"gap-2",
	),
	message: cn(
		"min-w-0",
		"flex-1",
		"font-medium",
		"leading-4",
	),
	action: cn(
		"min-h-7",
		"shrink-0",
		"px-2.5",
		"py-1",
	),
	details: cn(
		"mt-2",
		"grid",
		"gap-1",
		"border-t",
		"border-current/15",
		"pt-2",
	),
	detail: cn(
		"flex",
		"min-w-0",
		"items-center",
		"before:mr-2",
		"before:h-1",
		"before:w-1",
		"before:shrink-0",
		"before:rounded-full",
		"before:bg-current/55",
	),
} as const
