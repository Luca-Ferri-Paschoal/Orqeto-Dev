import { HistoryLimitField } from "../HistoryLimitField"
import { styles } from "../style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { CollapsiblePanel } from "@/shared/components/CollapsiblePanel"

interface Props {
	locale: Locale
	disabled: boolean
	expanded: boolean
	contextHistoryLimit: number
	contextFilterHistoryLimit: number
	overlayUndoHistoryLimit: number
	onExpandedChange: (expanded: boolean) => void
	onContextHistoryLimitChange: (limit: number) => void
	onContextFilterHistoryLimitChange: (limit: number) => void
	onOverlayUndoHistoryLimitChange: (limit: number) => void
}
export function HistorySettings(props: Props) {
	return (
		<CollapsiblePanel id="settings-history" label={translate(
			props.locale,
			"settings.history",
		)} open={props.expanded} onToggle={() => props.onExpandedChange(!props.expanded)}>
			<div className={styles.historySettings}>
				<HistoryLimitField id="context-history-limit" label={translate(
					props.locale,
					"settings.contextHistoryLimit",
				)} value={props.contextHistoryLimit} disabled={props.disabled} onChange={props.onContextHistoryLimitChange} />
				<HistoryLimitField id="filter-history-limit" label={translate(
					props.locale,
					"settings.filterHistoryLimit",
				)} value={props.contextFilterHistoryLimit} disabled={props.disabled} onChange={props.onContextFilterHistoryLimitChange} />
				<HistoryLimitField id="apply-history-limit" label={translate(
					props.locale,
					"settings.applyHistoryLimit",
				)} value={props.overlayUndoHistoryLimit} disabled={props.disabled} onChange={props.onOverlayUndoHistoryLimitChange} />
			</div>
		</CollapsiblePanel>
	)
}
