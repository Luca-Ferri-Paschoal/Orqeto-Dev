import { invoke } from "@tauri-apps/api/core"

type SaveFullProjectContextExportFileOptions = {
	rootFolder: string
	relativePaths: string[]
	pathsOnly: boolean
	locale: "pt-BR" | "en"
	workMode: "files" | "git"
	suggestedFileName: string
	dialogTitle: string
	filterName: string
	extension: "txt"
	contextHistoryLimit: number
}
export interface FullProjectContextExportResult {
	saved: boolean
	fileCount: number
	skippedFileCount: number
	skippedDirectoryCount: number
	historyError: string | null
}
export const saveFullProjectContextExportFile = (options: SaveFullProjectContextExportFileOptions) => invoke<FullProjectContextExportResult>(
	"save_full_project_context_export_file",
	options,
)

type SaveContextHistoryExportFileOptions = {
	rootFolder: string
	id: number
	suggestedFileName: string
	dialogTitle: string
	filterName: string
	extension: "txt"
}
export const saveContextHistoryExportFile = (options: SaveContextHistoryExportFileOptions) => invoke<boolean>(
	"save_context_history_export_file",
	options,
)

type SaveExportFileOptions = {
	suggestedFileName: string
	dialogTitle: string
	filterName: string
	extension: "txt"
	content: string
}
export const saveExportFile = (options: SaveExportFileOptions) => invoke<boolean>(
	"save_export_file",
	options,
)
