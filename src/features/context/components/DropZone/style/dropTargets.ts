import type {
	DropZoneIconStyleParams,
	DropZoneStyleParams,
} from "./types"
import { cn } from "@/shared/utils/cn"

export const dropTargetStyles = {
	zones: cn(
		"grid",
		"grid-cols-[minmax(0,7fr)_minmax(6.75rem,3fr)]",
		"gap-2",
	),
	zone: ({
		enabled,
		isDragging,
		variant,
	}: DropZoneStyleParams) => cn(
		"relative",
		"z-0",
		"flex",
		"min-h-28",
		"min-w-0",
		"items-center",
		"justify-center",
		"gap-2",
		"rounded-lg",
		"border-2",
		"border-dashed",
		"px-2.5",
		"py-2",
		"text-center",
		"transition",
		enabled ?
			"cursor-copy" :
			"cursor-not-allowed",
		!enabled ?
			["border-[var(--border-color)]", "bg-[var(--background-3)]", "opacity-70"] :
			variant === "remove" ?
				["border-[var(--danger-border-color)]", "bg-[var(--danger-background)]"] :
				["border-[var(--border-color-strong)]", "bg-[var(--background-3)]"],
		isDragging && enabled ?
			variant === "remove" ?
				["border-[var(--danger-border-strong-color)]", "bg-[var(--danger-background-hover)]", "shadow-md"] :
				["border-[var(--button-color)]", "bg-[var(--background-2)]", "shadow-md"] :
			undefined,
	),
	icon: ({ variant }: DropZoneIconStyleParams) => cn(
		"flex",
		"h-6",
		"w-6",
		"shrink-0",
		"items-center",
		"justify-center",
		"rounded-md",
		"text-xs",
		"font-bold",
		"text-[var(--button-font-color)]",
		variant === "remove" ?
			"bg-[var(--danger-button-color)]" :
			"bg-[var(--button-color)]",
	),
	title: cn(
		"min-w-0",
		"text-[11px]",
		"font-bold",
		"leading-4",
		"text-[var(--font-color)]",
	),
} as const
