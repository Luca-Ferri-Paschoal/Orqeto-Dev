import type { ButtonVariant } from "."
import { cn } from "@/shared/utils/cn"

interface ButtonStyleParams {
	variant: ButtonVariant
	className?: string
}

const variantStyles: Record<ButtonVariant, string> = {
	primary: cn(
		"bg-[var(--button-color)]",
		"text-[var(--button-font-color)]",
		"hover:bg-[var(--button-hover-color)]",
		"focus-visible:ring-[var(--focus-ring-color)]",
	),
	secondary: cn(
		"border",
		"border-[var(--border-color-strong)]",
		"bg-[var(--background-2)]",
		"text-[var(--font-color-secondary)]",
		"hover:bg-[var(--background-3)]",
		"focus-visible:ring-[var(--focus-ring-color)]",
	),
	danger: cn(
		"border",
		"border-[var(--danger-border-color)]",
		"bg-[var(--danger-background)]",
		"text-[var(--danger-font-color)]",
		"hover:bg-[var(--danger-background-hover)]",
		"focus-visible:ring-[var(--danger-focus-color)]",
	),
	ghost: cn(
		"bg-transparent",
		"text-[var(--font-color-secondary)]",
		"hover:bg-[var(--background-3)]",
		"focus-visible:ring-[var(--focus-ring-color)]",
	),
}

export const styles = {
	button: ({
		variant,
		className,
	}: ButtonStyleParams) => cn(
		"inline-flex",
		"min-h-8",
		"items-center",
		"justify-center",
		"rounded-md",
		"px-3",
		"py-1.5",
		"text-[11px]",
		"font-semibold",
		"transition",
		"focus-visible:outline-none",
		"focus-visible:ring-2",
		"focus-visible:ring-offset-2",
		"disabled:cursor-not-allowed",
		"disabled:opacity-50",
		variantStyles[variant],
		className,
	),
} as const
