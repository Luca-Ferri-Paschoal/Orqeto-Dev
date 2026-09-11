import {
	type AppNotice,
	type AppTheme,
	DEFAULT_APP_THEME,
	DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
	DEFAULT_CONTEXT_HISTORY_LIMIT,
	DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
} from "./types"
import {
	getAppSettings,
	setAutoClearAfterExportSetting,
	setAutoCopyContextAfterAddSetting,
	setCloseExplorerOnAppExitSetting,
	setCloseExplorerOnFolderCloseSetting,
	setContextFilterHistoryLimitSetting,
	setContextHistoryLimitSetting,
	setLocaleSetting,
	setOpenExplorerOnAppStartSetting,
	setOpenExplorerOnProjectOpenSetting,
	setOverlayUndoHistoryLimitSetting,
	setThemeSetting,
} from "@/infra/configDatabase"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import {
	useCallback,
	useEffect,
	useState,
} from "react"

function getErrorMessage(
	error: unknown,
	locale: Locale,
): string {
	if (error instanceof Error)
		return error.message

	if (typeof error === "string")
		return error

	return translate(
		locale,
		"workspace.unexpectedError",
	)
}

function applyTheme(theme: AppTheme): void {
	document.documentElement.dataset.theme = theme
	document.documentElement.style.colorScheme = theme
}

