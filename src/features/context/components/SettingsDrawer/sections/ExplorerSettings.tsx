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
	openExplorerOnAppStart: boolean
	openExplorerOnProjectOpen: boolean
	closeExplorerOnFolderClose: boolean
	closeExplorerOnAppExit: boolean
	onExpandedChange: (expanded: boolean) => void
	onOpenExplorerOnAppStartChange: (enabled: boolean) => void
	onOpenExplorerOnProjectOpenChange: (enabled: boolean) => void
	onCloseExplorerOnFolderCloseChange: (enabled: boolean) => void
	onCloseExplorerOnAppExitChange: (enabled: boolean) => void
}
export function ExplorerSettings(props: Props) {
	return (
		<CollapsiblePanel id="settings-explorer" label={translate(
			props.locale,
			"settings.explorer",
		)} open={props.expanded} onToggle={() => props.onExpandedChange(!props.expanded)}>
			<div className={styles.settingsList}>
				<Switch checked={props.openExplorerOnAppStart} disabled={props.disabled} label={translate(
					props.locale,
					"settings.openExplorerStart",
				)} onChange={props.onOpenExplorerOnAppStartChange} />
				<Switch checked={props.openExplorerOnProjectOpen} disabled={props.disabled} label={translate(
					props.locale,
					"settings.openExplorerProject",
				)} onChange={props.onOpenExplorerOnProjectOpenChange} />
				<Switch checked={props.closeExplorerOnFolderClose} disabled={props.disabled} label={translate(
					props.locale,
					"settings.closeExplorerFolder",
				)} onChange={props.onCloseExplorerOnFolderCloseChange} />
				<Switch checked={props.closeExplorerOnAppExit} disabled={props.disabled} label={translate(
					props.locale,
					"settings.closeExplorerApp",
				)} onChange={props.onCloseExplorerOnAppExitChange} />
			</div>
		</CollapsiblePanel>
	)
}
