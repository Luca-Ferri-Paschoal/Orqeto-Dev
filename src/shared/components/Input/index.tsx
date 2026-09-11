import { styles } from "./style"
import {
	type InputHTMLAttributes,
	type ReactNode,
} from "react"

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
	label?: string
	description?: string
	error?: string
	suffix?: ReactNode
}

export function Input({
	label,
	description,
	suffix,
	id,
	error,
	className,
	...props
}: InputProps) {
	const feedback = error ?? description
	const feedbackId = id && feedback ?
		`${id}-feedback` :
		undefined

	return (
		<div className={styles.container}>
			{label && (
				<label
					htmlFor={id}
					className={styles.label}
				>
					{label}
				</label>
			)}

			<div className={styles.control}>
				<input
					{...props}
					id={id}
					aria-invalid={error ?
						true :
						undefined}
					aria-describedby={feedbackId}
					className={styles.input({
						hasError: Boolean(error),
						className,
					})}
				/>

				{suffix && (
					<span className={styles.suffix}>
						{suffix}
					</span>
				)}
			</div>

			{feedback && (
				<p
					id={feedbackId}
					className={styles.feedback({
						hasError: Boolean(error),
					})}
				>
					{feedback}
				</p>
			)}
		</div>
	)
}