export function useAppSettings() {
	const [locale, setLocale] = useState<Locale>("pt-BR")
	const [theme, setTheme] = useState<AppTheme>(DEFAULT_APP_THEME)
	const [autoCopyContextAfterAdd, setAutoCopyContextAfterAdd] = useState(false)
	const [autoClearAfterExport, setAutoClearAfterExport] = useState(false)
	const [contextFilterHistoryLimit, setContextFilterHistoryLimit] = useState(DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT)
	const [contextHistoryLimit, setContextHistoryLimit] = useState(DEFAULT_CONTEXT_HISTORY_LIMIT)
	const [overlayUndoHistoryLimit, setOverlayUndoHistoryLimit] = useState(DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT)
	const [openExplorerOnAppStart, setOpenExplorerOnAppStart] = useState(true)
	const [openExplorerOnProjectOpen, setOpenExplorerOnProjectOpen] = useState(true)
	const [closeExplorerOnFolderClose, setCloseExplorerOnFolderClose] = useState(false)
	const [closeExplorerOnAppExit, setCloseExplorerOnAppExit] = useState(false)
	const [notice, setNotice] = useState<AppNotice | null>(null)
	const [isReady, setIsReady] = useState(false)

	const updateLocale = useCallback(
		async (nextLocale: Locale) => {
			const previousLocale = locale

			setLocale(nextLocale)

			try {
				await setLocaleSetting(nextLocale)
			} catch (error) {
				setLocale(previousLocale)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						previousLocale,
					),
				})
			}
		},
		[locale],
	)

	const updateTheme = useCallback(
		async (nextTheme: AppTheme) => {
			const previousTheme = theme

			setTheme(nextTheme)
			applyTheme(nextTheme)

			try {
				await setThemeSetting(nextTheme)
			} catch (error) {
				setTheme(previousTheme)
				applyTheme(previousTheme)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			locale,
			theme,
		],
	)

	const updateAutoCopyContextAfterAdd = useCallback(
		async (enabled: boolean) => {
			const previousValue = autoCopyContextAfterAdd

			setAutoCopyContextAfterAdd(enabled)

			try {
				await setAutoCopyContextAfterAddSetting(enabled)
			} catch (error) {
				setAutoCopyContextAfterAdd(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			autoCopyContextAfterAdd,
			locale,
		],
	)

	const updateAutoClearAfterExport = useCallback(
		async (enabled: boolean) => {
			const previousValue = autoClearAfterExport

			setAutoClearAfterExport(enabled)

			try {
				await setAutoClearAfterExportSetting(enabled)
			} catch (error) {
				setAutoClearAfterExport(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			autoClearAfterExport,
			locale,
		],
	)

	const updateContextFilterHistoryLimit = useCallback(
		async (limit: number) => {
			const previousValue = contextFilterHistoryLimit

			setContextFilterHistoryLimit(limit)

			try {
				await setContextFilterHistoryLimitSetting(limit)
			} catch (error) {
				setContextFilterHistoryLimit(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			contextFilterHistoryLimit,
			locale,
		],
	)

	const updateContextHistoryLimit = useCallback(
		async (limit: number) => {
			const previousValue = contextHistoryLimit

			setContextHistoryLimit(limit)

			try {
				await setContextHistoryLimitSetting(limit)
			} catch (error) {
				setContextHistoryLimit(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			contextHistoryLimit,
			locale,
		],
	)

	const updateOverlayUndoHistoryLimit = useCallback(
		async (limit: number) => {
			const previousValue = overlayUndoHistoryLimit

			setOverlayUndoHistoryLimit(limit)

			try {
				await setOverlayUndoHistoryLimitSetting(limit)
			} catch (error) {
				setOverlayUndoHistoryLimit(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			locale,
			overlayUndoHistoryLimit,
		],
	)

	const updateOpenExplorerOnAppStart = useCallback(
		async (enabled: boolean) => {
			const previousValue = openExplorerOnAppStart

			setOpenExplorerOnAppStart(enabled)

			try {
				await setOpenExplorerOnAppStartSetting(enabled)
			} catch (error) {
				setOpenExplorerOnAppStart(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			locale,
			openExplorerOnAppStart,
		],
	)

	const updateOpenExplorerOnProjectOpen = useCallback(
		async (enabled: boolean) => {
			const previousValue = openExplorerOnProjectOpen

			setOpenExplorerOnProjectOpen(enabled)

			try {
				await setOpenExplorerOnProjectOpenSetting(enabled)
			} catch (error) {
				setOpenExplorerOnProjectOpen(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			locale,
			openExplorerOnProjectOpen,
		],
	)

	const updateCloseExplorerOnFolderClose = useCallback(
		async (enabled: boolean) => {
			const previousValue = closeExplorerOnFolderClose

			setCloseExplorerOnFolderClose(enabled)

			try {
				await setCloseExplorerOnFolderCloseSetting(enabled)
			} catch (error) {
				setCloseExplorerOnFolderClose(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			closeExplorerOnFolderClose,
			locale,
		],
	)

	const updateCloseExplorerOnAppExit = useCallback(
		async (enabled: boolean) => {
			const previousValue = closeExplorerOnAppExit

			setCloseExplorerOnAppExit(enabled)

			try {
				await setCloseExplorerOnAppExitSetting(enabled)
			} catch (error) {
				setCloseExplorerOnAppExit(previousValue)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			closeExplorerOnAppExit,
			locale,
		],
	)

	useEffect(
		() => {
			let cancelled = false

			async function initialize(): Promise<void> {
				try {
					const settings = await getAppSettings()

					if (cancelled)
						return

					setLocale(settings.locale)
					setTheme(settings.theme)
					applyTheme(settings.theme)
					setAutoCopyContextAfterAdd(settings.autoCopyContextAfterAdd)
					setAutoClearAfterExport(settings.autoClearAfterExport)
					setContextFilterHistoryLimit(settings.contextFilterHistoryLimit)
					setContextHistoryLimit(settings.contextHistoryLimit)
					setOverlayUndoHistoryLimit(settings.overlayUndoHistoryLimit)
					setOpenExplorerOnAppStart(settings.openExplorerOnAppStart)
					setOpenExplorerOnProjectOpen(settings.openExplorerOnProjectOpen)
					setCloseExplorerOnFolderClose(settings.closeExplorerOnFolderClose)
					setCloseExplorerOnAppExit(settings.closeExplorerOnAppExit)
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
		autoCopyContextAfterAdd,
		autoClearAfterExport,
		contextFilterHistoryLimit,
		contextHistoryLimit,
		overlayUndoHistoryLimit,
		openExplorerOnAppStart,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
		closeExplorerOnAppExit,
		notice,
		isReady,
		setNotice,
		updateLocale,
		updateTheme,
		updateAutoCopyContextAfterAdd,
		updateAutoClearAfterExport,
		updateContextFilterHistoryLimit,
		updateContextHistoryLimit,
		updateOverlayUndoHistoryLimit,
		updateOpenExplorerOnAppStart,
		updateOpenExplorerOnProjectOpen,
		updateCloseExplorerOnFolderClose,
		updateCloseExplorerOnAppExit,
	}
}
