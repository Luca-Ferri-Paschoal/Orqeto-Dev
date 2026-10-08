import { ContextSettings } from "./sections/ContextSettings"
import { ExplorerSettings } from "./sections/ExplorerSettings"
import { GeneralSettings } from "./sections/GeneralSettings"
import { HistorySettings } from "./sections/HistorySettings"
import { VscodeSettings } from "./sections/VscodeSettings"
import { styles } from "./style"
import type { SettingsDrawerProps } from "./types"
import { useSettingsDrawerBehavior } from "./useSettingsDrawerBehavior"
import { translate } from "@/infra/i18n"
import { X } from "lucide-react"

export type { SettingsDrawerProps } from "./types"

export function SettingsDrawer({
	open,
	locale,
	theme,
	workMode,
	autoCopyContextAfterAdd,
	autoCopyGeneratedReports,
	autoClearAfterExport,
	clearLogsAfterCopy,
	contextFilterHistoryLimit,
	contextHistoryLimit,
	overlayUndoHistoryLimit,
	diagnosticFileLimit,
	openExplorerOnAppStart,
	openExplorerOnProjectOpen,
	closeExplorerOnFolderClose,
	closeExplorerOnAppExit,
	hideOpenProjectSubfolders,
	settingsGeneralExpanded,
	settingsContextExpanded,
	settingsHistoryExpanded,
	settingsVscodeExpanded,
	settingsExplorerExpanded,
	vscodeAvailable,
	disabled: disabledProp,
	onBusyChange,
	onClose,
	onLocaleChange,
	onThemeChange,
	onWorkModeChange,
	onAutoCopyContextAfterAddChange,
	onAutoCopyGeneratedReportsChange,
	onAutoClearAfterExportChange,
	onClearLogsAfterCopyChange,
	onContextFilterHistoryLimitChange,
	onContextHistoryLimitChange,
	onOverlayUndoHistoryLimitChange,
	onDiagnosticFileLimitChange,
	onOpenExplorerOnAppStartChange,
	onOpenExplorerOnProjectOpenChange,
	onCloseExplorerOnFolderCloseChange,
	onCloseExplorerOnAppExitChange,
	onHideOpenProjectSubfoldersChange,
	onSettingsGeneralExpandedChange,
	onSettingsContextExpandedChange,
	onSettingsHistoryExpandedChange,
	onSettingsVscodeExpandedChange,
	onSettingsExplorerExpandedChange,
}: SettingsDrawerProps) {
	const disabled = disabledProp ?? false
	const {
		copyWorkflowPrompt,
		dialogRef,
		handleClose,
		installExtension,
		resetWorkflowPromptCopyStatus,
		vscodeExtensionInstallStatus,
		workflowPromptCopyStatus,
	} = useSettingsDrawerBehavior(
		open,
		locale,
		workMode,
		onBusyChange,
		onClose,
	)

	return (
		<div
			inert={!open}
			className={styles.overlay({ open })}
			aria-hidden={!open}
		>
			<div
				aria-hidden="true"
				className={styles.backdrop({ open })}
				onClick={handleClose}
			/>

			<aside
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-title"
				className={styles.drawer({ open })}
			>
				<header className={styles.header}>
					<h2
						id="settings-title"
						className={styles.title}
					>
						{translate(
							locale,
							"settings.title",
						)}
					</h2>

					<button
						data-settings-initial-focus="true"
						type="button"
						aria-label={translate(
							locale,
							"settings.close",
						)}
						className={styles.closeButton}
						onClick={handleClose}
					>
						<X
							size={16}
							strokeWidth={2}
							aria-hidden="true"
						/>
					</button>
				</header>

				<div className={styles.content}>
					<GeneralSettings
						locale={locale}
						theme={theme}
						workMode={workMode}
						disabled={disabled}
						expanded={settingsGeneralExpanded}
						workflowPromptCopyStatus={workflowPromptCopyStatus}
						onExpandedChange={onSettingsGeneralExpandedChange}
						onLocaleChange={onLocaleChange}
						onThemeChange={onThemeChange}
						onWorkModeChange={onWorkModeChange}
						onCopyWorkflowPrompt={() => void copyWorkflowPrompt()}
						onResetCopyStatus={resetWorkflowPromptCopyStatus}
					/>

					<ContextSettings
						locale={locale}
						disabled={disabled}
						expanded={settingsContextExpanded}
						autoCopyContextAfterAdd={autoCopyContextAfterAdd}
						autoCopyGeneratedReports={autoCopyGeneratedReports}
						autoClearAfterExport={autoClearAfterExport}
						clearLogsAfterCopy={clearLogsAfterCopy}
						diagnosticFileLimit={diagnosticFileLimit}
						onExpandedChange={onSettingsContextExpandedChange}
						onAutoCopyContextAfterAddChange={onAutoCopyContextAfterAddChange}
						onAutoCopyGeneratedReportsChange={onAutoCopyGeneratedReportsChange}
						onAutoClearAfterExportChange={onAutoClearAfterExportChange}
						onClearLogsAfterCopyChange={onClearLogsAfterCopyChange}
						onDiagnosticFileLimitChange={onDiagnosticFileLimitChange}
					/>

					<HistorySettings
						locale={locale}
						disabled={disabled}
						expanded={settingsHistoryExpanded}
						contextHistoryLimit={contextHistoryLimit}
						contextFilterHistoryLimit={contextFilterHistoryLimit}
						overlayUndoHistoryLimit={overlayUndoHistoryLimit}
						onExpandedChange={onSettingsHistoryExpandedChange}
						onContextHistoryLimitChange={onContextHistoryLimitChange}
						onContextFilterHistoryLimitChange={onContextFilterHistoryLimitChange}
						onOverlayUndoHistoryLimitChange={onOverlayUndoHistoryLimitChange}
					/>

					{vscodeAvailable && (
						<VscodeSettings
							locale={locale}
							disabled={disabled}
							expanded={settingsVscodeExpanded}
							hideOpenProjectSubfolders={hideOpenProjectSubfolders}
							status={vscodeExtensionInstallStatus}
							onExpandedChange={onSettingsVscodeExpandedChange}
							onHideOpenProjectSubfoldersChange={onHideOpenProjectSubfoldersChange}
							onInstall={() => void installExtension()}
						/>
					)}

					<ExplorerSettings
						locale={locale}
						disabled={disabled}
						expanded={settingsExplorerExpanded}
						openExplorerOnAppStart={openExplorerOnAppStart}
						openExplorerOnProjectOpen={openExplorerOnProjectOpen}
						closeExplorerOnFolderClose={closeExplorerOnFolderClose}
						closeExplorerOnAppExit={closeExplorerOnAppExit}
						onExpandedChange={onSettingsExplorerExpandedChange}
						onOpenExplorerOnAppStartChange={onOpenExplorerOnAppStartChange}
						onOpenExplorerOnProjectOpenChange={onOpenExplorerOnProjectOpenChange}
						onCloseExplorerOnFolderCloseChange={onCloseExplorerOnFolderCloseChange}
						onCloseExplorerOnAppExitChange={onCloseExplorerOnAppExitChange}
					/>
				</div>
			</aside>
		</div>
	)
}
