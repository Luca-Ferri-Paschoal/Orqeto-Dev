import {
	type AppNotice,
	type AppSettings,
	type AppTheme,
	DEFAULT_APP_SETTINGS,
	type FolderAction,
	type WorkMode,
} from "./types"
import { getErrorMessage } from "@/features/context/utils"
import {
	getAppSettings,
	setApplySectionExpandedSetting,
	setAutoClearAfterExportSetting,
	setAutoCopyContextAfterAddSetting,
	setAutoCopyGeneratedReportsSetting,
	setClearLogsAfterCopySetting,
	setCloseExplorerOnAppExitSetting,
	setCloseExplorerOnFolderCloseSetting,
	setContextFilterHistoryLimitSetting,
	setContextHistoryLimitSetting,
	setContextSectionExpandedSetting,
	setDiagnosticFileLimitSetting,
	setFolderActionSetting,
	setFolderSectionExpandedSetting,
	setHideOpenProjectSubfoldersSetting,
	setLocaleSetting,
	setOpenExplorerOnAppStartSetting,
	setOpenExplorerOnProjectOpenSetting,
	setOverlayUndoHistoryLimitSetting,
	setSettingsContextExpandedSetting,
	setSettingsExplorerExpandedSetting,
	setSettingsGeneralExpandedSetting,
	setSettingsHistoryExpandedSetting,
	setSettingsVscodeExpandedSetting,
	setThemeSetting,
	setWorkModeSetting,
} from "@/infra/configDatabase"
import type { Locale } from "@/infra/i18n"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

function applyTheme(theme: AppTheme): void {
	document.documentElement.dataset.theme = theme
	document.documentElement.style.colorScheme = theme
}

