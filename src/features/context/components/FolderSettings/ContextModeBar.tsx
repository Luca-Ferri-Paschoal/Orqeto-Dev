import { styles } from "./style"
import type { ContextSectionMode } from "./types"
import type { Locale } from "@/infra/i18n"
import { translate } from "@/infra/i18n"

interface Props {
	locale: Locale
	disabled: boolean
	selectedMode: ContextSectionMode
	modes: Array<{ mode: ContextSectionMode; label: string }>
	onChange: (mode: ContextSectionMode) => void
}

export function ContextModeBar({ locale, disabled, selectedMode, modes, onChange }: Props) {
	return (
		<div className={styles.contextModeBar} role="group" aria-label={translate(
			locale,
			"folder.contextMode.label",
		)}>
			{modes.map(option => (
				<button
					key={option.mode}
					type="button"
					aria-pressed={selectedMode === option.mode}
					className={styles.contextModeButton({ selected: selectedMode === option.mode })}
					disabled={disabled}
					onClick={() => onChange(option.mode)}
				>
					{option.label}
				</button>
			))}
		</div>
	)
}
