import { getGeneratedContentByteCount } from "../../formatGeneratedContent"
import { formatGitCommitContext } from "../../formatGitCommitContext"
import type {
	AppNotice,
	GitCommitContextData,
} from "../../types"
import type { CancellableContextOperationToken } from "../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	generateGitCommitContext,
	saveExportFile,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useGitContextActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { autoCopyGeneratedReports, currentPreparedGitCommitContext, isGeneratingCommitContextRef, locale, rootFolderRef, setIsGeneratingCommitContext, setNotice, setPreparedGitCommitContext, workMode } = state
	const { beginCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, archiveContextSnapshot, invalidateMissingRootFolder } = deps

	const loadGitCommitContext = useCallback(
		async (cancellationToken: CancellableContextOperationToken): Promise<GitCommitContextData | null> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return null

			if (await invalidateMissingRootFolder())
				return null

			const data = await generateGitCommitContext(configuredRootFolder)

			if (!isCancellableContextOperationActive(cancellationToken))
				return null

			return data
		},
		[
			isCancellableContextOperationActive,
			invalidateMissingRootFolder,
			rootFolderRef,
		],
	)

	const generateGitCommitContextReport = useCallback(
		async (): Promise<void> => {
			if (isGeneratingCommitContextRef.current)
				return

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			const cancellationToken = beginCancellableContextOperation("commit")

			if (cancellationToken === null)
				return

			setPreparedGitCommitContext(null)
			isGeneratingCommitContextRef.current = true
			setIsGeneratingCommitContext(true)

			try {
				const data = await loadGitCommitContext(cancellationToken)

				if (data === null || !isCancellableContextOperationActive(cancellationToken))
					return

				const content = formatGitCommitContext(
					data,
					locale,
					workMode,
				)

				setPreparedGitCommitContext({
					rootFolder: configuredRootFolder,
					locale,
					workMode,
					repositoryName: data.repositoryName,
					variant: "current",
					fromCommit: null,
					toCommit: null,
					comparisonStats: null,
					content,
					byteCount: getGeneratedContentByteCount(content),
				})

				if (!await archiveContextSnapshot(
					content,
					0,
					"commit",
				))
					return

				let notice: AppNotice = {
					kind: data.status.trim().length === 0 ?
						"info" :
						"success",
					message: translate(
						locale,
						data.status.trim().length === 0 ?
							"workspace.gitCommitContextClean" :
							"workspace.gitCommitContextGenerated",
					),
				}

				if (autoCopyGeneratedReports) {
					try {
						await writeText(content)
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
						"workspace.gitCommitContextFailed",
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
					setIsGeneratingCommitContext(false)
				}
			}
		},
		[
			archiveContextSnapshot,
			autoCopyGeneratedReports,
			beginCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			loadGitCommitContext,
			locale,
			workMode,
			isGeneratingCommitContextRef,
			rootFolderRef,
			setIsGeneratingCommitContext,
			setNotice,
			setPreparedGitCommitContext,
		],
	)

	const copyGitCommitContext = useCallback(
		async (): Promise<void> => {
			const prepared = currentPreparedGitCommitContext

			if (prepared === null)
				return

			try {
				await writeText(prepared.content)
				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.gitCommitContextCopied",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.gitCommitContextCopyFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			currentPreparedGitCommitContext,
			locale,
			setNotice,
		],
	)

	const downloadGitCommitContext = useCallback(
		async (): Promise<void> => {
			const prepared = currentPreparedGitCommitContext

			if (prepared === null)
				return

			try {
				const safeRepositoryName = prepared.repositoryName
					.replace(/[<>:"/\\|?*]/g, "-")
					.replace(/\.+$/, "") || "repository"
				const saved = await saveExportFile({
					suggestedFileName: prepared.variant === "compare" && prepared.fromCommit !== null && prepared.toCommit !== null ?
						`${safeRepositoryName}-${prepared.fromCommit.slice(
							0,
							8,
						)}-${prepared.toCommit.slice(
							0,
							8,
						)}-commit-comparison.txt` :
						`${safeRepositoryName}-commit-context.txt`,
					dialogTitle: translate(
						locale,
						"dialog.saveCommitContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
					content: prepared.content,
				})

				if (!saved)
					return

				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.gitCommitContextDownloaded",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.gitCommitContextDownloadFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			currentPreparedGitCommitContext,
			locale,
			setNotice,
		],
	)

	return {
		loadGitCommitContext,
		generateGitCommitContextReport,
		copyGitCommitContext,
		downloadGitCommitContext,
	}
}
