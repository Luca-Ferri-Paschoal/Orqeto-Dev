import type { ContextMode } from "../../../types"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import { ContextExportActions } from "../../ContextExportActions"
import { styles } from "../style"
import { translate } from "@/infra/i18n"

interface ValidationModeContentProps {
	workspace: ContextWorkspace
	validationMode: ContextMode
	lintFixAvailable: boolean
	testAvailable: boolean
	interactionDisabled: boolean
	metadata: string | null
	busy: boolean
	generated: boolean
	onGenerateDiagnostic: (mode: "typecheck" | "eslint") => void
	onLintFix: () => void
	onTest: () => void
	onCopy: () => void
	onDownload: () => void
}

export function ValidationModeContent({
	workspace,
	validationMode,
	lintFixAvailable,
	testAvailable,
	interactionDisabled,
	metadata,
	busy,
	generated,
	onGenerateDiagnostic,
	onLintFix,
	onTest,
	onCopy,
	onDownload,
}: ValidationModeContentProps) {
	return (
		<div className={styles.modeDetails}>
			<div className={styles.secondaryModeRow}>
				<span className={styles.validationModeLabel}>
					{translate(
						workspace.locale,
						"folder.validation.label",
					)}
				</span>
				<div className={styles.secondaryModeButtons}>
					{workspace.diagnosticCapabilities.typecheck && (
						<button
							type="button"
							aria-pressed={validationMode === "typecheck"}
							className={styles.secondaryModeButton({ selected: validationMode === "typecheck" })}
							disabled={interactionDisabled}
							onClick={() => onGenerateDiagnostic("typecheck")}
						>
							{translate(
								workspace.locale,
								"folder.contextMode.typecheck",
							)}
						</button>
					)}
					{lintFixAvailable && (
						<button
							type="button"
							aria-pressed={validationMode === "lintfix"}
							className={styles.secondaryModeButton({ selected: validationMode === "lintfix" })}
							disabled={interactionDisabled}
							title={workspace.diagnosticCapabilities.lintFixCommand ?? translate(
								workspace.locale,
								"folder.contextMode.lintFixTitle",
							)}
							onClick={onLintFix}
						>
							{translate(
								workspace.locale,
								"folder.contextMode.lintFix",
							)}
						</button>
					)}
					{workspace.diagnosticCapabilities.eslint && (
						<button
							type="button"
							aria-pressed={validationMode === "eslint"}
							className={styles.secondaryModeButton({ selected: validationMode === "eslint" })}
							disabled={interactionDisabled}
							onClick={() => onGenerateDiagnostic("eslint")}
						>
							{translate(
								workspace.locale,
								"folder.contextMode.eslint",
							)}
						</button>
					)}
					{testAvailable && (
						<button
							type="button"
							aria-pressed={validationMode === "test"}
							className={styles.secondaryModeButton({ selected: validationMode === "test" })}
							disabled={interactionDisabled}
							title={workspace.diagnosticCapabilities.testCommand ?? translate(
								workspace.locale,
								"folder.contextMode.testTitle",
							)}
							onClick={onTest}
						>
							{translate(
								workspace.locale,
								"folder.contextMode.test",
							)}
						</button>
					)}
				</div>
			</div>
			<ContextExportActions
				locale={workspace.locale}
				metadata={metadata}
				busy={busy}
				disabled={interactionDisabled}
				generated={generated}
				onCopy={onCopy}
				onDownload={onDownload}
			/>
		</div>
	)
}
