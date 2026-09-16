import { cn } from "@/shared/utils/cn"

interface CollapsiblePanelStyleParams {
	open: boolean
}

export const styles = {
	panel: ({ open }: CollapsiblePanelStyleParams) => cn(
		"overflow-hidden",
		"rounded-lg",
		"border",
		"bg-[var(--background-2)]",
		"transition-[border-color,box-shadow]",
		"duration-200",
		open ?
			[
				"border-[var(--border-color-strong)]",
				"shadow-sm",
			] :
			"border-[var(--border-color)]",
	),

	trigger: ({ open }: CollapsiblePanelStyleParams) => cn(
		"group",
		"flex",
		"min-h-10",
		"w-full",
		"items-center",
		"justify-between",
		"gap-3",
		"px-3",
		"py-2.5",
		"text-left",
		"transition-colors",
		"duration-200",
		"motion-reduce:transition-none",
		"hover:bg-[var(--background-3)]",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-inset",
		"focus-visible:ring-[var(--focus-ring-color)]",
		open && "bg-[var(--background-3)]",
	),

	label: cn(
		"min-w-0",
		"flex-1",
		"text-[11px]",
		"font-bold",
		"uppercase",
		"tracking-wide",
		"text-[var(--font-color-secondary)]",
	),

	chevron: ({ open }: CollapsiblePanelStyleParams) => cn(
		"size-4",
		"shrink-0",
		"text-[var(--font-color-muted)]",
		"transition-transform",
		"duration-200",
		"ease-out",
		"motion-reduce:transition-none",
		"group-hover:text-[var(--font-color-secondary)]",
		open && "rotate-180",
	),

	content: cn(
		"border-t",
		"border-[var(--border-color)]",
		"p-2.5",
	),
} as const
