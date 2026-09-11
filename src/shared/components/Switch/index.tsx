import { styles } from "./style"

export interface SwitchProps {
	checked: boolean
	disabled?: boolean
	label: string
	description?: string
	onChange: (checked: boolean) => void
}

export function Switch({
	checked,
	disabled = false,
	label,
	description,
	onChange,
}: SwitchProps) {
	return (
		<div className={styles.container}>
			<div className={styles.copy}>
				<span className={styles.label}>
					{label}
				</span>

				{description && (
					<span className={styles.description}>
						{description}
					</span>
				)}
			</div>

			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={label}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={styles.switch({
					checked,
				})}
			>
				<span
					className={styles.thumb({
						checked,
					})}
				/>
			</button>
		</div>
	)
}
