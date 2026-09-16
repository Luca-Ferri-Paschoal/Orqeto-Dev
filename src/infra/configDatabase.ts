import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "@/features/context/contextPathFilter"
import {
	type AppSettings,
	type AppTheme,
	type ContextHistoryEntry,
	type ContextHistorySnapshot,
	DEFAULT_APP_THEME,
	DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
	DEFAULT_CONTEXT_HISTORY_LIMIT,
	DEFAULT_DIAGNOSTIC_FILE_LIMIT,
	DEFAULT_FOLDER_ACTION,
	DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS,
	DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
	DEFAULT_WORK_MODE,
	type FolderAction,
	HISTORY_LIMIT_MAX,
	HISTORY_LIMIT_MIN,
	type ProjectSection,
	type ProjectTab,
	type WorkMode,
} from "@/features/context/types"
import {
	isLocale,
	type Locale,
} from "@/infra/i18n"
import { invoke } from "@tauri-apps/api/core"

interface SettingRow {
	key: string
	value: string
}

interface ProjectTabRow {
	id: string
	rootFolder: string | null
	position: number
	folderSectionExpanded: number
	contextSectionExpanded: number
	applySectionExpanded: number
}

interface ContextFilterHistoryRow {
	pattern: string
	target: string
	mode: string
	lastUsedAt: number
}

interface ContextHistoryRow {
	id: number
	fileCount: number
	byteCount: number
	createdAt: number
}

let projectTabWriteQueue: Promise<void> = Promise.resolve()

async function enqueueProjectTabWrite<T>(operation: () => Promise<T>): Promise<T> {
	const result = projectTabWriteQueue
		.catch(() => undefined)
		.then(operation)
	projectTabWriteQueue = result.then(
		() => undefined,
		() => undefined,
	)
	return result
}

export async function flushProjectTabWrites(): Promise<void> {
	while (true) {
		const pending = projectTabWriteQueue
		await pending.catch(() => undefined)
		if (projectTabWriteQueue === pending)
			return
	}
}

const settingKeys = {
	activeProjectTabId: "active_project_tab_id",
	locale: "locale",
	theme: "theme",
	workMode: "work_mode",
	autoCopyContextAfterAdd: "auto_copy_context_after_add",
	autoClearAfterExport: "auto_clear_after_export",
	contextFilterHistoryLimit: "context_filter_history_limit",
	contextHistoryLimit: "context_history_limit",
	overlayUndoHistoryLimit: "overlay_undo_history_limit",
	diagnosticFileLimit: "diagnostic_file_limit",
	openExplorerOnAppStart: "open_explorer_on_app_start",
	openExplorerOnProjectOpen: "open_explorer_on_project_open",
	closeExplorerOnFolderClose: "close_explorer_on_folder_close",
	closeExplorerOnAppExit: "close_explorer_on_app_exit",
	hideOpenProjectSubfolders: "hide_open_project_subfolders",
	folderAction: "folder_action",
	folderSectionExpanded: "folder_section_expanded",
	contextSectionExpanded: "context_section_expanded",
	applySectionExpanded: "apply_section_expanded",
	settingsGeneralExpanded: "settings_general_expanded",
	settingsContextExpanded: "settings_context_expanded",
	settingsHistoryExpanded: "settings_history_expanded",
	settingsVscodeExpanded: "settings_vscode_expanded",
	settingsExplorerExpanded: "settings_explorer_expanded",
} as const

function isFolderAction(value: string): value is FolderAction {
	return value === "select" || value === "explorer" || value === "vscode" || value === "close"
}

function isContextFilterTarget(value: string): value is ContextFilterTarget {
	return value === "fileName" || value === "path"
}

function isContextFilterMode(value: string): value is ContextFilterMode {
	return value === "contains" || value === "exact" || value === "regex"
}

function parseHistoryLimit(
	value: string,
	fallback: number,
): number {
	const parsed = Number.parseInt(
		value,
		10,
	)

	return Number.isInteger(parsed) &&
		parsed >= HISTORY_LIMIT_MIN &&
		parsed <= HISTORY_LIMIT_MAX ?
		parsed :
		fallback
}

function validateHistoryLimit(limit: number): void {
	if (
		!Number.isInteger(limit) ||
		limit < HISTORY_LIMIT_MIN ||
		limit > HISTORY_LIMIT_MAX
	)
		throw new Error(`The history limit must be between ${HISTORY_LIMIT_MIN} and ${HISTORY_LIMIT_MAX}.`)
}

