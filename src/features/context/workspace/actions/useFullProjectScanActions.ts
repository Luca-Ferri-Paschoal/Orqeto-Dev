import type { ContextFilter } from "../../contextPathFilter"
import { filterContextFiles } from "../../contextPathFilter"
import { formatGeneratedContent } from "../../formatGeneratedContent"
import type { ProcessDropResult } from "../../types"
import type { CancellableContextOperationToken } from "../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import type { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { getErrorMessage } from "@/features/context/utils"
import {
	materializeContextFiles,
	processDrop,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type Dependencies = ReturnType<typeof useCancellableOperations> & ReturnType<typeof useWorkspaceMaterializationActions>

export function useFullProjectScanActions(
	state: WorkspaceState,
	deps: Dependencies,
) {
	const { contextFilterMode, contextFilterTarget, contextPathFilter, contextPathFilterError, fullProjectContextScanState, fullProjectSummaryRequestVersionRef, isInspectingProjectContextRef, locale, pathsOnly, rootFolderRef, setFullProjectContextScanState, setIsInspectingProjectContext, setNotice, workMode } = state
	const { beginCancellableContextOperation, finishCancellableContextOperation, isCancellableContextOperationActive, invalidateMissingRootFolder } = deps

	const refreshFullProjectContextSummary = useCallback(
		async (): Promise<void> => {
			const requestVersion = fullProjectSummaryRequestVersionRef.current + 1
			fullProjectSummaryRequestVersionRef.current = requestVersion
			const requestedRootFolder = rootFolderRef.current

			if (requestedRootFolder === null)
				return

			setFullProjectContextScanState({
				rootFolder: requestedRootFolder,
				value: null,
			})

			if (contextPathFilterError !== null)
				return

			if (isInspectingProjectContextRef.current)
				return

			const cancellationToken = beginCancellableContextOperation("project")

			if (cancellationToken === null)
				return

			isInspectingProjectContextRef.current = true
			setIsInspectingProjectContext(true)
			const filter: ContextFilter = {
				pattern: contextPathFilter,
				target: contextFilterTarget,
				mode: contextFilterMode,
			}

			try {
				if (await invalidateMissingRootFolder())
					return

				const selection: ProcessDropResult = await processDrop(
					requestedRootFolder,
					[requestedRootFolder],
				)

				if (!isCancellableContextOperationActive(cancellationToken))
					return

				if (requestVersion !== fullProjectSummaryRequestVersionRef.current)
					return

				if (rootFolderRef.current !== requestedRootFolder)
					return

				const filteredFiles = filterContextFiles(
					selection.files,
					filter,
				)
				const byteCount = filteredFiles.reduce(
					(
						total,
						file,
					) => total + file.sizeBytes,
					0,
				)

				setFullProjectContextScanState({
					rootFolder: requestedRootFolder,
					value: {
						summary: {
							fileCount: filteredFiles.length,
							byteCount,
						},
						relativePaths: filteredFiles.map(file => file.relativePath),
					},
				})
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

				if (requestVersion !== fullProjectSummaryRequestVersionRef.current)
					return

				const currentRootFolder = rootFolderRef.current

				if (currentRootFolder !== null) {
					setNotice({
						kind: "error",
						message: translate(
							locale,
							"workspace.projectContextFailed",
							{
								error: getErrorMessage(
									error,
									locale,
								),
							},
						),
					})
				}
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isInspectingProjectContextRef.current = false
					setIsInspectingProjectContext(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			invalidateMissingRootFolder,
			locale,
			fullProjectSummaryRequestVersionRef,
			isInspectingProjectContextRef,
			rootFolderRef,
			setFullProjectContextScanState,
			setIsInspectingProjectContext,
			setNotice,
		],
	)

	const getScannedFullProjectContextFiles = useCallback(
		(): {
			rootFolder: string
			relativePaths: string[]
		} | null => {
			const configuredRootFolder = rootFolderRef.current
			const scan = fullProjectContextScanState.rootFolder === configuredRootFolder ?
				fullProjectContextScanState.value :
				null

			if (configuredRootFolder === null || scan === null) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.projectContextScanRequired",
					),
				})
				return null
			}

			return {
				rootFolder: configuredRootFolder,
				relativePaths: scan.relativePaths,
			}
		},
		[
			fullProjectContextScanState,
			locale,
			rootFolderRef,
			setNotice,
		],
	)

	const loadFullProjectContext = useCallback(
		async (cancellationToken: CancellableContextOperationToken): Promise<{
			content: string
			fileCount: number
		} | null> => {
			const discovery = getScannedFullProjectContextFiles()

			if (discovery === null)
				return null

			if (discovery.relativePaths.length === 0) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.projectContextEmpty",
					),
				})
				return null
			}

			const materialized = await materializeContextFiles(
				discovery.rootFolder,
				discovery.relativePaths,
				pathsOnly,
			)

			if (!isCancellableContextOperationActive(cancellationToken))
				return null

			if (materialized.files.length === 0) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.projectContextEmpty",
					),
				})
				return null
			}

			return {
				content: formatGeneratedContent(
					materialized.files,
					locale,
					workMode,
				),
				fileCount: materialized.files.length,
			}
		},
		[
			isCancellableContextOperationActive,
			getScannedFullProjectContextFiles,
			locale,
			pathsOnly,
			workMode,
			setNotice,
		],
	)

	return {
		refreshFullProjectContextSummary,
		getScannedFullProjectContextFiles,
		loadFullProjectContext,
	}
}
