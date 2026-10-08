import { getGeneratedContentByteCount } from "../../formatGeneratedContent"
import {
	createProjectDiagnosticNotice,
	formatProjectDiagnosticContext,
} from "../../formatProjectDiagnosticContext"
import type {
	ProjectDiagnosticContextData,
	ProjectDiagnosticKind,
} from "../../types"
import type {
	CancellableContextOperationToken,
	PreparedDiagnosticContext,
} from "../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useValidationTrustActions } from "./useValidationTrustActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import { generateProjectDiagnosticContext } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions> & ReturnType<typeof useValidationTrustActions>

export function useDiagnosticGenerateActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { autoCopyGeneratedReports, diagnosticFileLimit, isGeneratingCommitContextRef, locale, rootFolderRef, setDiagnosticContextKind, setNotice, setPreparedDiagnosticContexts, workMode } = state
	const { beginCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, archiveContextSnapshot, invalidateMissingRootFolder, requestProjectExecutionTrust } = deps

	const loadDiagnosticContext = useCallback(
		async (
			kind: ProjectDiagnosticKind,
			cancellationToken: CancellableContextOperationToken,
		): Promise<{
			content: string
			data: ProjectDiagnosticContextData
		} | null> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return null

			if (await invalidateMissingRootFolder())
				return null

			if (!await requestProjectExecutionTrust(
				configuredRootFolder,
				null,
				kind,
			) ||
				!isCancellableContextOperationActive(cancellationToken))
				return null

			const data = await generateProjectDiagnosticContext(
				configuredRootFolder,
				kind,
				diagnosticFileLimit,
			)

			if (!isCancellableContextOperationActive(cancellationToken))
				return null

			return {
				content: formatProjectDiagnosticContext(
					data,
					locale,
					workMode,
				),
				data,
			}
		},
		[
			isCancellableContextOperationActive,
			diagnosticFileLimit,
			invalidateMissingRootFolder,
			locale,
			requestProjectExecutionTrust,
			workMode,
			rootFolderRef,
		],
	)

	const generateDiagnosticContextReport = useCallback(
		async (kind: ProjectDiagnosticKind): Promise<void> => {
			if (isGeneratingCommitContextRef.current)
				return

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			const cancellationToken = beginCancellableContextOperation(kind)

			if (cancellationToken === null)
				return

			setPreparedDiagnosticContexts(current => ({
				...current,
				[kind]: null,
			}))
			isGeneratingCommitContextRef.current = true
			setDiagnosticContextKind(kind)

			try {
				const result = await loadDiagnosticContext(
					kind,
					cancellationToken,
				)

				if (result === null || !isCancellableContextOperationActive(cancellationToken))
					return

				const prepared: PreparedDiagnosticContext = {
					rootFolder: configuredRootFolder,
					locale,
					workMode,
					diagnosticFileLimit,
					kind,
					content: result.content,
					byteCount: getGeneratedContentByteCount(result.content),
				}

				setPreparedDiagnosticContexts(current => ({
					...current,
					[kind]: prepared,
				}))

				if (!await archiveContextSnapshot(
					result.content,
					result.data.selectedFileCount,
					kind,
				))
					return

				let notice = createProjectDiagnosticNotice(
					result.data,
					locale,
				)

				if (autoCopyGeneratedReports) {
					try {
						await writeText(result.content)
						notice = {
							...notice,
							message: `${notice.message} ${translate(
								locale,
								"workspace.generatedReportAutoCopied",
							)}`,
						}
					} catch (error) {
						notice = {
							kind: "warning",
							message: `${notice.message} ${translate(
								locale,
								"workspace.generatedReportAutoCopyFailed",
								{
									error: getErrorMessage(
										error,
										locale,
									),
								},
							)}`,
						}
					}
				}

				if (isCancellableContextOperationActive(cancellationToken))
					setNotice(notice)
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.diagnosticContextFailed",
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
					setDiagnosticContextKind(null)
				}
			}
		},
		[
			archiveContextSnapshot,
			autoCopyGeneratedReports,
			beginCancellableContextOperation,
			diagnosticFileLimit,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			loadDiagnosticContext,
			locale,
			workMode,
			isGeneratingCommitContextRef,
			rootFolderRef,
			setDiagnosticContextKind,
			setNotice,
			setPreparedDiagnosticContexts,
		],
	)

	return {
		loadDiagnosticContext,
		generateDiagnosticContextReport,
	}
}
