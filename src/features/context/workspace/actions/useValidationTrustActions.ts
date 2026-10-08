import type {
	ProjectDiagnosticKind,
	ProjectValidationCommandKind,
} from "../../types"
import type { UseContextWorkspaceOptions } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import {
	hasValidationExecutionTrust,
	recordValidationExecutionTrust,
} from "../validationTrust"
import {
	approveProjectDiagnostics,
	approveProjectValidationCommand,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

export function useValidationTrustActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
) {
	const {
		fullProjectSummaryRequestVersionRef,
		locale,
		setFullProjectContextScanState,
		setPreparedDiagnosticContexts,
		setPreparedGitCommitContext,
		trustedCustomValidationCommandsRef,
		trustedDiagnosticRootsRef,
	} = state
	const { requestConfirmation } = options

	const requestProjectExecutionTrust = useCallback(
		async (
			configuredRootFolder: string,
			customValidation: {
				kind: ProjectValidationCommandKind
				command: string
			} | null = null,
			diagnosticKind: ProjectDiagnosticKind | "lintfix" = "typecheck",
		): Promise<boolean> => {
			const rootTrusted = trustedDiagnosticRootsRef.current.has(configuredRootFolder)

			if (hasValidationExecutionTrust(
				configuredRootFolder,
				customValidation,
				trustedDiagnosticRootsRef.current,
				trustedCustomValidationCommandsRef.current,
				diagnosticKind,
			))
				return true

			const approved = await requestConfirmation({
				title: customValidation === null ?
					translate(
						locale,
						diagnosticKind === "typecheck" ?
							"workspace.diagnosticTrustTypecheckTitle" :
							diagnosticKind === "eslint" ?
								"workspace.diagnosticTrustEslintTitle" :
								"workspace.diagnosticTrustLintFixTitle",
					) :
					translate(
						locale,
						customValidation.kind === "test" ?
							"workspace.customTestTrustTitle" :
							"workspace.customLintFixTrustTitle",
					),
				message: customValidation === null ?
					translate(
						locale,
						diagnosticKind === "typecheck" ?
							"workspace.diagnosticTrustTypecheckMessage" :
							diagnosticKind === "eslint" ?
								"workspace.diagnosticTrustEslintMessage" :
								"workspace.diagnosticTrustLintFixMessage",
					) :
					translate(
						locale,
						customValidation.kind === "test" ?
							"workspace.customTestTrustMessage" :
							"workspace.customLintFixTrustMessage",
						{ command: customValidation.command },
					),
				confirmLabel: translate(
					locale,
					"workspace.diagnosticTrustConfirm",
				),
				cancelLabel: translate(
					locale,
					"workspace.diagnosticTrustCancel",
				),
			})

			if (!approved)
				return false

			if (customValidation === null) {
				if (!rootTrusted)
					await approveProjectDiagnostics(configuredRootFolder)
			} else {
				await approveProjectValidationCommand(
					configuredRootFolder,
					customValidation.kind,
					customValidation.command,
				)
			}

			recordValidationExecutionTrust(
				configuredRootFolder,
				customValidation,
				trustedDiagnosticRootsRef.current,
				trustedCustomValidationCommandsRef.current,
				diagnosticKind,
			)
			return true
		},
		[
			locale,
			requestConfirmation,
			trustedCustomValidationCommandsRef,
			trustedDiagnosticRootsRef,
		],
	)

	const invalidatePreparedReportsAfterLintFix = useCallback(
		(configuredRootFolder: string) => {
			setPreparedGitCommitContext(null)
			setPreparedDiagnosticContexts({
				typecheck: null,
				eslint: null,
			})
			fullProjectSummaryRequestVersionRef.current += 1
			setFullProjectContextScanState({
				rootFolder: configuredRootFolder,
				value: null,
			})
		},
		[
			fullProjectSummaryRequestVersionRef,
			setFullProjectContextScanState,
			setPreparedDiagnosticContexts,
			setPreparedGitCommitContext,
		],
	)

	const getValidationReportCopySuffix = useCallback(
		(result: {
			autoCopied: boolean
			autoCopyErrorMessage: string | null
		} | null): string => {
			if (result?.autoCopied) {
				return ` ${translate(
					locale,
					"workspace.generatedReportAutoCopied",
				)}`
			}

			if (result?.autoCopyErrorMessage) {
				return ` ${translate(
					locale,
					"workspace.generatedReportAutoCopyFailed",
					{ error: result.autoCopyErrorMessage },
				)}`
			}

			return ""
		},
		[locale],
	)

	return {
		requestProjectExecutionTrust,
		invalidatePreparedReportsAfterLintFix,
		getValidationReportCopySuffix,
	}
}
