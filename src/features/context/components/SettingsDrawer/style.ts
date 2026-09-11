import { cn } from "@/shared/utils/cn"

interface DrawerStyleParams {
	open: boolean
}

export const styles = {
	overlay: ({
		open,
	}: DrawerStyleParams) => cn(
		"fixed",
		"inset-0",
		"z-50",
		open ?
			"pointer-events-auto" :
			"pointer-events-none",
	),

	backdrop: ({
		open,
	}: DrawerStyleParams) => cn(
		"absolute",
		"inset-0",
		"border-0",
		"bg-[var(--overlay-background)]",
		"transition-opacity",
		"duration-200",
		open ?
			"opacity-100" :
			"opacity-0",
	),

	drawer: ({
		open,
	}: DrawerStyleParams) => cn(
		"absolute",
		"inset-y-0",
		"left-0",
		"flex",
		"w-[min(20rem,calc(100vw-2rem))]",
		"flex-col",
		"border-r",
		"border-[var(--border-color)]",
		"bg-[var(--background-2)]",
		"shadow-2xl",
		"transition-transform",
		"duration-200",
		"ease-out",
		open ?
			"translate-x-0" :
			"-translate-x-full",
	),

	header: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-3",
		"border-b",
		"border-[var(--border-color)]",
		"px-4",
		"py-3",
	),

	title: cn(
		"text-sm",
		"font-bold",
		"text-[var(--font-color)]",
	),

	closeButton: cn(
		"inline-flex",
		"h-7",
		"w-7",
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
	),

	content: cn(
		"flex",
		"flex-col",
		"gap-3",
		"overflow-y-auto",
		"p-3.5",
	),

	section: cn(
		"rounded-lg",
		"border",
		"border-[var(--border-color)]",
		"p-2.5",
	),

	sectionTitle: cn(
		"mb-2.5",
		"text-[10px]",
		"font-bold",
		"uppercase",
		"tracking-wide",
		"text-[var(--font-color-muted)]",
	),

	selectField: cn(
		"flex",
		"flex-col",
		"gap-1.5",
	),

	selectLabel: cn(
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
	),

	select: cn(
		"min-h-8",
		"w-full",
		"rounded-md",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"px-2.5",
		"text-[11px]",
		"text-[var(--font-color)]",
		"outline-none",
		"focus:border-[var(--focus-border-color)]",
		"focus:ring-2",
		"focus:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:bg-[var(--background-3)]",
		"disabled:text-[var(--font-color-muted)]",
	),

	selectDescription: cn(
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	historySettings: cn(
		"flex",
		"flex-col",
		"gap-2",
	),

	numberField: cn(
		"flex",
		"items-center",
		"justify-between",
		"gap-3",
		"rounded-md",
		"border",
		"border-[var(--border-color)]",
		"bg-[var(--background-3)]",
		"p-2",
	),

	numberFieldText: cn(
		"flex",
		"min-w-0",
		"flex-1",
		"flex-col",
		"gap-0.5",
	),

	numberInput: cn(
		"h-8",
		"w-16",
		"shrink-0",
		"rounded-md",
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"px-2",
		"text-center",
		"text-[11px]",
		"font-semibold",
		"text-[var(--font-color-secondary)]",
		"outline-none",
		"focus:border-[var(--focus-border-color)]",
		"focus:ring-2",
		"focus:ring-[var(--focus-ring-color)]",
		"disabled:cursor-not-allowed",
		"disabled:bg-[var(--background-3)]",
		"disabled:text-[var(--font-color-muted)]",
	),

	integrationAction: cn(
		"flex",
		"flex-col",
		"gap-2",
	),

	integrationDescription: cn(
		"text-[10px]",
		"leading-4",
		"text-[var(--font-color-muted)]",
	),

	integrationButton: cn(
		"inline-flex",
		"min-h-8",
		"w-full",
		"max-w-28",
		"items-center",
		"justify-center",
		"self-center",
		"rounded-md",
		"border",
		"border-[var(--accent-button-color)]",
		"bg-[var(--accent-button-color)]",
		"px-3",
		"text-[11px]",
		"font-semibold",
		"text-[var(--button-font-color)]",
		"transition",
		"hover:border-[var(--accent-button-hover-color)]",
		"hover:bg-[var(--accent-button-hover-color)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-[var(--accent-focus-color)]",
		"disabled:cursor-not-allowed",
		"disabled:border-[var(--accent-button-disabled-color)]",
		"disabled:bg-[var(--accent-button-disabled-color)]",
		"disabled:text-[var(--button-font-color)]",
	),

	integrationStatusSuccess: cn(
		"text-[9px]",
		"leading-3.5",
		"text-[var(--success-font-color)]",
	),

	integrationStatusError: cn(
		"text-[9px]",
		"leading-3.5",
		"text-[var(--danger-font-color)]",
	),

	settingsList: cn(
		"flex",
		"flex-col",
		"gap-2.5",
	),
} as const
