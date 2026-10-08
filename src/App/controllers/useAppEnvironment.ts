import type { AppState } from "./useAppState"
import type { useAppSettings } from "@/features/context/useAppSettings"
import type { ContextWorkspacePreferences } from "@/features/context/useContextWorkspace"
import { isVscodeAvailable } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { getVersion } from "@tauri-apps/api/app"
import {
	useEffect,
	useMemo,
} from "react"

type AppSettings = ReturnType<typeof useAppSettings>

export function useAppEnvironment(
	state: AppState,
	appSettings: AppSettings,
): ContextWorkspacePreferences {
	const { setAppVersion, setVscodeAvailable } = state

	useEffect(() => {
		let cancelled = false
		void getVersion()
			.then(version => {
				if (!cancelled)
					setAppVersion(version)
			})
			.catch(() => {
				if (!cancelled)
					setAppVersion("")
			})
		return () => { cancelled = true }
	}, [setAppVersion])

	useEffect(() => {
		let cancelled = false
		async function refresh(): Promise<void> {
			try {
				const available = await isVscodeAvailable()
				if (!cancelled)
					setVscodeAvailable(available)
			} catch {
				if (!cancelled)
					setVscodeAvailable(false)
			}
		}
		function handleFocus(): void { void refresh() }
		void refresh()
		window.addEventListener(
			"focus",
			handleFocus,
		)
		return () => {
			cancelled = true
			window.removeEventListener(
				"focus",
				handleFocus,
			)
		}
	}, [setVscodeAvailable])

	useEffect(() => {
		document.documentElement.lang = appSettings.locale
		document.title = translate(
			appSettings.locale,
			"app.name",
		)
	}, [appSettings.locale])

	return useMemo(() => ({
		locale: appSettings.locale,
		theme: appSettings.theme,
		workMode: appSettings.workMode,
		autoCopyContextAfterAdd: appSettings.autoCopyContextAfterAdd,
		autoCopyGeneratedReports: appSettings.autoCopyGeneratedReports,
		autoClearAfterExport: appSettings.autoClearAfterExport,
		clearLogsAfterCopy: appSettings.clearLogsAfterCopy,
		contextFilterHistoryLimit: appSettings.contextFilterHistoryLimit,
		contextHistoryLimit: appSettings.contextHistoryLimit,
		overlayUndoHistoryLimit: appSettings.overlayUndoHistoryLimit,
		diagnosticFileLimit: appSettings.diagnosticFileLimit,
		openExplorerOnAppStart: appSettings.openExplorerOnAppStart,
		openExplorerOnProjectOpen: appSettings.openExplorerOnProjectOpen,
		closeExplorerOnFolderClose: appSettings.closeExplorerOnFolderClose,
		closeExplorerOnAppExit: appSettings.closeExplorerOnAppExit,
		hideOpenProjectSubfolders: appSettings.hideOpenProjectSubfolders,
	}), [
		appSettings.autoClearAfterExport,
		appSettings.autoCopyContextAfterAdd,
		appSettings.autoCopyGeneratedReports,
		appSettings.clearLogsAfterCopy,
		appSettings.closeExplorerOnAppExit,
		appSettings.closeExplorerOnFolderClose,
		appSettings.contextFilterHistoryLimit,
		appSettings.contextHistoryLimit,
		appSettings.diagnosticFileLimit,
		appSettings.hideOpenProjectSubfolders,
		appSettings.locale,
		appSettings.openExplorerOnAppStart,
		appSettings.openExplorerOnProjectOpen,
		appSettings.overlayUndoHistoryLimit,
		appSettings.theme,
		appSettings.workMode,
	])
}
