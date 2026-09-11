import { styles } from "./style"
import type { ButtonHTMLAttributes } from "react"

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost"

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant
}

export function Button({
	variant = "primary",
	type = "button",
	className,
	...props
}: ButtonProps) {
	return (
		<button
			{...props}
			type={type}
			className={styles.button({
				variant,
				className,
			})}
		/>
	)
}
