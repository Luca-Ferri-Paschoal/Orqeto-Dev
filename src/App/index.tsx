import { AppHeader } from "./components/AppHeader"
import { AppProjectTabs } from "./components/AppProjectTabs"
import { AppSettingsPanel } from "./components/AppSettingsPanel"
import { AppWorkspaceStage } from "./components/AppWorkspaceStage"
import { useAppController } from "./controllers/useAppController"
import { styles } from "./style"
import { BootLoadingOverlayCleanup } from "@/shared/components/BootLoadingOverlayCleanup"
import OverlayScrollbarManager from "@/shared/components/OverlayScrollbarManager"

export function App() {
	const controller = useAppController()
	const appReady = controller.appSettings.isReady && controller.state.tabsReady

	return (
		<>
			<main
				inert={!appReady}
				aria-busy={!appReady}
				className={styles.page}
			>
				<OverlayScrollbarManager />
				<div className={styles.shell}>
					<AppHeader controller={controller} appReady={appReady} />
					<AppProjectTabs controller={controller} appReady={appReady} />
					<AppWorkspaceStage controller={controller} />
				</div>
				<AppSettingsPanel controller={controller} />
			</main>
			<BootLoadingOverlayCleanup ready={appReady} />
		</>
	)
}