export async function getAppSettings(): Promise<AppSettings> {
	const rows = await invoke<SettingRow[]>("config_get_settings")

	let locale: Locale = "pt-BR"
	let theme: AppTheme = DEFAULT_APP_THEME
	let workMode: WorkMode = DEFAULT_WORK_MODE
	let autoCopyContextAfterAdd = false
	let autoClearAfterExport = false
	let contextFilterHistoryLimit = DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT
	let contextHistoryLimit = DEFAULT_CONTEXT_HISTORY_LIMIT
	let overlayUndoHistoryLimit = DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT
	let diagnosticFileLimit = DEFAULT_DIAGNOSTIC_FILE_LIMIT
	let openExplorerOnAppStart = true
	let openExplorerOnProjectOpen = true
	let closeExplorerOnFolderClose = false
	let closeExplorerOnAppExit = false
	let hideOpenProjectSubfolders = DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS
	let folderAction: FolderAction = DEFAULT_FOLDER_ACTION
	let folderSectionExpanded = true
	let contextSectionExpanded = true
	let applySectionExpanded = true
	let settingsGeneralExpanded = true
	let settingsContextExpanded = false
	let settingsHistoryExpanded = false
	let settingsVscodeExpanded = false
	let settingsExplorerExpanded = false

	for (const row of rows) {
		if (row.key === settingKeys.locale) {
			if (isLocale(row.value))
				locale = row.value

			continue
		}

		if (row.key === settingKeys.theme) {
			if (row.value === "light" || row.value === "dark")
				theme = row.value

			continue
		}

		if (row.key === settingKeys.workMode) {
			if (row.value === "files" || row.value === "git")
				workMode = row.value

			continue
		}

		if (row.key === settingKeys.autoCopyContextAfterAdd) {
			autoCopyContextAfterAdd = row.value === "1"
			continue
		}

		if (row.key === settingKeys.autoClearAfterExport) {
			autoClearAfterExport = row.value === "1"
			continue
		}

		if (row.key === settingKeys.contextFilterHistoryLimit) {
			contextFilterHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.contextHistoryLimit) {
			contextHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_CONTEXT_HISTORY_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.overlayUndoHistoryLimit) {
			overlayUndoHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.diagnosticFileLimit) {
			diagnosticFileLimit = parseHistoryLimit(
				row.value,
				DEFAULT_DIAGNOSTIC_FILE_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.openExplorerOnAppStart) {
			openExplorerOnAppStart = row.value === "1"
			continue
		}

		if (row.key === settingKeys.openExplorerOnProjectOpen) {
			openExplorerOnProjectOpen = row.value === "1"
			continue
		}

		if (row.key === settingKeys.closeExplorerOnFolderClose) {
			closeExplorerOnFolderClose = row.value === "1"
			continue
		}

		if (row.key === settingKeys.closeExplorerOnAppExit) {
			closeExplorerOnAppExit = row.value === "1"
			continue
		}

		if (row.key === settingKeys.hideOpenProjectSubfolders) {
			hideOpenProjectSubfolders = row.value === "1"
			continue
		}

		if (row.key === settingKeys.folderAction) {
			if (isFolderAction(row.value))
				folderAction = row.value

			continue
		}

		if (row.key === settingKeys.folderSectionExpanded) {
			folderSectionExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.contextSectionExpanded) {
			contextSectionExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.applySectionExpanded) {
			applySectionExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.settingsGeneralExpanded) {
			settingsGeneralExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.settingsContextExpanded) {
			settingsContextExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.settingsHistoryExpanded) {
			settingsHistoryExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.settingsVscodeExpanded) {
			settingsVscodeExpanded = row.value === "1"
			continue
		}

		if (row.key === settingKeys.settingsExplorerExpanded)
			settingsExplorerExpanded = row.value === "1"
	}

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
	}
}

export async function getProjectTabs(): Promise<ProjectTab[]> {
	const rows = await invoke<ProjectTabRow[]>("config_get_project_tabs")

	return rows.map(row => ({
		id: row.id,
		rootFolder: row.rootFolder,
		folderSectionExpanded: row.folderSectionExpanded !== 0,
		contextSectionExpanded: row.contextSectionExpanded !== 0,
		applySectionExpanded: row.applySectionExpanded !== 0,
	}))
}

export async function getActiveProjectTabId(): Promise<string | null> {
	return invoke<string | null>("config_get_active_project_tab_id")
}

export async function upsertProjectTab(
	tab: ProjectTab,
	position: number,
): Promise<void> {
	await enqueueProjectTabWrite(() => invoke(
		"config_upsert_project_tab",
		{
			tab,
			position,
		},
	))
}

export async function deleteProjectTab(id: string): Promise<void> {
	await enqueueProjectTabWrite(() => invoke(
		"config_delete_project_tab",
		{ id },
	))
}

export async function saveProjectTabOrder(ids: readonly string[]): Promise<void> {
	if (ids.length === 0)
		return

	await enqueueProjectTabWrite(() => invoke(
		"config_save_project_tab_order",
		{ ids: [...ids] },
	))
}

export async function setProjectTabSectionExpanded(
	id: string,
	section: ProjectSection,
	expanded: boolean,
): Promise<void> {
	await enqueueProjectTabWrite(() => invoke(
		"config_set_project_tab_section_expanded",
		{
			id,
			section,
			expanded,
		},
	))
}

export async function setActiveProjectTabId(id: string): Promise<void> {
	await enqueueProjectTabWrite(() => setSetting(
		settingKeys.activeProjectTabId,
		id,
	))
}

