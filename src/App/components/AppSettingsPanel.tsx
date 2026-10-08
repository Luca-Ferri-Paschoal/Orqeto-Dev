import type { AppController } from "../controllers/useAppController"
import { SettingsDrawer } from "@/features/context/components/SettingsDrawer"

export function AppSettingsPanel({ controller }: { controller: AppController }) {
	const { appSettings, closeSettings, state } = controller
	return (
		<SettingsDrawer
			open={state.isSettingsOpen}
			locale={appSettings.locale}
			theme={appSettings.theme}
			workMode={appSettings.workMode}
			autoCopyContextAfterAdd={appSettings.autoCopyContextAfterAdd}
			autoCopyGeneratedReports={appSettings.autoCopyGeneratedReports}
			autoClearAfterExport={appSettings.autoClearAfterExport}
			clearLogsAfterCopy={appSettings.clearLogsAfterCopy}
			contextFilterHistoryLimit={appSettings.contextFilterHistoryLimit}
			contextHistoryLimit={appSettings.contextHistoryLimit}
			overlayUndoHistoryLimit={appSettings.overlayUndoHistoryLimit}
			diagnosticFileLimit={appSettings.diagnosticFileLimit}
			openExplorerOnAppStart={appSettings.openExplorerOnAppStart}
			openExplorerOnProjectOpen={appSettings.openExplorerOnProjectOpen}
			closeExplorerOnFolderClose={appSettings.closeExplorerOnFolderClose}
			closeExplorerOnAppExit={appSettings.closeExplorerOnAppExit}
			hideOpenProjectSubfolders={appSettings.hideOpenProjectSubfolders}
			settingsGeneralExpanded={appSettings.settingsGeneralExpanded}
			settingsContextExpanded={appSettings.settingsContextExpanded}
			settingsHistoryExpanded={appSettings.settingsHistoryExpanded}
			settingsVscodeExpanded={appSettings.settingsVscodeExpanded}
			settingsExplorerExpanded={appSettings.settingsExplorerExpanded}
			vscodeAvailable={state.vscodeAvailable}
			disabled={!appSettings.isReady || state.isRoutingApply || state.isSettingsOperationBusy}
			onBusyChange={state.setIsSettingsOperationBusy}
			onClose={closeSettings}
			onLocaleChange={nextLocale => void appSettings.updateLocale(nextLocale)}
			onThemeChange={theme => void appSettings.updateTheme(theme)}
			onWorkModeChange={workMode => void appSettings.updateWorkMode(workMode)}
			onAutoCopyContextAfterAddChange={enabled => void appSettings.updateAutoCopyContextAfterAdd(enabled)}
			onAutoCopyGeneratedReportsChange={enabled => void appSettings.updateAutoCopyGeneratedReports(enabled)}
			onAutoClearAfterExportChange={enabled => void appSettings.updateAutoClearAfterExport(enabled)}
			onClearLogsAfterCopyChange={enabled => void appSettings.updateClearLogsAfterCopy(enabled)}
			onContextFilterHistoryLimitChange={limit => void appSettings.updateContextFilterHistoryLimit(limit)}
			onContextHistoryLimitChange={limit => void appSettings.updateContextHistoryLimit(limit)}
			onOverlayUndoHistoryLimitChange={limit => void appSettings.updateOverlayUndoHistoryLimit(limit)}
			onDiagnosticFileLimitChange={limit => void appSettings.updateDiagnosticFileLimit(limit)}
			onOpenExplorerOnAppStartChange={enabled => void appSettings.updateOpenExplorerOnAppStart(enabled)}
			onOpenExplorerOnProjectOpenChange={enabled => void appSettings.updateOpenExplorerOnProjectOpen(enabled)}
			onCloseExplorerOnFolderCloseChange={enabled => void appSettings.updateCloseExplorerOnFolderClose(enabled)}
			onCloseExplorerOnAppExitChange={enabled => void appSettings.updateCloseExplorerOnAppExit(enabled)}
			onHideOpenProjectSubfoldersChange={enabled => void appSettings.updateHideOpenProjectSubfolders(enabled)}
			onSettingsGeneralExpandedChange={expanded => void appSettings.updateSettingsGeneralExpanded(expanded)}
			onSettingsContextExpandedChange={expanded => void appSettings.updateSettingsContextExpanded(expanded)}
			onSettingsHistoryExpandedChange={expanded => void appSettings.updateSettingsHistoryExpanded(expanded)}
			onSettingsVscodeExpandedChange={expanded => void appSettings.updateSettingsVscodeExpanded(expanded)}
			onSettingsExplorerExpandedChange={expanded => void appSettings.updateSettingsExplorerExpanded(expanded)}
		/>
	)
}
