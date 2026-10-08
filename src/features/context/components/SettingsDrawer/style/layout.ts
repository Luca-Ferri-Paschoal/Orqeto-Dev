import type { DrawerStyleParams } from "./types"
import { cn } from "@/shared/utils/cn"

export const layoutStyles = {
	overlay: ({ open }: DrawerStyleParams) => cn(
		"fixed",
		"inset-0",
		"z-50",
		open ?
			"pointer-events-auto" :
			"pointer-events-none",
	),
	backdrop: ({ open }: DrawerStyleParams) => cn(
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
	drawer: ({ open }: DrawerStyleParams) => cn(
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
		"orqeto-scroll-area",
		"flex",
		"min-h-0",
		"flex-1",
		"flex-col",
		"gap-3",
		"overflow-y-auto",
		"overscroll-contain",
		"p-3.5",
		"[&>section]:shrink-0",
	),
} as const
