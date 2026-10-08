import type {
	AppTheme,
	WorkMode,
} from "@/features/context/types"
import type { Locale } from "@/infra/i18n"

export interface SettingsDrawerProps {
	open: boolean
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
	settingsGeneralExpanded: boolean
	settingsContextExpanded: boolean
	settingsHistoryExpanded: boolean
	settingsVscodeExpanded: boolean
	settingsExplorerExpanded: boolean
	vscodeAvailable: boolean
	disabled?: boolean
	onBusyChange: (busy: boolean) => void
	onClose: () => void
	onLocaleChange: (locale: Locale) => void
	onThemeChange: (theme: AppTheme) => void
	onWorkModeChange: (workMode: WorkMode) => void
	onAutoCopyContextAfterAddChange: (enabled: boolean) => void
	onAutoCopyGeneratedReportsChange: (enabled: boolean) => void
	onAutoClearAfterExportChange: (enabled: boolean) => void
	onClearLogsAfterCopyChange: (enabled: boolean) => void
	onContextFilterHistoryLimitChange: (limit: number) => void
	onContextHistoryLimitChange: (limit: number) => void
	onOverlayUndoHistoryLimitChange: (limit: number) => void
	onDiagnosticFileLimitChange: (limit: number) => void
	onOpenExplorerOnAppStartChange: (enabled: boolean) => void
	onOpenExplorerOnProjectOpenChange: (enabled: boolean) => void
	onCloseExplorerOnFolderCloseChange: (enabled: boolean) => void
	onCloseExplorerOnAppExitChange: (enabled: boolean) => void
	onHideOpenProjectSubfoldersChange: (enabled: boolean) => void
	onSettingsGeneralExpandedChange: (expanded: boolean) => void
	onSettingsContextExpandedChange: (expanded: boolean) => void
	onSettingsHistoryExpandedChange: (expanded: boolean) => void
	onSettingsVscodeExpandedChange: (expanded: boolean) => void
	onSettingsExplorerExpandedChange: (expanded: boolean) => void
}

export type VscodeExtensionInstallStatus = "idle" | "installing" | "success" | "error"
export type WorkflowPromptCopyStatus = "idle" | "success" | "error"
