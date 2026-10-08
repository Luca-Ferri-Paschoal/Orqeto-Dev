import {
	formatFallbackLintFixContext,
	formatProjectValidationCommandContext,
} from "../../formatValidationCommandContext"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useValidationTrustActions } from "./useValidationTrustActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	fixProjectEslint,
	getProjectDiagnosticCapabilities,
	runProjectValidationCommand,
} from "@/infra/desktop"
import {
	translate,
	translateCount,
} from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions> & ReturnType<typeof useValidationTrustActions>

export function useLintFixActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { isFixingLintRef, isGeneratingCommitContextRef, isOperationRunningRef, locale, rootFolderRef, setDiagnosticCapabilitiesState, setIsFixingLint, setNotice, setOperationRevision, setPreparedValidationCommandContexts, setValidationCommandKind } = state
	const { beginCancellableContextOperation, commitCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, publishValidationCommandContext, invalidateMissingRootFolder, requestProjectExecutionTrust, invalidatePreparedReportsAfterLintFix, getValidationReportCopySuffix } = deps

	const fixEslint = useCallback(
		async (): Promise<void> => {
			if (
				isFixingLintRef.current ||
				isGeneratingCommitContextRef.current ||
				isOperationRunningRef.current
			)
				return

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			if (await invalidateMissingRootFolder())
				return

			const cancellationToken = beginCancellableContextOperation("lintfix")
			if (cancellationToken === null)
				return

			isFixingLintRef.current = true
			isGeneratingCommitContextRef.current = true
			setIsFixingLint(true)
			setValidationCommandKind("lintfix")
			setPreparedValidationCommandContexts(current => ({
				...current,
				lintfix: null,
			}))

			try {
				const capabilities = await getProjectDiagnosticCapabilities(configuredRootFolder)
				if (
					rootFolderRef.current !== configuredRootFolder ||
					!isCancellableContextOperationActive(cancellationToken)
				)
					return

				setDiagnosticCapabilitiesState({
					rootFolder: configuredRootFolder,
					value: capabilities,
				})

				const customCommand = capabilities.lintFixCommand
				if (customCommand !== null) {
					if (!await requestProjectExecutionTrust(
						configuredRootFolder,
						{
							kind: "lintfix",
							command: customCommand,
						},
					) || !isCancellableContextOperationActive(cancellationToken))
						return

					const result = await runProjectValidationCommand(
						configuredRootFolder,
						"lintfix",
						cancellationToken.backendOperationId,
					)
					if (
						rootFolderRef.current !== configuredRootFolder ||
						!isCancellableContextOperationActive(cancellationToken)
					)
						return
					if (!commitCancellableContextOperation(cancellationToken))
						return

					invalidatePreparedReportsAfterLintFix(configuredRootFolder)
					const content = formatProjectValidationCommandContext(
						result,
						locale,
					)
					const published = await publishValidationCommandContext(
						"lintfix",
						content,
					)
					if (
						published === null ||
						!isCancellableContextOperationActive(cancellationToken)
					)
						return

					setNotice({
						kind: result.success ?
							"success" :
							"warning",
						message: `${translate(
							locale,
							result.success ?
								"workspace.validationCommandCompleted" :
								"workspace.validationCommandCompletedWithIssues",
						)}${getValidationReportCopySuffix(published)}`,
					})
					return
				}

				if (!capabilities.eslint)
					throw new Error("No ESLint configuration was found in this project.")

				if (!await requestProjectExecutionTrust(
					configuredRootFolder,
					null,
					"lintfix",
				) ||
					!isCancellableContextOperationActive(cancellationToken))
					return

				const result = await fixProjectEslint(
					configuredRootFolder,
					cancellationToken.backendOperationId,
				)

				if (
					rootFolderRef.current !== configuredRootFolder ||
					!isCancellableContextOperationActive(cancellationToken)
				)
					return
				if (!commitCancellableContextOperation(cancellationToken))
					return

				invalidatePreparedReportsAfterLintFix(configuredRootFolder)
				const content = formatFallbackLintFixContext(
					result,
					locale,
				)
				const published = await publishValidationCommandContext(
					"lintfix",
					content,
				)
				if (
					published === null ||
					!isCancellableContextOperationActive(cancellationToken)
				)
					return

				const changedSummary = result.changedFileCount === 0 ?
					translate(
						locale,
						"workspace.lintFixNoChanges",
					) :
					translateCount(
						locale,
						result.changedFileCount,
						"workspace.lintFixUpdated.one",
						"workspace.lintFixUpdated.other",
					)
				const remainingSummary = result.remainingIssueCount === 0 ?
					translate(
						locale,
						"workspace.lintFixClean",
					) :
					translateCount(
						locale,
						result.remainingIssueCount,
						"workspace.lintFixRemaining.one",
						"workspace.lintFixRemaining.other",
						{
							affectedFiles: translateCount(
								locale,
								result.remainingFilesWithIssues,
								"diagnostics.affectedFiles.one",
								"diagnostics.affectedFiles.other",
							),
						},
					)

				setNotice({
					kind: result.remainingIssueCount === 0 ?
						"success" :
						"warning",
					message: `${changedSummary} ${remainingSummary}${getValidationReportCopySuffix(published)}`,
				})
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.lintFixFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isFixingLintRef.current = false
					isGeneratingCommitContextRef.current = false
					setIsFixingLint(false)
					setValidationCommandKind(null)
					setOperationRevision(revision => revision + 1)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			getValidationReportCopySuffix,
			invalidateMissingRootFolder,
			invalidatePreparedReportsAfterLintFix,
			isCancellableContextOperationActive,
			locale,
			publishValidationCommandContext,
			requestProjectExecutionTrust,
			isFixingLintRef,
			isGeneratingCommitContextRef,
			isOperationRunningRef,
			rootFolderRef,
			setDiagnosticCapabilitiesState,
			setIsFixingLint,
			setNotice,
			setOperationRevision,
			setPreparedValidationCommandContexts,
			setValidationCommandKind,
		],
	)

	return {
		fixEslint,
	}
}
