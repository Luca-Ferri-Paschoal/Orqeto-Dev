import { styles } from "./style"
import {
	HISTORY_LIMIT_MAX,
	HISTORY_LIMIT_MIN,
} from "@/features/context/types"
import type { ChangeEvent } from "react"

interface Props {
	id: string
	label: string
	value: number
	disabled: boolean
	onChange: (value: number) => void
}

export function HistoryLimitField({ id, label, value, disabled, onChange }: Props) {
	return (
		<label className={styles.numberField} htmlFor={id}>
			<span className={styles.numberFieldText}><span className={styles.selectLabel}>{label}</span></span>
			<input
				id={id}
				type="number"
				min={HISTORY_LIMIT_MIN}
				max={HISTORY_LIMIT_MAX}
				step={1}
				inputMode="numeric"
				className={styles.numberInput}
				value={value}
				disabled={disabled}
				onChange={(event: ChangeEvent<HTMLInputElement>) => {
					const nextValue = Number(event.currentTarget.value)
					if (Number.isInteger(nextValue) && nextValue >= HISTORY_LIMIT_MIN && nextValue <= HISTORY_LIMIT_MAX)
						onChange(nextValue)
				}}
			/>
		</label>
	)
}
