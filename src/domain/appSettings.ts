import type { Locale } from "./locale.ts"

export const HISTORY_LIMIT_MIN = 1
export const HISTORY_LIMIT_MAX = 100
export const DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT = 10
export const DEFAULT_CONTEXT_HISTORY_LIMIT = 5
export const DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT = 10
export const DEFAULT_DIAGNOSTIC_FILE_LIMIT = 20
export const DEFAULT_AUTO_COPY_GENERATED_REPORTS = true
export const DEFAULT_CLEAR_LOGS_AFTER_COPY = true
export const DEFAULT_APP_THEME = "light"
export const DEFAULT_WORK_MODE = "files"
export const DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS = true
export const DEFAULT_FOLDER_ACTION = "select"

export type AppTheme = "light" | "dark"
export type WorkMode = "files" | "git"
export type FolderAction = "select" | "explorer" | "vscode" | "close"
export type ProjectSection = "folder" | "context" | "apply"

export interface AppSettings {
	locale: Locale
	theme: AppTheme
	workMode: WorkMode
	autoCopyContextAfterAdd: boolean
	autoCopyGeneratedReports: boolean
	autoClearAfterExport: boolean
	clearLogsAfterCopy: boolean
	contextFilterHistoryLimit: number
	contextHistoryLimit: number
	overlayUndoHistoryLimit: number
	diagnosticFileLimit: number
	openExplorerOnAppStart: boolean
	openExplorerOnProjectOpen: boolean
	closeExplorerOnFolderClose: boolean
	closeExplorerOnAppExit: boolean
	hideOpenProjectSubfolders: boolean
	folderAction: FolderAction
	folderSectionExpanded: boolean
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
	settingsGeneralExpanded: boolean
	settingsContextExpanded: boolean
	settingsHistoryExpanded: boolean
	settingsVscodeExpanded: boolean
	settingsExplorerExpanded: boolean
}

export interface ProjectTab {
	id: string
	rootFolder: string | null
	folderSectionExpanded: boolean
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
	locale: "pt-BR",
	theme: DEFAULT_APP_THEME,
	workMode: DEFAULT_WORK_MODE,
	autoCopyContextAfterAdd: false,
	autoCopyGeneratedReports: DEFAULT_AUTO_COPY_GENERATED_REPORTS,
	autoClearAfterExport: false,
	clearLogsAfterCopy: DEFAULT_CLEAR_LOGS_AFTER_COPY,
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
}
