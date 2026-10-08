import {
	mergeContextSelection,
	normalizeContextSelection,
} from "../../contextSelection"
import type { ContextSelectionFile } from "../../types"
import type { UseContextWorkspaceOptions } from "../types"
import type { WorkspaceState } from "../useWorkspaceState"
import {
	getProjectDiagnosticCapabilities,
	isGitRepository as checkGitRepository,
} from "@/infra/desktop"
import {
	useCallback,
	useEffect,
} from "react"

export function useWorkspaceCoreStateActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
) {
	const { contextSelectionRevisionRef, filesRef, fullProjectSummaryRequestVersionRef, operationRevision, rootFolder, rootFolderRef, rootRevisionRef, setDiagnosticCapabilitiesState, setFiles, setFullProjectContextScanState, setGitRepositoryState, setRootFolder } = state
	const { active } = options

	const replaceFiles = useCallback(
		(nextFiles: ContextSelectionFile[]) => {
			const normalizedFiles = normalizeContextSelection(nextFiles)

			contextSelectionRevisionRef.current += 1
			filesRef.current = normalizedFiles
			setFiles(normalizedFiles)
		},
		[contextSelectionRevisionRef, filesRef, setFiles],
	)

	const appendFiles = useCallback(
		(addedFiles: ContextSelectionFile[]) => {
			const result = mergeContextSelection(
				filesRef.current,
				addedFiles,
			)

			if (result.addedFiles > 0) {
				contextSelectionRevisionRef.current += 1
				filesRef.current = result.files
				setFiles(result.files)
			}

			return result
		},
		[contextSelectionRevisionRef, filesRef, setFiles],
	)

	const updateRootFolderState = useCallback(
		(value: string | null) => {
			if (rootFolderRef.current !== value) {
				rootRevisionRef.current += 1
				fullProjectSummaryRequestVersionRef.current += 1
				setFullProjectContextScanState({
					rootFolder: value,
					value: null,
				})
			}

			rootFolderRef.current = value
			setRootFolder(value)
		},
		[fullProjectSummaryRequestVersionRef, rootFolderRef, rootRevisionRef, setFullProjectContextScanState, setRootFolder],
	)

	useEffect(
		() => {
			if (rootFolder === null)
				return

			let cancelled = false

			void checkGitRepository(rootFolder)
				.then(value => {
					if (!cancelled) {
						setGitRepositoryState({
							rootFolder,
							value,
						})
					}
				})
				.catch(() => {
					if (!cancelled) {
						setGitRepositoryState({
							rootFolder,
							value: false,
						})
					}
				})

			return () => {
				cancelled = true
			}
		},
		[rootFolder, setGitRepositoryState],
	)

	useEffect(
		() => {
			if (!active || rootFolder === null)
				return

			let cancelled = false
			let refreshRevision = 0

			const refreshCapabilities = (): void => {
				const revision = ++refreshRevision

				void getProjectDiagnosticCapabilities(rootFolder)
					.then(value => {
						if (!cancelled && revision === refreshRevision) {
							setDiagnosticCapabilitiesState({
								rootFolder,
								value,
							})
						}
					})
					.catch(() => {
						if (!cancelled && revision === refreshRevision) {
							setDiagnosticCapabilitiesState({
								rootFolder,
								value: {
									typecheck: false,
									eslint: false,
									lintFixCommand: null,
									testCommand: null,
									developmentLogCommand: null,
								},
							})
						}
					})
			}

			refreshCapabilities()
			window.addEventListener(
				"focus",
				refreshCapabilities,
			)

			return () => {
				cancelled = true
				window.removeEventListener(
					"focus",
					refreshCapabilities,
				)
			}
		},
		[
			active,
			operationRevision,
			rootFolder,
			setDiagnosticCapabilitiesState,
		],
	)

	return {
		replaceFiles,
		appendFiles,
		updateRootFolderState,
	}
}
