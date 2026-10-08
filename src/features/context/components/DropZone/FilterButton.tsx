import { styles } from "./style"

interface Props<TValue extends string> {
	value: TValue
	selectedValue: TValue
	label: string
	disabled: boolean
	onChange: (value: TValue) => void
}
export function FilterButton<TValue extends string>({ value, selectedValue, label, disabled, onChange }: Props<TValue>) {
	return (
		<button type="button" className={styles.filterButton({ selected: value === selectedValue })} disabled={disabled} onClick={() => onChange(value)}>
			{label}
		</button>
	)
}
