import {
	type AppNotice,
	type AppSettings,
	type AppTheme,
	DEFAULT_APP_THEME,
	DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
	DEFAULT_CONTEXT_HISTORY_LIMIT,
	DEFAULT_DIAGNOSTIC_FILE_LIMIT,
	DEFAULT_FOLDER_ACTION,
	DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS,
	DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
	DEFAULT_WORK_MODE,
	type FolderAction,
	type WorkMode,
} from "./types"
import { getErrorMessage } from "@/features/context/utils"
import {
	getAppSettings,
	setApplySectionExpandedSetting,
	setAutoClearAfterExportSetting,
	setAutoCopyContextAfterAddSetting,
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
	const [locale, setLocale] = useState<Locale>("pt-BR")
	const [theme, setTheme] = useState<AppTheme>(DEFAULT_APP_THEME)
	const [workMode, setWorkMode] = useState<WorkMode>(DEFAULT_WORK_MODE)
	const [autoCopyContextAfterAdd, setAutoCopyContextAfterAdd] = useState(false)
	const [autoClearAfterExport, setAutoClearAfterExport] = useState(false)
	const [contextFilterHistoryLimit, setContextFilterHistoryLimit] = useState(DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT)
	const [contextHistoryLimit, setContextHistoryLimit] = useState(DEFAULT_CONTEXT_HISTORY_LIMIT)
	const [overlayUndoHistoryLimit, setOverlayUndoHistoryLimit] = useState(DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT)
	const [diagnosticFileLimit, setDiagnosticFileLimit] = useState(DEFAULT_DIAGNOSTIC_FILE_LIMIT)
	const [openExplorerOnAppStart, setOpenExplorerOnAppStart] = useState(true)
	const [openExplorerOnProjectOpen, setOpenExplorerOnProjectOpen] = useState(true)
	const [closeExplorerOnFolderClose, setCloseExplorerOnFolderClose] = useState(false)
	const [closeExplorerOnAppExit, setCloseExplorerOnAppExit] = useState(false)
	const [hideOpenProjectSubfolders, setHideOpenProjectSubfolders] = useState(DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS)
	const [folderAction, setFolderAction] = useState<FolderAction>(DEFAULT_FOLDER_ACTION)
	const [folderSectionExpanded, setFolderSectionExpanded] = useState(true)
	const [contextSectionExpanded, setContextSectionExpanded] = useState(true)
	const [applySectionExpanded, setApplySectionExpanded] = useState(true)
	const [settingsGeneralExpanded, setSettingsGeneralExpanded] = useState(true)
	const [settingsContextExpanded, setSettingsContextExpanded] = useState(false)
	const [settingsHistoryExpanded, setSettingsHistoryExpanded] = useState(false)
	const [settingsVscodeExpanded, setSettingsVscodeExpanded] = useState(false)
	const [settingsExplorerExpanded, setSettingsExplorerExpanded] = useState(false)
	const [notice, setNotice] = useState<AppNotice | null>(null)
	const [isReady, setIsReady] = useState(false)

	const localeRef = useRef(locale)
	const persistedSettingsRef = useRef<AppSettings>({
		locale: "pt-BR",
		theme: DEFAULT_APP_THEME,
		workMode: DEFAULT_WORK_MODE,
		autoCopyContextAfterAdd: false,
		autoClearAfterExport: false,
		contextFilterHistoryLimit: DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
		contextHistoryLimit: DEFAULT_CONTEXT_HISTORY_LIMIT,
		overlayUndoHistoryLimit: DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
		diagnosticFileLimit: DEFAULT_DIAGNOSTIC_FILE_LIMIT,
		openExplorerOnAppStart: true,
		openExplorerOnProjectOpen: true,
		closeExplorerOnFolderClose: false,
		closeExplorerOnAppExit: false,
		hideOpenProjectSubfolders: DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS,
		folderAction: DEFAULT_FOLDER_ACTION,
		folderSectionExpanded: true,
		contextSectionExpanded: true,
		applySectionExpanded: true,
		settingsGeneralExpanded: true,
		settingsContextExpanded: false,
		settingsHistoryExpanded: false,
		settingsVscodeExpanded: false,
		settingsExplorerExpanded: false,
	})
	const settingRevisionRef = useRef<Partial<Record<keyof AppSettings, number>>>({})
	const settingWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

	useEffect(
		() => {
			localeRef.current = locale
		},
		[locale],
	)

	const persistSetting = useCallback(
		async <Key extends keyof AppSettings>(
			key: Key,
			nextValue: AppSettings[Key],
			persist: () => Promise<void>,
			apply: (value: AppSettings[Key]) => void,
		): Promise<void> => {
			const revision = (settingRevisionRef.current[key] ?? 0) + 1
			settingRevisionRef.current[key] = revision
			apply(nextValue)

			const operation = settingWriteQueueRef.current.then(async () => {
				await persist()
				persistedSettingsRef.current[key] = nextValue
			})
			settingWriteQueueRef.current = operation.catch(() => undefined)

			try {
				await operation
			} catch (error) {
				if (settingRevisionRef.current[key] === revision)
					apply(persistedSettingsRef.current[key])

				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						localeRef.current,
					),
				})
			}
		},
		[],
	)

	const updateLocale = useCallback(
		async (nextLocale: Locale) => persistSetting(
			"locale",
			nextLocale,
			() => setLocaleSetting(nextLocale),
			setLocale,
		),
		[persistSetting],
	)

	const updateTheme = useCallback(
		async (nextTheme: AppTheme) => persistSetting(
			"theme",
			nextTheme,
			() => setThemeSetting(nextTheme),
			value => {
				setTheme(value)
				applyTheme(value)
			},
		),
		[persistSetting],
	)

	const updateWorkMode = useCallback(
		async (nextWorkMode: WorkMode) => persistSetting(
			"workMode",
			nextWorkMode,
			() => setWorkModeSetting(nextWorkMode),
			setWorkMode,
		),
		[persistSetting],
	)

	const updateAutoCopyContextAfterAdd = useCallback(
		async (enabled: boolean) => persistSetting(
			"autoCopyContextAfterAdd",
			enabled,
			() => setAutoCopyContextAfterAddSetting(enabled),
			setAutoCopyContextAfterAdd,
		),
		[persistSetting],
	)

	const updateAutoClearAfterExport = useCallback(
		async (enabled: boolean) => persistSetting(
			"autoClearAfterExport",
			enabled,
			() => setAutoClearAfterExportSetting(enabled),
			setAutoClearAfterExport,
		),
		[persistSetting],
	)

	const updateContextFilterHistoryLimit = useCallback(
		async (limit: number) => persistSetting(
			"contextFilterHistoryLimit",
			limit,
			() => setContextFilterHistoryLimitSetting(limit),
			setContextFilterHistoryLimit,
		),
		[persistSetting],
	)

	const updateContextHistoryLimit = useCallback(
		async (limit: number) => persistSetting(
			"contextHistoryLimit",
			limit,
			() => setContextHistoryLimitSetting(limit),
			setContextHistoryLimit,
		),
		[persistSetting],
	)

	const updateOverlayUndoHistoryLimit = useCallback(
		async (limit: number) => persistSetting(
			"overlayUndoHistoryLimit",
			limit,
			() => setOverlayUndoHistoryLimitSetting(limit),
			setOverlayUndoHistoryLimit,
		),
		[persistSetting],
	)

	const updateDiagnosticFileLimit = useCallback(
		async (limit: number) => persistSetting(
			"diagnosticFileLimit",
			limit,
			() => setDiagnosticFileLimitSetting(limit),
			setDiagnosticFileLimit,
		),
		[persistSetting],
	)

	const updateOpenExplorerOnAppStart = useCallback(
		async (enabled: boolean) => persistSetting(
			"openExplorerOnAppStart",
			enabled,
			() => setOpenExplorerOnAppStartSetting(enabled),
			setOpenExplorerOnAppStart,
		),
		[persistSetting],
	)

	const updateOpenExplorerOnProjectOpen = useCallback(
		async (enabled: boolean) => persistSetting(
			"openExplorerOnProjectOpen",
			enabled,
			() => setOpenExplorerOnProjectOpenSetting(enabled),
			setOpenExplorerOnProjectOpen,
		),
		[persistSetting],
	)

	const updateCloseExplorerOnFolderClose = useCallback(
		async (enabled: boolean) => persistSetting(
			"closeExplorerOnFolderClose",
			enabled,
			() => setCloseExplorerOnFolderCloseSetting(enabled),
			setCloseExplorerOnFolderClose,
		),
		[persistSetting],
	)

	const updateCloseExplorerOnAppExit = useCallback(
		async (enabled: boolean) => persistSetting(
			"closeExplorerOnAppExit",
			enabled,
			() => setCloseExplorerOnAppExitSetting(enabled),
			setCloseExplorerOnAppExit,
		),
		[persistSetting],
	)

	const updateHideOpenProjectSubfolders = useCallback(
		async (enabled: boolean) => persistSetting(
			"hideOpenProjectSubfolders",
			enabled,
			() => setHideOpenProjectSubfoldersSetting(enabled),
			setHideOpenProjectSubfolders,
		),
		[persistSetting],
	)

	const updateFolderAction = useCallback(
		async (action: FolderAction) => persistSetting(
			"folderAction",
			action,
			() => setFolderActionSetting(action),
			setFolderAction,
		),
		[persistSetting],
	)

	const updateFolderSectionExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"folderSectionExpanded",
			expanded,
			() => setFolderSectionExpandedSetting(expanded),
			setFolderSectionExpanded,
		),
		[persistSetting],
	)

	const updateContextSectionExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"contextSectionExpanded",
			expanded,
			() => setContextSectionExpandedSetting(expanded),
			setContextSectionExpanded,
		),
		[persistSetting],
	)

	const updateApplySectionExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"applySectionExpanded",
			expanded,
			() => setApplySectionExpandedSetting(expanded),
			setApplySectionExpanded,
		),
		[persistSetting],
	)

	const updateSettingsGeneralExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"settingsGeneralExpanded",
			expanded,
			() => setSettingsGeneralExpandedSetting(expanded),
			setSettingsGeneralExpanded,
		),
		[persistSetting],
	)

	const updateSettingsContextExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"settingsContextExpanded",
			expanded,
			() => setSettingsContextExpandedSetting(expanded),
			setSettingsContextExpanded,
		),
		[persistSetting],
	)

	const updateSettingsHistoryExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"settingsHistoryExpanded",
			expanded,
			() => setSettingsHistoryExpandedSetting(expanded),
			setSettingsHistoryExpanded,
		),
		[persistSetting],
	)

	const updateSettingsVscodeExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"settingsVscodeExpanded",
			expanded,
			() => setSettingsVscodeExpandedSetting(expanded),
			setSettingsVscodeExpanded,
		),
		[persistSetting],
	)

	const updateSettingsExplorerExpanded = useCallback(
		async (expanded: boolean) => persistSetting(
			"settingsExplorerExpanded",
			expanded,
			() => setSettingsExplorerExpandedSetting(expanded),
			setSettingsExplorerExpanded,
		),
		[persistSetting],
	)

	const flushPendingWrites = useCallback(
		async (): Promise<void> => {
			await settingWriteQueueRef.current.catch(() => undefined)
		},
		[],
	)

	useEffect(
		() => {
			let cancelled = false

			async function initialize(): Promise<void> {
				try {
					const settings = await getAppSettings()

					if (cancelled)
						return

					persistedSettingsRef.current = settings
					setLocale(settings.locale)
					setTheme(settings.theme)
					applyTheme(settings.theme)
					setWorkMode(settings.workMode)
					setAutoCopyContextAfterAdd(settings.autoCopyContextAfterAdd)
					setAutoClearAfterExport(settings.autoClearAfterExport)
					setContextFilterHistoryLimit(settings.contextFilterHistoryLimit)
					setContextHistoryLimit(settings.contextHistoryLimit)
					setOverlayUndoHistoryLimit(settings.overlayUndoHistoryLimit)
					setDiagnosticFileLimit(settings.diagnosticFileLimit)
					setOpenExplorerOnAppStart(settings.openExplorerOnAppStart)
					setOpenExplorerOnProjectOpen(settings.openExplorerOnProjectOpen)
					setCloseExplorerOnFolderClose(settings.closeExplorerOnFolderClose)
					setCloseExplorerOnAppExit(settings.closeExplorerOnAppExit)
					setHideOpenProjectSubfolders(settings.hideOpenProjectSubfolders)
					setFolderAction(settings.folderAction)
					setFolderSectionExpanded(settings.folderSectionExpanded)
					setContextSectionExpanded(settings.contextSectionExpanded)
					setApplySectionExpanded(settings.applySectionExpanded)
					setSettingsGeneralExpanded(settings.settingsGeneralExpanded)
					setSettingsContextExpanded(settings.settingsContextExpanded)
					setSettingsHistoryExpanded(settings.settingsHistoryExpanded)
					setSettingsVscodeExpanded(settings.settingsVscodeExpanded)
					setSettingsExplorerExpanded(settings.settingsExplorerExpanded)
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

			return () => {
				cancelled = true
			}
		},
		[],
	)

	return {
		locale,
		theme,
		workMode,
		autoCopyContextAfterAdd,
		autoClearAfterExport,
		contextFilterHistoryLimit,
		contextHistoryLimit,
		overlayUndoHistoryLimit,
		diagnosticFileLimit,
		openExplorerOnAppStart,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
		closeExplorerOnAppExit,
		hideOpenProjectSubfolders,
		folderAction,
		folderSectionExpanded,
		contextSectionExpanded,
		applySectionExpanded,
		settingsGeneralExpanded,
		settingsContextExpanded,
		settingsHistoryExpanded,
		settingsVscodeExpanded,
		settingsExplorerExpanded,
		notice,
		isReady,
		setNotice,
		updateLocale,
		updateTheme,
		updateWorkMode,
		updateAutoCopyContextAfterAdd,
		updateAutoClearAfterExport,
		updateContextFilterHistoryLimit,
		updateContextHistoryLimit,
		updateOverlayUndoHistoryLimit,
		updateDiagnosticFileLimit,
		updateOpenExplorerOnAppStart,
		updateOpenExplorerOnProjectOpen,
		updateCloseExplorerOnFolderClose,
		updateCloseExplorerOnAppExit,
		updateHideOpenProjectSubfolders,
		updateFolderAction,
		updateFolderSectionExpanded,
		updateContextSectionExpanded,
		updateApplySectionExpanded,
		updateSettingsGeneralExpanded,
		updateSettingsContextExpanded,
		updateSettingsHistoryExpanded,
		updateSettingsVscodeExpanded,
		updateSettingsExplorerExpanded,
		flushPendingWrites,
	}
}
