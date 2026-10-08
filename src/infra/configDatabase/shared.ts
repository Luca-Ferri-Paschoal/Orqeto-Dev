import {
	HISTORY_LIMIT_MAX,
	HISTORY_LIMIT_MIN,
} from "@/domain/appSettings"
import { invoke } from "@tauri-apps/api/core"

export const settingKeys = {
	activeProjectTabId: "active_project_tab_id",
	locale: "locale",
	theme: "theme",
	workMode: "work_mode",
	autoCopyContextAfterAdd: "auto_copy_context_after_add",
	autoCopyGeneratedReports: "auto_copy_generated_reports",
	autoClearAfterExport: "auto_clear_after_export",
	clearLogsAfterCopy: "clear_logs_after_copy",
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

export function parseHistoryLimit(value: string, fallback: number): number {
	const parsed = Number.parseInt(
		value,
		10,
	)
	return Number.isInteger(parsed) && parsed >= HISTORY_LIMIT_MIN && parsed <= HISTORY_LIMIT_MAX ?
		parsed :
		fallback
}

export function validateHistoryLimit(limit: number): void {
	if (!Number.isInteger(limit) || limit < HISTORY_LIMIT_MIN || limit > HISTORY_LIMIT_MAX)
		throw new Error(`The history limit must be between ${HISTORY_LIMIT_MIN} and ${HISTORY_LIMIT_MAX}.`)
}

export async function setSetting(key: string, value: string): Promise<void> {
	await invoke(
		"config_set_setting",
		{ key, value },
	)
}
