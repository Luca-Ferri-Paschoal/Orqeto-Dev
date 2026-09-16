import { formatAiWorkflowPrompt } from "../../formatAiWorkflowPrompt"
import { styles } from "./style"
import {
	type AppTheme,
	HISTORY_LIMIT_MAX,
	HISTORY_LIMIT_MIN,
	type WorkMode,
} from "@/features/context/types"
import { installVscodeExtension } from "@/infra/desktop"
import {
	type Locale,
	localeOptions,
	translate,
} from "@/infra/i18n"
import { CollapsiblePanel } from "@/shared/components/CollapsiblePanel"
import { Switch } from "@/shared/components/Switch"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { X } from "lucide-react"
import {
	type ChangeEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

type VscodeExtensionInstallStatus = "idle" | "installing" | "success" | "error"
type WorkflowPromptCopyStatus = "idle" | "success" | "error"
interface HistoryLimitFieldProps {
	id: string
	label: string
	value: number
	disabled: boolean
	onChange: (value: number) => void
}

function HistoryLimitField({
	id,
	label,
	value,
	disabled,
	onChange,
}: HistoryLimitFieldProps) {
	return (
		<label
			className={styles.numberField}
			htmlFor={id}
		>
			<span className={styles.numberFieldText}>
				<span className={styles.selectLabel}>
					{label}
				</span>
			</span>

			<input
				id={id}
				type="number"
				min={HISTORY_LIMIT_MIN}
				max={HISTORY_LIMIT_MAX}
				step={1}
				inputMode="numeric"
				className={styles.numberInput}
				value={value}
				disabled={disabled}
				onChange={(event: ChangeEvent<HTMLInputElement>) => {
					const nextValue = Number(event.currentTarget.value)

					if (
						Number.isInteger(nextValue) &&
						nextValue >= HISTORY_LIMIT_MIN &&
						nextValue <= HISTORY_LIMIT_MAX
					)
						onChange(nextValue)
				}}
			/>
		</label>
	)
}

export interface SettingsDrawerProps {
	open: boolean
	locale: Locale
	theme: AppTheme
	workMode: WorkMode
	autoCopyContextAfterAdd: boolean
	autoClearAfterExport: boolean
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
	onAutoClearAfterExportChange: (enabled: boolean) => void
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

export function SettingsDrawer({
	open,
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
	settingsGeneralExpanded,
	settingsContextExpanded,
	settingsHistoryExpanded,
	settingsVscodeExpanded,
	settingsExplorerExpanded,
	vscodeAvailable,
	disabled = false,
	onBusyChange,
	onClose,
	onLocaleChange,
	onThemeChange,
	onWorkModeChange,
	onAutoCopyContextAfterAddChange,
	onAutoClearAfterExportChange,
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
	const [vscodeExtensionInstallStatus, setVscodeExtensionInstallStatus] = useState<VscodeExtensionInstallStatus>("idle")
	const [workflowPromptCopyStatus, setWorkflowPromptCopyStatus] = useState<WorkflowPromptCopyStatus>("idle")
	const dialogRef = useRef<HTMLElement>(null)
	const previouslyFocusedRef = useRef<HTMLElement | null>(null)

	async function handleCopyWorkflowPrompt(): Promise<void> {
		try {
			await writeText(formatAiWorkflowPrompt(
				locale,
				workMode,
			))
			setWorkflowPromptCopyStatus("success")
		} catch {
			setWorkflowPromptCopyStatus("error")
		}
	}

	async function handleInstallVscodeExtension(): Promise<void> {
		setVscodeExtensionInstallStatus("installing")
		onBusyChange(true)

		try {
			await installVscodeExtension()
			setVscodeExtensionInstallStatus("success")
		} catch {
			setVscodeExtensionInstallStatus("error")
		} finally {
			onBusyChange(false)
		}
	}

	function resetWorkflowPromptCopyStatus(): void {
		setWorkflowPromptCopyStatus("idle")
	}

	const handleClose = useCallback((): void => {
		setWorkflowPromptCopyStatus("idle")
		onClose()
	}, [onClose])

	useEffect(() => {
		if (workflowPromptCopyStatus !== "success")
			return

		const timeout = window.setTimeout(
			() => setWorkflowPromptCopyStatus("idle"),
			2_000,
		)

		return () => window.clearTimeout(timeout)
	}, [workflowPromptCopyStatus])

	useEffect(() => {
		if (!open)
			return

		previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ?
			document.activeElement :
			null
		const dialog = dialogRef.current
		const focusFrame = window.requestAnimationFrame(() => {
			const initialFocus = dialog?.querySelector<HTMLElement>("[data-settings-initial-focus]")
				; (initialFocus ?? dialog)?.focus()
		})

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				event.preventDefault()
				handleClose()
				return
			}

			if (event.key !== "Tab" || dialog === null)
				return

			const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.getClientRects().length > 0)
			if (focusable.length === 0) {
				event.preventDefault()
				dialog.focus()
				return
			}

			const first = focusable[0]
			const last = focusable.at(-1)
			if (first === undefined || last === undefined)
				return

			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			} else if (!dialog.contains(document.activeElement)) {
				event.preventDefault()
				first.focus()
			}
		}

		document.addEventListener(
			"keydown",
			handleKeyDown,
		)

		return () => {
			window.cancelAnimationFrame(focusFrame)
			document.removeEventListener(
				"keydown",
				handleKeyDown,
			)
			const previous = previouslyFocusedRef.current
			previouslyFocusedRef.current = null
			if (previous?.isConnected)
				window.requestAnimationFrame(() => previous.focus())
		}
	}, [
		handleClose,
		open,
	])

	return (
		<div
			inert={!open}
			className={styles.overlay({
				open,
			})}
			aria-hidden={!open}
		>
			<div
				aria-hidden="true"
				className={styles.backdrop({
					open,
				})}
				onClick={handleClose}
			/>

			<aside
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-title"
				className={styles.drawer({
					open,
				})}
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
					<CollapsiblePanel
						id="settings-general"
						label={translate(
							locale,
							"settings.general",
						)}
						open={settingsGeneralExpanded}
						onToggle={() => onSettingsGeneralExpandedChange(!settingsGeneralExpanded)}
					>
						<div className={styles.settingsList}>
							<label
								className={styles.selectField}
								htmlFor="app-locale"
							>
								<span className={styles.selectLabel}>
									{translate(
										locale,
										"settings.language.label",
									)}
								</span>

								<select
									id="app-locale"
									className={styles.select}
									value={locale}
									disabled={disabled}
									onChange={(event: ChangeEvent<HTMLSelectElement>) => {
										const nextLocale = localeOptions.find(option => option.value === event.currentTarget.value)?.value

										if (nextLocale !== undefined) {
											resetWorkflowPromptCopyStatus()
											onLocaleChange(nextLocale)
										}
									}}
								>
									{localeOptions.map(option => (
										<option
											key={option.value}
											value={option.value}
										>
											{option.label}
										</option>
									))}
								</select>
							</label>

							<Switch
								checked={theme === "dark"}
								disabled={disabled}
								label={translate(
									locale,
									"settings.darkMode",
								)}
								onChange={enabled => onThemeChange(enabled ?
									"dark" :
									"light")}
							/>

							<div className={styles.workModeField}>
								<span className={styles.selectLabel}>
									{translate(
										locale,
										"settings.workMode.label",
									)}
								</span>

								<div
									className={styles.workModeControl}
									role="group"
									aria-label={translate(
										locale,
										"settings.workMode.label",
									)}
								>
									{([
										"files",
										"git",
									] as const).map(mode => (
										<button
											key={mode}
											type="button"
											disabled={disabled}
											aria-pressed={workMode === mode}
											className={styles.workModeButton({
												selected: workMode === mode,
											})}
											onClick={() => {
												resetWorkflowPromptCopyStatus()
												onWorkModeChange(mode)
											}}
										>
											{translate(
												locale,
												`settings.workMode.${mode}`,
											)}
										</button>
									))}
								</div>

								<div className={styles.promptAction}>
									<button
										type="button"
										className={styles.promptButton}
										disabled={disabled}
										onClick={() => void handleCopyWorkflowPrompt()}
									>
										{translate(
											locale,
											"settings.workMode.copyPrompt",
										)}
									</button>

									{workflowPromptCopyStatus === "success" && (
										<span
											className={styles.promptStatusSuccess}
											role="status"
										>
											{translate(
												locale,
												"settings.workMode.promptCopied",
											)}
										</span>
									)}

									{workflowPromptCopyStatus === "error" && (
										<span
											className={styles.promptStatusError}
											role="alert"
										>
											{translate(
												locale,
												"settings.workMode.promptCopyError",
											)}
										</span>
									)}
								</div>
							</div>
						</div>
					</CollapsiblePanel>

					<CollapsiblePanel
						id="settings-context"
						label={translate(
							locale,
							"settings.context",
						)}
						open={settingsContextExpanded}
						onToggle={() => onSettingsContextExpandedChange(!settingsContextExpanded)}
					>
						<div className={styles.settingsList}>
							<Switch
								checked={autoCopyContextAfterAdd}
								disabled={disabled}
								label={translate(
									locale,
									"settings.autoCopy",
								)}
								onChange={onAutoCopyContextAfterAddChange}
							/>

							<Switch
								checked={autoClearAfterExport}
								disabled={disabled}
								label={translate(
									locale,
									"settings.autoClear",
								)}
								onChange={onAutoClearAfterExportChange}
							/>

							<HistoryLimitField
								id="diagnostic-file-limit"
								label={translate(
									locale,
									"settings.diagnosticFileLimit",
								)}
								value={diagnosticFileLimit}
								disabled={disabled}
								onChange={onDiagnosticFileLimitChange}
							/>
						</div>
					</CollapsiblePanel>

					<CollapsiblePanel
						id="settings-history"
						label={translate(
							locale,
							"settings.history",
						)}
						open={settingsHistoryExpanded}
						onToggle={() => onSettingsHistoryExpandedChange(!settingsHistoryExpanded)}
					>
						<div className={styles.historySettings}>
							<HistoryLimitField
								id="context-history-limit"
								label={translate(
									locale,
									"settings.contextHistoryLimit",
								)}
								value={contextHistoryLimit}
								disabled={disabled}
								onChange={onContextHistoryLimitChange}
							/>

							<HistoryLimitField
								id="filter-history-limit"
								label={translate(
									locale,
									"settings.filterHistoryLimit",
								)}
								value={contextFilterHistoryLimit}
								disabled={disabled}
								onChange={onContextFilterHistoryLimitChange}
							/>

							<HistoryLimitField
								id="apply-history-limit"
								label={translate(
									locale,
									"settings.applyHistoryLimit",
								)}
								value={overlayUndoHistoryLimit}
								disabled={disabled}
								onChange={onOverlayUndoHistoryLimitChange}
							/>
						</div>
					</CollapsiblePanel>

					{vscodeAvailable && (
						<CollapsiblePanel
							id="settings-vscode"
							label={translate(
								locale,
								"settings.vscode",
							)}
							open={settingsVscodeExpanded}
							onToggle={() => onSettingsVscodeExpandedChange(!settingsVscodeExpanded)}
						>
							<div className={styles.settingsList}>
								<Switch
									checked={hideOpenProjectSubfolders}
									disabled={disabled}
									label={translate(
										locale,
										"settings.vscode.hideOpenSubfolders",
									)}
									onChange={onHideOpenProjectSubfoldersChange}
								/>
							</div>

							<div className={styles.integrationAction}>
								<div className={styles.integrationRow}>
									<span className={styles.integrationLabel}>
										{translate(
											locale,
											"settings.vscode.extensionLabel",
										)}
									</span>

									<button
										type="button"
										className={styles.integrationButton}
										disabled={disabled || vscodeExtensionInstallStatus === "installing"}
										aria-busy={vscodeExtensionInstallStatus === "installing"}
										onClick={() => void handleInstallVscodeExtension()}
									>
										{translate(
											locale,
											"settings.vscode.install",
										)}
									</button>
								</div>

								{vscodeExtensionInstallStatus === "success" && (
									<p
										className={styles.integrationStatusSuccess}
										role="status"
									>
										{translate(
											locale,
											"settings.vscode.success",
										)}
									</p>
								)}

								{vscodeExtensionInstallStatus === "error" && (
									<p
										className={styles.integrationStatusError}
										role="alert"
									>
										{translate(
											locale,
											"settings.vscode.error",
										)}
									</p>
								)}
							</div>
						</CollapsiblePanel>
					)}

					<CollapsiblePanel
						id="settings-explorer"
						label={translate(
							locale,
							"settings.explorer",
						)}
						open={settingsExplorerExpanded}
						onToggle={() => onSettingsExplorerExpandedChange(!settingsExplorerExpanded)}
					>
						<div className={styles.settingsList}>
							<Switch
								checked={openExplorerOnAppStart}
								disabled={disabled}
								label={translate(
									locale,
									"settings.openExplorerStart",
								)}
								onChange={onOpenExplorerOnAppStartChange}
							/>

							<Switch
								checked={openExplorerOnProjectOpen}
								disabled={disabled}
								label={translate(
									locale,
									"settings.openExplorerProject",
								)}
								onChange={onOpenExplorerOnProjectOpenChange}
							/>

							<Switch
								checked={closeExplorerOnFolderClose}
								disabled={disabled}
								label={translate(
									locale,
									"settings.closeExplorerFolder",
								)}
								onChange={onCloseExplorerOnFolderCloseChange}
							/>

							<Switch
								checked={closeExplorerOnAppExit}
								disabled={disabled}
								label={translate(
									locale,
									"settings.closeExplorerApp",
								)}
								onChange={onCloseExplorerOnAppExitChange}
							/>
						</div>
					</CollapsiblePanel>
				</div>
			</aside>
		</div>
	)
}
