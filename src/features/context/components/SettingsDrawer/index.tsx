import { styles } from "./style"
import {
	type AppTheme,
	HISTORY_LIMIT_MAX,
	HISTORY_LIMIT_MIN,
} from "@/features/context/types"
import { installVscodeExtension } from "@/infra/desktop"
import {
	type Locale,
	localeOptions,
	translate,
} from "@/infra/i18n"
import { Switch } from "@/shared/components/Switch"
import { X } from "lucide-react"
import {
	type ChangeEvent,
	useEffect,
	useState,
} from "react"

type VscodeExtensionInstallStatus = "idle" | "installing" | "success" | "error"

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
	autoCopyContextAfterAdd: boolean
	autoClearAfterExport: boolean
	contextFilterHistoryLimit: number
	contextHistoryLimit: number
	overlayUndoHistoryLimit: number
	openExplorerOnAppStart: boolean
	openExplorerOnProjectOpen: boolean
	closeExplorerOnFolderClose: boolean
	closeExplorerOnAppExit: boolean
	disabled?: boolean
	onClose: () => void
	onLocaleChange: (locale: Locale) => void
	onThemeChange: (theme: AppTheme) => void
	onAutoCopyContextAfterAddChange: (enabled: boolean) => void
	onAutoClearAfterExportChange: (enabled: boolean) => void
	onContextFilterHistoryLimitChange: (limit: number) => void
	onContextHistoryLimitChange: (limit: number) => void
	onOverlayUndoHistoryLimitChange: (limit: number) => void
	onOpenExplorerOnAppStartChange: (enabled: boolean) => void
	onOpenExplorerOnProjectOpenChange: (enabled: boolean) => void
	onCloseExplorerOnFolderCloseChange: (enabled: boolean) => void
	onCloseExplorerOnAppExitChange: (enabled: boolean) => void
}

export function SettingsDrawer({
	open,
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
	disabled = false,
	onClose,
	onLocaleChange,
	onThemeChange,
	onAutoCopyContextAfterAddChange,
	onAutoClearAfterExportChange,
	onContextFilterHistoryLimitChange,
	onContextHistoryLimitChange,
	onOverlayUndoHistoryLimitChange,
	onOpenExplorerOnAppStartChange,
	onOpenExplorerOnProjectOpenChange,
	onCloseExplorerOnFolderCloseChange,
	onCloseExplorerOnAppExitChange,
}: SettingsDrawerProps) {
	const [vscodeExtensionInstallStatus, setVscodeExtensionInstallStatus] = useState<VscodeExtensionInstallStatus>("idle")

	async function handleInstallVscodeExtension(): Promise<void> {
		setVscodeExtensionInstallStatus("installing")

		try {
			await installVscodeExtension()
			setVscodeExtensionInstallStatus("success")
		} catch {
			setVscodeExtensionInstallStatus("error")
		}
	}

	useEffect(() => {
		if (!open)
			return

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape")
				onClose()
		}

		document.addEventListener(
			"keydown",
			handleKeyDown,
		)

		return () => {
			document.removeEventListener(
				"keydown",
				handleKeyDown,
			)
		}
	}, [
		onClose,
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
			<button
				type="button"
				aria-label={translate(
					locale,
					"settings.close",
				)}
				tabIndex={open ?
					0 :
					-1}
				className={styles.backdrop({
					open,
				})}
				onClick={onClose}
			/>

			<aside
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
						type="button"
						aria-label={translate(
							locale,
							"settings.close",
						)}
						className={styles.closeButton}
						onClick={onClose}
					>
						<X
							size={16}
							strokeWidth={2}
							aria-hidden="true"
						/>
					</button>
				</header>

				<div className={styles.content}>
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>
							{translate(
								locale,
								"settings.general",
							)}
						</h3>

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

										if (nextLocale !== undefined)
											onLocaleChange(nextLocale)
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

								<span className={styles.selectDescription}>
									{translate(
										locale,
										"settings.language.description",
									)}
								</span>
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
						</div>
					</section>

					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>
							{translate(
								locale,
								"settings.context",
							)}
						</h3>

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
						</div>
					</section>

					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>
							{translate(
								locale,
								"settings.history",
							)}
						</h3>

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
					</section>

					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>
							{translate(
								locale,
								"settings.vscode",
							)}
						</h3>

						<div className={styles.integrationAction}>
							<p className={styles.integrationDescription}>
								{translate(
									locale,
									"settings.vscode.description",
								)}
							</p>

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
					</section>

					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>
							{translate(
								locale,
								"settings.explorer",
							)}
						</h3>

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
					</section>
				</div>
			</aside>
		</div>
	)
}
