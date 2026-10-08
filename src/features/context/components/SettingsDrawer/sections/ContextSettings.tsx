import { HistoryLimitField } from "../HistoryLimitField"
import { styles } from "../style"
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
	autoCopyContextAfterAdd: boolean
	autoCopyGeneratedReports: boolean
	autoClearAfterExport: boolean
	clearLogsAfterCopy: boolean
	diagnosticFileLimit: number
	onExpandedChange: (expanded: boolean) => void
	onAutoCopyContextAfterAddChange: (enabled: boolean) => void
	onAutoCopyGeneratedReportsChange: (enabled: boolean) => void
	onAutoClearAfterExportChange: (enabled: boolean) => void
	onClearLogsAfterCopyChange: (enabled: boolean) => void
	onDiagnosticFileLimitChange: (limit: number) => void
}
export function ContextSettings(props: Props) {
	return (
		<CollapsiblePanel id="settings-context" label={translate(
			props.locale,
			"settings.context",
		)} open={props.expanded} onToggle={() => props.onExpandedChange(!props.expanded)}>
			<div className={styles.settingsList}>
				<Switch checked={props.autoCopyContextAfterAdd} disabled={props.disabled} label={translate(
					props.locale,
					"settings.autoCopy",
				)} onChange={props.onAutoCopyContextAfterAddChange} />
				<Switch checked={props.autoCopyGeneratedReports} disabled={props.disabled} label={translate(
					props.locale,
					"settings.autoCopyGeneratedReports",
				)} onChange={props.onAutoCopyGeneratedReportsChange} />
				<Switch checked={props.autoClearAfterExport} disabled={props.disabled} label={translate(
					props.locale,
					"settings.autoClear",
				)} onChange={props.onAutoClearAfterExportChange} />
				<Switch checked={props.clearLogsAfterCopy} disabled={props.disabled} label={translate(
					props.locale,
					"settings.clearLogsAfterCopy",
				)} onChange={props.onClearLogsAfterCopyChange} />
				<HistoryLimitField id="diagnostic-file-limit" label={translate(
					props.locale,
					"settings.diagnosticFileLimit",
				)} value={props.diagnosticFileLimit} disabled={props.disabled} onChange={props.onDiagnosticFileLimitChange} />
			</div>
		</CollapsiblePanel>
	)
}
