import { formatProjectValidationCommandContext } from "../../formatValidationCommandContext"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useValidationTrustActions } from "./useValidationTrustActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	getProjectDiagnosticCapabilities,
	runProjectValidationCommand,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions> & ReturnType<typeof useValidationTrustActions>

export function useTestActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { isFixingLintRef, isGeneratingCommitContextRef, isOperationRunningRef, locale, rootFolderRef, setDiagnosticCapabilitiesState, setNotice, setOperationRevision, setPreparedValidationCommandContexts, setValidationCommandKind } = state
	const { beginCancellableContextOperation, commitCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, publishValidationCommandContext, invalidateMissingRootFolder, requestProjectExecutionTrust, getValidationReportCopySuffix } = deps

	const runProjectTests = useCallback(
		async (): Promise<void> => {
			if (
				isGeneratingCommitContextRef.current ||
				isOperationRunningRef.current ||
				isFixingLintRef.current
			)
				return

			const configuredRootFolder = rootFolderRef.current
			if (configuredRootFolder === null)
				return

			if (await invalidateMissingRootFolder())
				return

			const cancellationToken = beginCancellableContextOperation("test")
			if (cancellationToken === null)
				return

			isGeneratingCommitContextRef.current = true
			setValidationCommandKind("test")
			setPreparedValidationCommandContexts(current => ({
				...current,
				test: null,
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
				const customCommand = capabilities.testCommand
				if (customCommand === null)
					throw new Error("No Test command is configured at orqetoDev.validation.test.")

				if (!await requestProjectExecutionTrust(
					configuredRootFolder,
					{
						kind: "test",
						command: customCommand,
					},
				) || !isCancellableContextOperationActive(cancellationToken))
					return

				const result = await runProjectValidationCommand(
					configuredRootFolder,
					"test",
					cancellationToken.backendOperationId,
				)
				if (
					rootFolderRef.current !== configuredRootFolder ||
					!isCancellableContextOperationActive(cancellationToken)
				)
					return
				if (!commitCancellableContextOperation(cancellationToken))
					return

				const content = formatProjectValidationCommandContext(
					result,
					locale,
				)
				const published = await publishValidationCommandContext(
					"test",
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
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.validationCommandFailed",
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
					isGeneratingCommitContextRef.current = false
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
			isCancellableContextOperationActive,
			locale,
			publishValidationCommandContext,
			requestProjectExecutionTrust,
			isFixingLintRef,
			isGeneratingCommitContextRef,
			isOperationRunningRef,
			rootFolderRef,
			setDiagnosticCapabilitiesState,
			setNotice,
			setOperationRevision,
			setPreparedValidationCommandContexts,
			setValidationCommandKind,
		],
	)

	return {
		runProjectTests,
	}
}
