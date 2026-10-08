import type { AppController } from "../controllers/useAppController"
import { styles } from "../style"
import { translate } from "@/infra/i18n"
import { Settings } from "lucide-react"

type Props = { controller: AppController; appReady: boolean }

export function AppHeader({ controller, appReady }: Props) {
	const { appSettings, openSettings, state } = controller
	return (
		<header className={styles.header}>
			<h1 className={styles.title}>
				{translate(
					appSettings.locale,
					"app.name",
				)}
			</h1>
			<div className={styles.headerActions}>
				{state.appVersion && <div className={styles.version}>v{state.appVersion}</div>}
				<button
					type="button"
					aria-label={translate(
						appSettings.locale,
						"app.settings.open",
					)}
					title={translate(
						appSettings.locale,
						"settings.title",
					)}
					className={styles.settingsButton}
					disabled={!appReady || state.isRoutingApply || state.isSettingsOperationBusy}
					onClick={openSettings}
				>
					<Settings size={15} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
		</header>
	)
}
