import { getGeneratedContentByteCount } from "../../formatGeneratedContent"
import { formatGitCommitComparison } from "../../formatGitCommitComparison"
import type { AppNotice } from "../../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import { compareGitCommits } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useGitCommitComparisonActions(state: WorkspaceState, deps: Dependencies) {
	const {
		autoCopyGeneratedReports,
		isGeneratingCommitContextRef,
		locale,
		rootFolderRef,
		setIsGeneratingCommitContext,
		setNotice,
		setPreparedGitCommitContext,
		workMode,
	} = state
	const {
		archiveContextSnapshot,
		beginCancellableContextOperation,
		finishCancellableContextOperation,
		invalidateMissingRootFolder,
		isCancellableContextOperationActive,
	} = deps

	const generateGitCommitComparisonReport = useCallback(async (from: string, to: string): Promise<void> => {
		if (isGeneratingCommitContextRef.current || from === to)
			return
		const root = rootFolderRef.current
		if (root === null || await invalidateMissingRootFolder())
			return
		const token = beginCancellableContextOperation("commit")
		if (token === null)
			return
		isGeneratingCommitContextRef.current = true
		setIsGeneratingCommitContext(true)
		setPreparedGitCommitContext(null)
		try {
			const result = await compareGitCommits(
				root,
				from,
				to,
			)
			if (rootFolderRef.current !== root || !isCancellableContextOperationActive(token))
				return
			const content = formatGitCommitComparison(
				locale,
				result,
			)
			setPreparedGitCommitContext({
				rootFolder: root,
				locale,
				workMode,
				repositoryName: result.repositoryName,
				variant: "compare",
				fromCommit: result.initial.hash,
				toCommit: result.finalCommit.hash,
				comparisonStats: { fileCount: result.fileCount, addedLines: result.addedLines, deletedLines: result.deletedLines },
				content,
				byteCount: getGeneratedContentByteCount(content),
			})
			if (!await archiveContextSnapshot(
				content,
				result.fileCount,
				"commit",
			))
				return
			let notice: AppNotice = {
				kind: "success",
				message: translate(
					locale,
					"workspace.gitCommitComparisonGenerated",
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
						message: `${notice.message} ${translate(locale, "workspace.generatedReportAutoCopyFailed", {
							error: getErrorMessage(
								error,
								locale,
							),
						})}`,
					}
				}
			}
			if (rootFolderRef.current === root && isCancellableContextOperationActive(token))
				setNotice(notice)
		} catch (error) {
			if (isCancellableContextOperationActive(token)) {
				setNotice({
					kind: "error",
					message: translate(locale, "workspace.gitCommitComparisonFailed", {
						error: getErrorMessage(
							error,
							locale,
						),
					}),
				})
			}
		} finally {
			if (finishCancellableContextOperation(token)) {
				isGeneratingCommitContextRef.current = false
				setIsGeneratingCommitContext(false)
			}
		}
	}, [
		archiveContextSnapshot,
		autoCopyGeneratedReports,
		beginCancellableContextOperation,
		finishCancellableContextOperation,
		invalidateMissingRootFolder,
		isCancellableContextOperationActive,
		isGeneratingCommitContextRef,
		locale,
		rootFolderRef,
		setIsGeneratingCommitContext,
		setNotice,
		setPreparedGitCommitContext,
		workMode,
	])

	return { generateGitCommitComparisonReport }
}
