import {
	parseHistoryLimit,
	setSetting,
	settingKeys,
	validateHistoryLimit,
} from "./shared"
import {
	type AppSettings,
	type AppTheme,
	DEFAULT_APP_SETTINGS,
	DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
	DEFAULT_CONTEXT_HISTORY_LIMIT,
	DEFAULT_DIAGNOSTIC_FILE_LIMIT,
	DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
	type FolderAction,
	type WorkMode,
} from "@/domain/appSettings"
import {
	isLocale,
	type Locale,
} from "@/infra/i18n"
import { invoke } from "@tauri-apps/api/core"

interface SettingRow {
	key: string
	value: string
}

const booleanSettingKeys = new Map<string, keyof Pick<AppSettings, | "autoCopyContextAfterAdd" | "autoCopyGeneratedReports" | "autoClearAfterExport" | "clearLogsAfterCopy" |
	"openExplorerOnAppStart" | "openExplorerOnProjectOpen" | "closeExplorerOnFolderClose" |
	"closeExplorerOnAppExit" | "hideOpenProjectSubfolders" | "folderSectionExpanded" |
	"contextSectionExpanded" | "applySectionExpanded" | "settingsGeneralExpanded" |
	"settingsContextExpanded" | "settingsHistoryExpanded" | "settingsVscodeExpanded" |
	"settingsExplorerExpanded">>([
		[settingKeys.autoCopyContextAfterAdd, "autoCopyContextAfterAdd"],
		[settingKeys.autoCopyGeneratedReports, "autoCopyGeneratedReports"],
		[settingKeys.autoClearAfterExport, "autoClearAfterExport"],
		[settingKeys.clearLogsAfterCopy, "clearLogsAfterCopy"],
		[settingKeys.openExplorerOnAppStart, "openExplorerOnAppStart"],
		[settingKeys.openExplorerOnProjectOpen, "openExplorerOnProjectOpen"],
		[settingKeys.closeExplorerOnFolderClose, "closeExplorerOnFolderClose"],
		[settingKeys.closeExplorerOnAppExit, "closeExplorerOnAppExit"],
		[settingKeys.hideOpenProjectSubfolders, "hideOpenProjectSubfolders"],
		[settingKeys.folderSectionExpanded, "folderSectionExpanded"],
		[settingKeys.contextSectionExpanded, "contextSectionExpanded"],
		[settingKeys.applySectionExpanded, "applySectionExpanded"],
		[settingKeys.settingsGeneralExpanded, "settingsGeneralExpanded"],
		[settingKeys.settingsContextExpanded, "settingsContextExpanded"],
		[settingKeys.settingsHistoryExpanded, "settingsHistoryExpanded"],
		[settingKeys.settingsVscodeExpanded, "settingsVscodeExpanded"],
		[settingKeys.settingsExplorerExpanded, "settingsExplorerExpanded"],
	])

function isFolderAction(value: string): value is FolderAction {
	return value === "select" || value === "explorer" || value === "vscode" || value === "close"
}

export async function getAppSettings(): Promise<AppSettings> {
	const settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
	for (const row of await invoke<SettingRow[]>("config_get_settings")) {
		if (row.key === settingKeys.locale && isLocale(row.value))
			settings.locale = row.value
		else if (row.key === settingKeys.theme && (row.value === "light" || row.value === "dark"))
			settings.theme = row.value
		else if (row.key === settingKeys.workMode && (row.value === "files" || row.value === "git"))
			settings.workMode = row.value
		else if (row.key === settingKeys.contextFilterHistoryLimit) {
			settings.contextFilterHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
			)
		} else if (row.key === settingKeys.contextHistoryLimit) {
			settings.contextHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_CONTEXT_HISTORY_LIMIT,
			)
		} else if (row.key === settingKeys.overlayUndoHistoryLimit) {
			settings.overlayUndoHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
			)
		} else if (row.key === settingKeys.diagnosticFileLimit) {
			settings.diagnosticFileLimit = parseHistoryLimit(
				row.value,
				DEFAULT_DIAGNOSTIC_FILE_LIMIT,
			)
		} else if (row.key === settingKeys.folderAction && isFolderAction(row.value))
			settings.folderAction = row.value
		else {
			const booleanSetting = booleanSettingKeys.get(row.key)
			if (booleanSetting !== undefined)
				settings[booleanSetting] = row.value === "1"
		}
	}
	return settings
}

