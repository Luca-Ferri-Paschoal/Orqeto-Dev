import {
	createOperationOutcome,
	deriveOperationOutcomeStatus,
} from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import type { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import { saveExportFile } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceCoreStateActions> & ReturnType<typeof useWorkspaceHistoryActions> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useGeneratedExportActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { autoClearAfterExport, filesRef, isOperationRunningRef, locale, rootFolderRef, setIsProcessing, setNotice, setOperationRevision } = state
	const { beginCancellableContextOperation, commitCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, replaceFiles, archiveContextSnapshot, materializeSelectedContext, copyContextToClipboard } = deps

	const copyGeneratedContent = useCallback(
		async (): Promise<void> => {
			if (isOperationRunningRef.current || filesRef.current.length === 0)
				return

			const cancellationToken = beginCancellableContextOperation("custom")

			if (cancellationToken === null)
				return

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				const materialized = await materializeSelectedContext()

				if (!isCancellableContextOperationActive(cancellationToken))
					return

				if (materialized === null || materialized.content.length === 0) {
					const outcome = createOperationOutcome({
						operationType: "context_materialize",
						projectRoot: rootFolderRef.current,
						status: "blocked",
						counters: [{
							kind: "unavailable",
							files: materialized?.skippedFiles ?? filesRef.current.length,
							directories: materialized?.skippedDirectories ?? 0,
						}],
					})

					setNotice(createOperationOutcomeNotice(
						locale,
						outcome,
						"workspace.contextNothingAvailable",
					))
					return
				}

				const preserveSelection = autoClearAfterExport && materialized.skippedFiles > 0

				if (!commitCancellableContextOperation(cancellationToken))
					return

				if (!await copyContextToClipboard(
					materialized.content,
					materialized.fileCount,
					autoClearAfterExport && !preserveSelection,
				))
					return

				const outcome = createOperationOutcome({
					operationType: "context_materialize",
					projectRoot: rootFolderRef.current,
					status: deriveOperationOutcomeStatus({
						changed: materialized.fileCount,
						skipped: materialized.skippedFiles,
					}),
					counters: [
						{
							kind: "materialized",
							files: materialized.fileCount,
							directories: materialized.directoryCount,
						},
						{
							kind: "unavailable",
							files: materialized.skippedFiles,
							directories: materialized.skippedDirectories,
						},
					],
				})
				const details = preserveSelection ?
					[translate(
						locale,
						"status.context.selectionPreserved",
					)] :
					[]

				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.contextCopiedLive",
					{},
					details,
				))
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isOperationRunningRef.current = false
					setOperationRevision(revision => revision + 1)
					setIsProcessing(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			autoClearAfterExport,
			copyContextToClipboard,
			locale,
			materializeSelectedContext,
			filesRef,
			isOperationRunningRef,
			rootFolderRef,
			setIsProcessing,
			setNotice,
			setOperationRevision,
		],
	)

	const downloadGeneratedContent = useCallback(
		async (): Promise<void> => {
			if (isOperationRunningRef.current || filesRef.current.length === 0)
				return

			const cancellationToken = beginCancellableContextOperation("custom")

			if (cancellationToken === null)
				return

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				const materialized = await materializeSelectedContext()

				if (!isCancellableContextOperationActive(cancellationToken))
					return

				if (materialized === null || materialized.content.length === 0) {
					const outcome = createOperationOutcome({
						operationType: "context_materialize",
						projectRoot: rootFolderRef.current,
						status: "blocked",
						counters: [{
							kind: "unavailable",
							files: materialized?.skippedFiles ?? filesRef.current.length,
							directories: materialized?.skippedDirectories ?? 0,
						}],
					})

					setNotice(createOperationOutcomeNotice(
						locale,
						outcome,
						"workspace.contextNothingAvailable",
					))
					return
				}

				if (!commitCancellableContextOperation(cancellationToken))
					return

				const saved = await saveExportFile({
					suggestedFileName: "orqeto-dev-context.txt",
					dialogTitle: translate(
						locale,
						"dialog.saveContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
					content: materialized.content,
				})

				if (!saved)
					return

				if (!await archiveContextSnapshot(
					materialized.content,
					materialized.fileCount,
					"custom",
				))
					return

				const preserveSelection = autoClearAfterExport && materialized.skippedFiles > 0

				if (autoClearAfterExport && !preserveSelection)
					replaceFiles([])

				const outcome = createOperationOutcome({
					operationType: "context_materialize",
					projectRoot: rootFolderRef.current,
					status: deriveOperationOutcomeStatus({
						changed: materialized.fileCount,
						skipped: materialized.skippedFiles,
					}),
					counters: [
						{
							kind: "materialized",
							files: materialized.fileCount,
							directories: materialized.directoryCount,
						},
						{
							kind: "unavailable",
							files: materialized.skippedFiles,
							directories: materialized.skippedDirectories,
						},
					],
				})
				const details = preserveSelection ?
					[translate(
						locale,
						"status.context.selectionPreserved",
					)] :
					[]

				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.contextDownloadedLive",
					{},
					details,
				))
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isOperationRunningRef.current = false
					setOperationRevision(revision => revision + 1)
					setIsProcessing(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			archiveContextSnapshot,
			autoClearAfterExport,
			locale,
			materializeSelectedContext,
			replaceFiles,
			filesRef,
			isOperationRunningRef,
			rootFolderRef,
			setIsProcessing,
			setNotice,
			setOperationRevision,
		],
	)

	return {
		copyGeneratedContent,
		downloadGeneratedContent,
	}
}