export async function getContextFilterHistory(
	rootFolder: string,
	limit: number,
): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)

	const rows = await invoke<ContextFilterHistoryRow[]>(
		"config_get_context_filter_history",
		{
			rootFolder,
			limit,
		},
	)

	return rows.flatMap(row => {
		if (
			!isContextFilterTarget(row.target) ||
			!isContextFilterMode(row.mode)
		)
			return []

		return [{
			pattern: row.pattern,
			target: row.target,
			mode: row.mode,
			lastUsedAt: row.lastUsedAt,
		}]
	})
}

export async function saveContextFilterHistoryEntry(
	rootFolder: string,
	entry: ContextFilterHistoryEntry,
	limit: number,
): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke(
		"config_save_context_filter_history_entry",
		{
			rootFolder,
			pattern: entry.pattern,
			target: entry.target,
			mode: entry.mode,
			lastUsedAt: entry.lastUsedAt,
			limit,
		},
	)

	return getContextFilterHistory(
		rootFolder,
		limit,
	)
}

export async function deleteContextFilterHistoryEntry(
	rootFolder: string,
	entry: ContextFilterHistoryEntry,
	limit: number,
): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke(
		"config_delete_context_filter_history_entry",
		{
			rootFolder,
			pattern: entry.pattern,
			target: entry.target,
			mode: entry.mode,
		},
	)

	return getContextFilterHistory(
		rootFolder,
		limit,
	)
}

export async function getContextHistory(
	rootFolder: string,
	limit: number,
): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)

	return invoke<ContextHistoryRow[]>(
		"config_get_context_history",
		{
			rootFolder,
			limit,
		},
	)
}

export async function getContextHistoryContent(
	rootFolder: string,
	id: number,
): Promise<string> {
	return invoke<string>(
		"config_get_context_history_content",
		{
			rootFolder,
			id,
		},
	)
}

export async function saveContextHistoryEntry(
	rootFolder: string,
	entry: ContextHistorySnapshot,
	limit: number,
): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke(
		"config_save_context_history_entry",
		{
			rootFolder,
			content: entry.content,
			fileCount: entry.fileCount,
			byteCount: entry.byteCount,
			createdAt: entry.createdAt,
			limit,
		},
	)

	return getContextHistory(
		rootFolder,
		limit,
	)
}

export async function deleteContextHistoryEntry(
	rootFolder: string,
	id: number,
	limit: number,
): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)
	await invoke(
		"config_delete_context_history_entry",
		{
			rootFolder,
			id,
		},
	)

	return getContextHistory(
		rootFolder,
		limit,
	)
}

async function setSetting(
	key: string,
	value: string,
): Promise<void> {
	await invoke(
		"config_set_setting",
		{
			key,
			value,
		},
	)
}

export async function setLocaleSetting(locale: Locale): Promise<void> {
	await setSetting(
		settingKeys.locale,
		locale,
	)
}

export async function setThemeSetting(theme: AppTheme): Promise<void> {
	await setSetting(
		settingKeys.theme,
		theme,
	)
}

export async function setWorkModeSetting(workMode: WorkMode): Promise<void> {
	await setSetting(
		settingKeys.workMode,
		workMode,
	)
}

export async function setAutoCopyContextAfterAddSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.autoCopyContextAfterAdd,
		enabled ?
			"1" :
			"0",
	)
}

export async function setAutoClearAfterExportSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.autoClearAfterExport,
		enabled ?
			"1" :
			"0",
	)
}

export async function setContextFilterHistoryLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.contextFilterHistoryLimit,
		String(limit),
	)
}

export async function setContextHistoryLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.contextHistoryLimit,
		String(limit),
	)
}

export async function setOverlayUndoHistoryLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.overlayUndoHistoryLimit,
		String(limit),
	)
}

export async function setDiagnosticFileLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.diagnosticFileLimit,
		String(limit),
	)
}

export async function setOpenExplorerOnAppStartSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.openExplorerOnAppStart,
		enabled ?
			"1" :
			"0",
	)
}

export async function setOpenExplorerOnProjectOpenSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.openExplorerOnProjectOpen,
		enabled ?
			"1" :
			"0",
	)
}

export async function setCloseExplorerOnFolderCloseSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.closeExplorerOnFolderClose,
		enabled ?
			"1" :
			"0",
	)
}

export async function setCloseExplorerOnAppExitSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.closeExplorerOnAppExit,
		enabled ?
			"1" :
			"0",
	)
}

export async function setHideOpenProjectSubfoldersSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.hideOpenProjectSubfolders,
		enabled ?
			"1" :
			"0",
	)
}

export async function setFolderActionSetting(action: FolderAction): Promise<void> {
	await setSetting(
		settingKeys.folderAction,
		action,
	)
}

export async function setFolderSectionExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.folderSectionExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setContextSectionExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.contextSectionExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setApplySectionExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.applySectionExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setSettingsGeneralExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.settingsGeneralExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setSettingsContextExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.settingsContextExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setSettingsHistoryExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.settingsHistoryExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setSettingsVscodeExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.settingsVscodeExpanded,
		enabled ?
			"1" :
			"0",
	)
}

export async function setSettingsExplorerExpandedSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.settingsExplorerExpanded,
		enabled ?
			"1" :
			"0",
	)
}