export function useAppSettings() {
	const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS })
	const [notice, setNotice] = useState<AppNotice | null>(null)
	const [isReady, setIsReady] = useState(false)
	const localeRef = useRef(settings.locale)
	const persistedSettingsRef = useRef<AppSettings>({ ...DEFAULT_APP_SETTINGS })
	const settingRevisionRef = useRef<Partial<Record<keyof AppSettings, number>>>({})
	const settingWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

	useEffect(() => {
		localeRef.current = settings.locale
	}, [settings.locale])

	useEffect(() => {
		applyTheme(settings.theme)
	}, [settings.theme])

	const persistSetting = useCallback(async <Key extends keyof AppSettings>(
		key: Key,
		nextValue: AppSettings[Key],
		persist: () => Promise<void>,
	): Promise<void> => {
		const revision = (settingRevisionRef.current[key] ?? 0) + 1
		settingRevisionRef.current[key] = revision
		setSettings(current => ({ ...current, [key]: nextValue }))
		const operation = settingWriteQueueRef.current.then(async () => {
			await persist()
			persistedSettingsRef.current[key] = nextValue
		})
		settingWriteQueueRef.current = operation.catch(() => undefined)
		try {
			await operation
		} catch (error) {
			if (settingRevisionRef.current[key] === revision) {
				const persistedValue = persistedSettingsRef.current[key]
				setSettings(current => ({ ...current, [key]: persistedValue }))
			}
			setNotice({
				kind: "error",
				message: getErrorMessage(
					error,
					localeRef.current,
				),
			})
		}
	}, [])

	const flushPendingWrites = useCallback(async (): Promise<void> => {
		await settingWriteQueueRef.current.catch(() => undefined)
	}, [])

	useEffect(() => {
		let cancelled = false
		async function initialize(): Promise<void> {
			try {
				const loaded = await getAppSettings()
				if (cancelled)
					return
				persistedSettingsRef.current = loaded
				setSettings(loaded)
			} catch (error) {
				if (!cancelled) {
					setNotice({
						kind: "error",
						message: getErrorMessage(
							error,
							"pt-BR",
						),
					})
				}
			} finally {
				if (!cancelled)
					setIsReady(true)
			}
		}
		void initialize()
		return () => { cancelled = true }
	}, [])

	return {
		...settings,
		notice,
		isReady,
		setNotice,
		updateLocale: (value: Locale) => persistSetting(
			"locale",
			value,
			() => setLocaleSetting(value),
		),
		updateTheme: (value: AppTheme) => persistSetting(
			"theme",
			value,
			() => setThemeSetting(value),
		),
		updateWorkMode: (value: WorkMode) => persistSetting(
			"workMode",
			value,
			() => setWorkModeSetting(value),
		),
		updateAutoCopyContextAfterAdd: (value: boolean) => persistSetting(
			"autoCopyContextAfterAdd",
			value,
			() => setAutoCopyContextAfterAddSetting(value),
		),
		updateAutoCopyGeneratedReports: (value: boolean) => persistSetting(
			"autoCopyGeneratedReports",
			value,
			() => setAutoCopyGeneratedReportsSetting(value),
		),
		updateAutoClearAfterExport: (value: boolean) => persistSetting(
			"autoClearAfterExport",
			value,
			() => setAutoClearAfterExportSetting(value),
		),
		updateClearLogsAfterCopy: (value: boolean) => persistSetting(
			"clearLogsAfterCopy",
			value,
			() => setClearLogsAfterCopySetting(value),
		),
		updateContextFilterHistoryLimit: (value: number) => persistSetting(
			"contextFilterHistoryLimit",
			value,
			() => setContextFilterHistoryLimitSetting(value),
		),
		updateContextHistoryLimit: (value: number) => persistSetting(
			"contextHistoryLimit",
			value,
			() => setContextHistoryLimitSetting(value),
		),
		updateOverlayUndoHistoryLimit: (value: number) => persistSetting(
			"overlayUndoHistoryLimit",
			value,
			() => setOverlayUndoHistoryLimitSetting(value),
		),
		updateDiagnosticFileLimit: (value: number) => persistSetting(
			"diagnosticFileLimit",
			value,
			() => setDiagnosticFileLimitSetting(value),
		),
		updateOpenExplorerOnAppStart: (value: boolean) => persistSetting(
			"openExplorerOnAppStart",
			value,
			() => setOpenExplorerOnAppStartSetting(value),
		),
		updateOpenExplorerOnProjectOpen: (value: boolean) => persistSetting(
			"openExplorerOnProjectOpen",
			value,
			() => setOpenExplorerOnProjectOpenSetting(value),
		),
		updateCloseExplorerOnFolderClose: (value: boolean) => persistSetting(
			"closeExplorerOnFolderClose",
			value,
			() => setCloseExplorerOnFolderCloseSetting(value),
		),
		updateCloseExplorerOnAppExit: (value: boolean) => persistSetting(
			"closeExplorerOnAppExit",
			value,
			() => setCloseExplorerOnAppExitSetting(value),
		),
		updateHideOpenProjectSubfolders: (value: boolean) => persistSetting(
			"hideOpenProjectSubfolders",
			value,
			() => setHideOpenProjectSubfoldersSetting(value),
		),
		updateFolderAction: (value: FolderAction) => persistSetting(
			"folderAction",
			value,
			() => setFolderActionSetting(value),
		),
		updateFolderSectionExpanded: (value: boolean) => persistSetting(
			"folderSectionExpanded",
			value,
			() => setFolderSectionExpandedSetting(value),
		),
		updateContextSectionExpanded: (value: boolean) => persistSetting(
			"contextSectionExpanded",
			value,
			() => setContextSectionExpandedSetting(value),
		),
		updateApplySectionExpanded: (value: boolean) => persistSetting(
			"applySectionExpanded",
			value,
			() => setApplySectionExpandedSetting(value),
		),
		updateSettingsGeneralExpanded: (value: boolean) => persistSetting(
			"settingsGeneralExpanded",
			value,
			() => setSettingsGeneralExpandedSetting(value),
		),
		updateSettingsContextExpanded: (value: boolean) => persistSetting(
			"settingsContextExpanded",
			value,
			() => setSettingsContextExpandedSetting(value),
		),
		updateSettingsHistoryExpanded: (value: boolean) => persistSetting(
			"settingsHistoryExpanded",
			value,
			() => setSettingsHistoryExpandedSetting(value),
		),
		updateSettingsVscodeExpanded: (value: boolean) => persistSetting(
			"settingsVscodeExpanded",
			value,
			() => setSettingsVscodeExpandedSetting(value),
		),
		updateSettingsExplorerExpanded: (value: boolean) => persistSetting(
			"settingsExplorerExpanded",
			value,
			() => setSettingsExplorerExpandedSetting(value),
		),
		flushPendingWrites,
	}
}
