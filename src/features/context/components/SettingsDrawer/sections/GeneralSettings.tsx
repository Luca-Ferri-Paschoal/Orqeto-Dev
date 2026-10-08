import { styles } from "../style"
import type { WorkflowPromptCopyStatus } from "../types"
import type {
	AppTheme,
	WorkMode,
} from "@/features/context/types"
import {
	type Locale,
	localeOptions,
	translate,
} from "@/infra/i18n"
import { CollapsiblePanel } from "@/shared/components/CollapsiblePanel"
import { Switch } from "@/shared/components/Switch"
import type { ChangeEvent } from "react"

interface Props {
	locale: Locale
	theme: AppTheme
	workMode: WorkMode
	disabled: boolean
	expanded: boolean
	workflowPromptCopyStatus: WorkflowPromptCopyStatus
	onExpandedChange: (expanded: boolean) => void
	onLocaleChange: (locale: Locale) => void
	onThemeChange: (theme: AppTheme) => void
	onWorkModeChange: (mode: WorkMode) => void
	onCopyWorkflowPrompt: () => void
	onResetCopyStatus: () => void
}

export function GeneralSettings(props: Props) {
	return (
		<CollapsiblePanel
			id="settings-general"
			label={translate(
				props.locale,
				"settings.general",
			)}
			open={props.expanded}
			onToggle={() => props.onExpandedChange(!props.expanded)}
		>
			<div className={styles.settingsList}>
				<label className={styles.selectField} htmlFor="app-locale">
					<span className={styles.selectLabel}>{translate(
						props.locale,
						"settings.language.label",
					)}</span>
					<select
						id="app-locale"
						className={styles.select}
						value={props.locale}
						disabled={props.disabled}
						onChange={(event: ChangeEvent<HTMLSelectElement>) => {
							const next = localeOptions.find(option => option.value === event.currentTarget.value)?.value
							if (next !== undefined)
								props.onLocaleChange(next)
						}}
					>
						{localeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
					</select>
				</label>
				<Switch
					checked={props.theme === "dark"}
					disabled={props.disabled}
					label={translate(
						props.locale,
						"settings.darkMode",
					)}
					onChange={enabled => props.onThemeChange(enabled ?
						"dark" :
						"light")}
				/>
				<div className={styles.workModeField}>
					<span className={styles.selectLabel}>{translate(
						props.locale,
						"settings.workMode.label",
					)}</span>
					<div className={styles.workModeControl} role="group" aria-label={translate(
						props.locale,
						"settings.workMode.label",
					)}>
						{(["files", "git"] as const).map(mode => (
							<button
								key={mode}
								type="button"
								disabled={props.disabled}
								aria-pressed={props.workMode === mode}
								className={styles.workModeButton({ selected: props.workMode === mode })}
								onClick={() => { props.onResetCopyStatus(); props.onWorkModeChange(mode) }}
							>
								{translate(
									props.locale,
									`settings.workMode.${mode}`,
								)}
							</button>
						))}
					</div>
					<div className={styles.promptAction}>
						<button type="button" className={styles.promptButton} disabled={props.disabled} onClick={props.onCopyWorkflowPrompt}>
							{translate(
								props.locale,
								"settings.workMode.copyPrompt",
							)}
						</button>
						{props.workflowPromptCopyStatus === "success" && <span className={styles.promptStatusSuccess} role="status">{translate(
							props.locale,
							"settings.workMode.promptCopied",
						)}</span>}
						{props.workflowPromptCopyStatus === "error" && <span className={styles.promptStatusError} role="alert">{translate(
							props.locale,
							"settings.workMode.promptCopyError",
						)}</span>}
					</div>
				</div>
			</div>
		</CollapsiblePanel>
	)
}
