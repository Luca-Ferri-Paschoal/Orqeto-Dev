import { filterContextFiles } from "../../contextPathFilter"
import {
	createOperationOutcome,
	deriveOperationOutcomeStatus,
} from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { ContextSelectionFile } from "../../types"
import type { ContextRemovalActionStats } from "../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import {
	countAffectedDirectories,
	isPathInsideDirectory,
	selectionContainsPath,
} from "../utils"
import type { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import { resolveContextRemovalPaths } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceCoreStateActions> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useContextRemoveActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { contextFilterMode, contextFilterTarget, contextPathFilter, contextPathFilterError, filesRef, isOperationRunningRef, locale, rootFolderRef, setIsProcessing, setNotice, setOperationRevision } = state
	const { beginCancellableContextOperation, commitCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, replaceFiles, invalidateMissingRootFolder } = deps

	const removeDroppedPaths = useCallback(
		async (
			paths: string[],
			externalAction = false,
		) => {
			if (isOperationRunningRef.current) {
				const message = translate(
					locale,
					"workspace.contextBusy",
				)

				if (externalAction)
					throw new Error(message)

				setNotice({
					kind: "info",
					message,
				})
				return
			}

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				const message = translate(
					locale,
					"workspace.selectRootForContext",
				)

				if (externalAction)
					throw new Error(message)

				setNotice({
					kind: "warning",
					message,
				})
				return
			}

			if (contextPathFilterError !== null) {
				if (externalAction)
					throw new Error(contextPathFilterError)

				setNotice({
					kind: "warning",
					message: contextPathFilterError,
				})
				return
			}

			const uniquePaths = [...new Set(paths)]

			if (uniquePaths.length === 0)
				return

			const cancellationToken = beginCancellableContextOperation(
				"create",
				!externalAction,
			)

			if (cancellationToken === null)
				return

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				if (await invalidateMissingRootFolder()) {
					if (externalAction) {
						throw new Error(translate(
							locale,
							"workspace.rootMissing",
						))
					}

					return
				}

				const removalPaths = await resolveContextRemovalPaths(
					configuredRootFolder,
					uniquePaths,
				)

				if (!commitCancellableContextOperation(cancellationToken))
					return

				const currentFiles = filesRef.current
				const currentPathSet = new Set<string>(currentFiles.map(file => file.relativePath))
				const matchesRemovalPath = (
					file: ContextSelectionFile,
					removalPath: (typeof removalPaths)[number],
				): boolean => removalPath.isDirectory ?
						isPathInsideDirectory(
							file.relativePath,
							removalPath.relativePath,
						) :
						file.relativePath === removalPath.relativePath
				const candidateFiles = currentFiles.filter(file =>
					removalPaths.some(removalPath => matchesRemovalPath(
						file,
						removalPath,
					)))
				const filteredRemovalFiles = filterContextFiles(
					candidateFiles,
					{
						pattern: contextPathFilter,
						target: contextFilterTarget,
						mode: contextFilterMode,
					},
				)
				const filteredRemovalPaths = new Set<string>(filteredRemovalFiles.map(file =>
					file.relativePath))
				const nextFiles = currentFiles.filter(file =>
					!filteredRemovalPaths.has(file.relativePath))
				const actionStats: ContextRemovalActionStats = {
					removedFiles: filteredRemovalFiles.length,
					removedDirectories: 0,
					notPresentFiles: 0,
					notPresentDirectories: 0,
					filteredFiles: candidateFiles.length - filteredRemovalFiles.length,
					filteredDirectories: 0,
				}

				const requestedDirectoryPaths = removalPaths
					.filter(path => path.isDirectory)
					.map(path => path.relativePath)

				for (const removalPath of removalPaths) {
					const hasSelected = selectionContainsPath(
						currentPathSet,
						removalPath.relativePath,
						removalPath.isDirectory,
					)

					if (!hasSelected) {
						if (removalPath.isDirectory)
							actionStats.notPresentDirectories += 1
						else
							actionStats.notPresentFiles += 1
					}
				}

				actionStats.removedDirectories = countAffectedDirectories(
					filteredRemovalPaths,
					requestedDirectoryPaths,
				)
				const filteredOutPaths = candidateFiles
					.map(file => file.relativePath)
					.filter(path => !filteredRemovalPaths.has(path))
				actionStats.filteredDirectories = countAffectedDirectories(
					filteredOutPaths,
					requestedDirectoryPaths,
				)

				if (actionStats.removedFiles > 0)
					replaceFiles(nextFiles)

				const outcome = createOperationOutcome({
					operationType: "context_remove",
					projectRoot: configuredRootFolder,
					status: deriveOperationOutcomeStatus({
						changed: actionStats.removedFiles,
						unchanged: actionStats.notPresentFiles +
							actionStats.notPresentDirectories,
						skipped: actionStats.filteredFiles +
							actionStats.filteredDirectories,
					}),
					counters: [
						{
							kind: "removed",
							files: actionStats.removedFiles,
							directories: actionStats.removedDirectories,
						},
						{
							kind: "not_present",
							files: actionStats.notPresentFiles,
							directories: actionStats.notPresentDirectories,
						},
						{
							kind: "filtered",
							files: actionStats.filteredFiles,
							directories: actionStats.filteredDirectories,
						},
					],
				})

				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.contextSelectionRemoved",
				))
			} catch (error) {
				if (isCancellableContextOperationActive(cancellationToken)) {
					setNotice({
						kind: "error",
						message: getErrorMessage(
							error,
							locale,
						),
					})

					if (externalAction)
						throw error
				}
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
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			invalidateMissingRootFolder,
			locale,
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
		removeDroppedPaths,
	}
}
