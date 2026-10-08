import { styles } from "../style"
import type { VscodeExtensionInstallStatus } from "../types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { CollapsiblePanel } from "@/shared/components/CollapsiblePanel"
import { Switch } from "@/shared/components/Switch"

interface Props {
	locale: Locale
	disabled: boolean
	expanded: boolean
	hideOpenProjectSubfolders: boolean
	status: VscodeExtensionInstallStatus
	onExpandedChange: (expanded: boolean) => void
	onHideOpenProjectSubfoldersChange: (enabled: boolean) => void
	onInstall: () => void
}
export function VscodeSettings(props: Props) {
	return (
		<CollapsiblePanel id="settings-vscode" label={translate(
			props.locale,
			"settings.vscode",
		)} open={props.expanded} onToggle={() => props.onExpandedChange(!props.expanded)}>
			<div className={styles.settingsList}>
				<Switch checked={props.hideOpenProjectSubfolders} disabled={props.disabled} label={translate(
					props.locale,
					"settings.vscode.hideOpenSubfolders",
				)} onChange={props.onHideOpenProjectSubfoldersChange} />
			</div>
			<div className={styles.integrationAction}>
				<div className={styles.integrationRow}>
					<span className={styles.integrationLabel}>{translate(
						props.locale,
						"settings.vscode.extensionLabel",
					)}</span>
					<button type="button" className={styles.integrationButton} disabled={props.disabled || props.status === "installing"} aria-busy={props.status === "installing"} onClick={props.onInstall}>
						{translate(
							props.locale,
							"settings.vscode.install",
						)}
					</button>
				</div>
				{props.status === "success" && <p className={styles.integrationStatusSuccess} role="status">{translate(
					props.locale,
					"settings.vscode.success",
				)}</p>}
				{props.status === "error" && <p className={styles.integrationStatusError} role="alert">{translate(
					props.locale,
					"settings.vscode.error",
				)}</p>}
			</div>
		</CollapsiblePanel>
	)
}