const bool = (
	key: string,
	enabled: boolean,
) => setSetting(
	key,
	enabled ?
		"1" :
		"0",
)
export const setLocaleSetting = (value: Locale) => setSetting(
	settingKeys.locale,
	value,
)
export const setThemeSetting = (value: AppTheme) => setSetting(
	settingKeys.theme,
	value,
)
export const setWorkModeSetting = (value: WorkMode) => setSetting(
	settingKeys.workMode,
	value,
)
export const setAutoCopyContextAfterAddSetting = (value: boolean) => bool(
	settingKeys.autoCopyContextAfterAdd,
	value,
)
export const setAutoCopyGeneratedReportsSetting = (value: boolean) => bool(
	settingKeys.autoCopyGeneratedReports,
	value,
)
export const setAutoClearAfterExportSetting = (value: boolean) => bool(
	settingKeys.autoClearAfterExport,
	value,
)
export const setClearLogsAfterCopySetting = (value: boolean) => bool(
	settingKeys.clearLogsAfterCopy,
	value,
)
export const setOpenExplorerOnAppStartSetting = (value: boolean) => bool(
	settingKeys.openExplorerOnAppStart,
	value,
)
export const setOpenExplorerOnProjectOpenSetting = (value: boolean) => bool(
	settingKeys.openExplorerOnProjectOpen,
	value,
)
export const setCloseExplorerOnFolderCloseSetting = (value: boolean) => bool(
	settingKeys.closeExplorerOnFolderClose,
	value,
)
export const setCloseExplorerOnAppExitSetting = (value: boolean) => bool(
	settingKeys.closeExplorerOnAppExit,
	value,
)
export const setHideOpenProjectSubfoldersSetting = (value: boolean) => bool(
	settingKeys.hideOpenProjectSubfolders,
	value,
)
export const setFolderActionSetting = (value: FolderAction) => setSetting(
	settingKeys.folderAction,
	value,
)
export const setFolderSectionExpandedSetting = (value: boolean) => bool(
	settingKeys.folderSectionExpanded,
	value,
)
export const setContextSectionExpandedSetting = (value: boolean) => bool(
	settingKeys.contextSectionExpanded,
	value,
)
export const setApplySectionExpandedSetting = (value: boolean) => bool(
	settingKeys.applySectionExpanded,
	value,
)
export const setSettingsGeneralExpandedSetting = (value: boolean) => bool(
	settingKeys.settingsGeneralExpanded,
	value,
)
export const setSettingsContextExpandedSetting = (value: boolean) => bool(
	settingKeys.settingsContextExpanded,
	value,
)
export const setSettingsHistoryExpandedSetting = (value: boolean) => bool(
	settingKeys.settingsHistoryExpanded,
	value,
)
export const setSettingsVscodeExpandedSetting = (value: boolean) => bool(
	settingKeys.settingsVscodeExpanded,
	value,
)
export const setSettingsExplorerExpandedSetting = (value: boolean) => bool(
	settingKeys.settingsExplorerExpanded,
	value,
)

async function setLimit(key: string, limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		key,
		String(limit),
	)
}
export const setContextFilterHistoryLimitSetting = (limit: number) => setLimit(
	settingKeys.contextFilterHistoryLimit,
	limit,
)
export const setContextHistoryLimitSetting = (limit: number) => setLimit(
	settingKeys.contextHistoryLimit,
	limit,
)
export const setOverlayUndoHistoryLimitSetting = (limit: number) => setLimit(
	settingKeys.overlayUndoHistoryLimit,
	limit,
)
export const setDiagnosticFileLimitSetting = (limit: number) => setLimit(
	settingKeys.diagnosticFileLimit,
	limit,
)
