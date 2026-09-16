import { cn } from "@/shared/utils/cn"

interface RoutedNoticeStyleParams {
	success: boolean
}

export const styles = {
	page: cn(
		"orqeto-scroll-area",
		"h-screen",
		"overflow-y-auto",
		"overscroll-y-contain",
		"bg-[var(--background-1)]",
		"px-3",
		"py-3",
	),

	shell: cn(
		"mx-auto",
		"flex",
		"w-full",
		"max-w-3xl",
		"min-h-[calc(100vh-1.5rem)]",
		"flex-col",
		"gap-3",
	),

	workspaceStage: cn(
		"relative",
		"-mt-3",
		"flex",
		"flex-1",
		"flex-col",
		"gap-3",
		"pt-3",
	),

	routedNotice: ({ success }: RoutedNoticeStyleParams) => cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-3",
		"rounded-md",
		"border",
		"px-3",
		"py-2",
		"text-[11px]",
		"leading-4",
		success ?
			cn(
				"border-[var(--success-border-color)]",
				"bg-[var(--success-background)]",
				"text-[var(--success-font-color)]",
			) :
			cn(
				"border-[var(--accent-border-color)]",
				"bg-[var(--accent-background)]",
				"text-[var(--accent-font-color)]",
			),
	),

	routedNoticeText: cn(
		"min-w-0",
		"flex-1",
	),

	routedUndoButton: cn(
		"shrink-0",
		"rounded-md",
		"border",
		"border-current",
		"px-2",
		"py-1",
		"text-[10px]",
		"font-bold",
		"transition",
		"hover:opacity-80",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
	),

	header: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-3",
		"rounded-xl",
		"bg-[var(--header-background)]",
		"px-4",
		"py-3",
		"text-[var(--button-font-color)]",
		"shadow-sm",
	),

	title: cn(
		"text-lg",
		"font-black",
		"tracking-tight",
	),

	headerActions: cn(
		"flex",
		"items-center",
		"gap-1.5",
	),

	version: cn(
		"rounded-full",
		"border",
		"border-[var(--header-border-color)]",
		"px-2",
		"py-0.5",
		"text-[10px]",
		"font-semibold",
		"text-[var(--header-muted-color)]",
	),

	settingsButton: cn(
		"inline-flex",
		"h-7",
		"w-7",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-[var(--header-muted-color)]",
		"transition",
		"hover:bg-[var(--button-hover-color)]",
		"hover:text-[var(--button-font-color)]",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--focus-ring-color)]",
	),
} as const
