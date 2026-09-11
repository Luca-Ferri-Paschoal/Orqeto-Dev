import {
	type ContextFilter,
	type ContextFilterHistoryEntry,
	type ContextFilterMode,
	type ContextFilterTarget,
	filterContextFiles,
	filterSkippedFiles,
	getContextPathFilterError,
	normalizeContextPathFilter,
} from "./contextPathFilter"
import {
	formatGeneratedContent,
	getGeneratedContentByteCount,
	getGeneratedContentSize,
} from "./formatGeneratedContent"
import type {
	AppNotice,
	AppSettings,
	ContextHistoryEntry,
	GeneratedFile,
	OverlayDestinationCandidate,
	OverlayUndoHistoryEntry,
	PendingProjectOverlay,
} from "./types"
import {
	deleteContextFilterHistoryEntry,
	deleteContextHistoryEntry,
	getContextFilterHistory,
	getContextHistory,
	saveContextFilterHistoryEntry,
	saveContextHistoryEntry,
} from "@/infra/configDatabase"
import {
	applyProjectOverlay,
	cleanupNativeDrop,
	closeFolderInExplorer,
	discardProjectOverlayUndo,
	findProjectForRoot,
	folderExists,
	getProjectOverlayUndoHistory,
	openFolderInExplorer,
	prepareProjectOverlay,
	processDrop,
	resolveContextRemovalPaths,
	undoProjectOverlay,
	writeExportFile,
} from "@/infra/desktop"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { dirname } from "@tauri-apps/api/path"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import {
	open,
	save,
} from "@tauri-apps/plugin-dialog"
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"

function getErrorMessage(
	error: unknown,
	locale: Locale,
): string {
	if (error instanceof Error)
		return error.message

	if (typeof error === "string")
		return error

	return translate(
		locale,
		"workspace.unexpectedError",
	)
}

interface OverlayQueueItem {
	paths: string[]
	sourceLabel: string
	fileCount: number
	deleteCount: number
	candidates: OverlayDestinationCandidate[]
}

interface OverlayBatchStats {
	createdFiles: number
	editedFiles: number
	deletedFiles: number
	rejectedFiles: number
	skippedFiles: number
	firstFailure: string | null
}

interface MergeContextResult {
	files: GeneratedFile[]
	addedFiles: number
	updatedFiles: number
	unchangedFiles: number
}

function getPathLabel(path: string): string {
	const normalized = path.replaceAll(
		"\\",
		"/",
	).replace(
		/\/$/,
		"",
	)
	const segments = normalized
		.split("/")
		.filter(segment => segment.length > 0)

	return segments.length === 0 ?
		path :
		segments.slice(-3).join("/")
}

function getContextAddSummary(
	locale: Locale,
	result: MergeContextResult,
	ignoredFiles: number,
): string {
	const parts: string[] = []

	if (result.addedFiles > 0) {
		parts.push(translateCount(
			locale,
			result.addedFiles,
			"workspace.contextAdded.one",
			"workspace.contextAdded.other",
		))
	}

	if (result.updatedFiles > 0) {
		parts.push(translateCount(
			locale,
			result.updatedFiles,
			"workspace.contextUpdated.one",
			"workspace.contextUpdated.other",
		))
	}

	if (result.unchangedFiles > 0) {
		parts.push(translateCount(
			locale,
			result.unchangedFiles,
			"workspace.contextPresent.one",
			"workspace.contextPresent.other",
		))
	}

	if (ignoredFiles > 0) {
		parts.push(translateCount(
			locale,
			ignoredFiles,
			"workspace.contextIgnored.one",
			"workspace.contextIgnored.other",
		))
	}

	return `${parts.join(" · ")}.`
}

function getContextRemoveSummary(
	locale: Locale,
	removedFiles: number,
	notPresentFiles: number,
	ignoredFiles: number,
): string {
	const parts: string[] = []

	if (removedFiles > 0) {
		parts.push(translateCount(
			locale,
			removedFiles,
			"workspace.contextRemoved.one",
			"workspace.contextRemoved.other",
		))
	}

	if (notPresentFiles > 0) {
		parts.push(translateCount(
			locale,
			notPresentFiles,
			"workspace.contextNotPresent.one",
			"workspace.contextNotPresent.other",
		))
	}

	if (ignoredFiles > 0) {
		parts.push(translateCount(
			locale,
			ignoredFiles,
			"workspace.contextIgnored.one",
			"workspace.contextIgnored.other",
		))
	}

	return parts.length > 0 ?
		`${parts.join(" · ")}.` :
		translate(
			locale,
			"workspace.contextNothingToRemove",
		)
}

export type ContextWorkspacePreferences = AppSettings

export interface UseContextWorkspaceOptions {
	initialRootFolder: string | null
	folderPickerReferenceRoot: string | null
	preferences: ContextWorkspacePreferences
	onRootFolderChange: (rootFolder: string | null) => Promise<boolean>
}

export function useContextWorkspace({
	initialRootFolder,
	folderPickerReferenceRoot,
	preferences,
	onRootFolderChange,
}: UseContextWorkspaceOptions) {
	const [rootFolder, setRootFolder] = useState<string | null>(initialRootFolder)
	const {
		locale,
		autoCopyContextAfterAdd,
		autoClearAfterExport,
		contextFilterHistoryLimit,
		contextHistoryLimit,
		overlayUndoHistoryLimit,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
	} = preferences
	const [contextPathFilter, setContextPathFilter] = useState("")
	const [contextFilterTarget, setContextFilterTarget] = useState<ContextFilterTarget>("fileName")
	const [contextFilterMode, setContextFilterMode] = useState<ContextFilterMode>("contains")
	const [contextFilterHistory, setContextFilterHistory] = useState<ContextFilterHistoryEntry[]>([])
	const [contextHistory, setContextHistory] = useState<ContextHistoryEntry[]>([])
	const [pathsOnly, setPathsOnly] = useState(false)
	const [files, setFiles] = useState<GeneratedFile[]>([])
	const [notice, setNotice] = useState<AppNotice | null>(null)
	const [isReady, setIsReady] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [isApplying, setIsApplying] = useState(false)
	const [pendingOverlay, setPendingOverlay] = useState<PendingProjectOverlay | null>(null)
	const [overlayUndoHistory, setOverlayUndoHistory] = useState<OverlayUndoHistoryEntry[]>([])
	const filesRef = useRef<GeneratedFile[]>([])
	const rootFolderRef = useRef<string | null>(initialRootFolder)
	const isOperationRunningRef = useRef(false)
	const pendingOverlayQueueRef = useRef<OverlayQueueItem[]>([])
	const pendingOverlayQueueIndexRef = useRef(0)
	const hasAppliedCurrentOverlayBatchRef = useRef(false)
	const activeNativeDropRootRef = useRef<string | null>(null)
	const overlayBatchStatsRef = useRef<OverlayBatchStats>({
		createdFiles: 0,
		editedFiles: 0,
		deletedFiles: 0,
		rejectedFiles: 0,
		skippedFiles: 0,
		firstFailure: null,
	})

	const generatedContent = useMemo(
		() => formatGeneratedContent(
			files,
			locale,
		),
		[
			files,
			locale,
		],
	)
	const generatedContentSize = useMemo(
		() => getGeneratedContentSize(generatedContent),
		[generatedContent],
	)
	const contextPathFilterError = useMemo(
		() => getContextPathFilterError(
			{
				pattern: contextPathFilter,
				target: contextFilterTarget,
				mode: contextFilterMode,
			},
			locale,
		),
		[
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			locale,
		],
	)

	const replaceFiles = useCallback(
		(nextFiles: GeneratedFile[]) => {
			filesRef.current = nextFiles
			setFiles(nextFiles)
		},
		[],
	)

	const appendFiles = useCallback(
		(addedFiles: GeneratedFile[]): MergeContextResult => {
			const nextFiles = [...filesRef.current]
			const fileIndexes = new Map<string, number>()
			let addedFilesCount = 0
			let updatedFiles = 0
			let unchangedFiles = 0

			for (const [index, file] of nextFiles.entries()) {
				fileIndexes.set(
					file.relativePath,
					index,
				)
			}

			for (const addedFile of addedFiles) {
				const existingIndex = fileIndexes.get(addedFile.relativePath)

				if (existingIndex !== undefined) {
					const existingFile = nextFiles[existingIndex]

					if (existingFile?.content === addedFile.content) {
						unchangedFiles += 1
						continue
					}

					nextFiles[existingIndex] = addedFile
					updatedFiles += 1
					continue
				}

				fileIndexes.set(
					addedFile.relativePath,
					nextFiles.length,
				)
				nextFiles.push(addedFile)
				addedFilesCount += 1
			}

			filesRef.current = nextFiles
			setFiles(nextFiles)

			return {
				files: nextFiles,
				addedFiles: addedFilesCount,
				updatedFiles,
				unchangedFiles,
			}
		},
		[],
	)

	const updateRootFolderState = useCallback(
		(value: string | null) => {
			rootFolderRef.current = value
			setRootFolder(value)
		},
		[],
	)

	const loadFilterHistory = useCallback(
		async (path: string | null): Promise<void> => {
			if (path === null) {
				setContextFilterHistory([])
				return
			}

			setContextFilterHistory(await getContextFilterHistory(
				path,
				contextFilterHistoryLimit,
			))
		},
		[contextFilterHistoryLimit],
	)

	const loadContextHistory = useCallback(
		async (path: string | null): Promise<void> => {
			if (path === null) {
				setContextHistory([])
				return
			}

			setContextHistory(await getContextHistory(
				path,
				contextHistoryLimit,
			))
		},
		[contextHistoryLimit],
	)

	const cleanupActiveNativeDrop = useCallback(
		async (): Promise<void> => {
			const path = activeNativeDropRootRef.current

			if (path === null)
				return

			activeNativeDropRootRef.current = null
			await cleanupNativeDrop(path).catch(() => undefined)
		},
		[],
	)

	const refreshOverlayUndoHistory = useCallback(
		async (): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				setOverlayUndoHistory([])
				return
			}

			setOverlayUndoHistory(await getProjectOverlayUndoHistory(
				configuredRootFolder,
				overlayUndoHistoryLimit,
			))
		},
		[overlayUndoHistoryLimit],
	)

	const archiveContextSnapshot = useCallback(
		async (
			content: string,
			fileCount: number,
		): Promise<boolean> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null || content.length === 0 || fileCount === 0)
				return true

			try {
				setContextHistory(await saveContextHistoryEntry(
					configuredRootFolder,
					{
						content,
						fileCount,
						byteCount: getGeneratedContentByteCount(content),
						createdAt: Date.now(),
					},
					contextHistoryLimit,
				))
				return true
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistorySaveFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
				return false
			}
		},
		[
			contextHistoryLimit,
			locale,
		],
	)

	const clearGeneratedContent = useCallback(
		async (): Promise<void> => {
			const content = formatGeneratedContent(
				filesRef.current,
				locale,
			)

			if (!await archiveContextSnapshot(
				content,
				filesRef.current.length,
			))
				return

			replaceFiles([])
			setNotice(null)
		},
		[
			archiveContextSnapshot,
			locale,
			replaceFiles,
		],
	)

	const invalidateMissingRootFolder = useCallback(
		async (): Promise<boolean> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return true

			if (await folderExists(configuredRootFolder))
				return false

			await onRootFolderChange(null)
			await discardProjectOverlayUndo(configuredRootFolder)
			await cleanupActiveNativeDrop()
			updateRootFolderState(null)
			setContextFilterHistory([])
			setContextHistory([])
			replaceFiles([])
			pendingOverlayQueueRef.current = []
			pendingOverlayQueueIndexRef.current = 0
			hasAppliedCurrentOverlayBatchRef.current = false
			setPendingOverlay(null)
			setOverlayUndoHistory([])
			setNotice({
				kind: "warning",
				message: translate(
					locale,
					"workspace.rootMissing",
				),
			})

			return true
		},
		[
			cleanupActiveNativeDrop,
			locale,
			onRootFolderChange,
			replaceFiles,
			updateRootFolderState,
		],
	)

	const configureRootFolder = useCallback(
		async (
			path: string,
			noticeMessage: string | null,
		): Promise<boolean> => {
			if (!await folderExists(path)) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.requestedRootUnavailable",
					),
				})
				return false
			}

			const previousRootFolder = rootFolderRef.current
			const sameConfiguredProject = previousRootFolder !== null &&
				previousRootFolder !== path &&
				await findProjectForRoot(
					[previousRootFolder],
					path,
				) === 0
			const nextRootFolder = sameConfiguredProject ?
				previousRootFolder :
				path
			const folderChanged = previousRootFolder !== nextRootFolder

			if (folderChanged && !await onRootFolderChange(nextRootFolder))
				return false

			updateRootFolderState(nextRootFolder)

			if (folderChanged) {
				await cleanupActiveNativeDrop()
				replaceFiles([])
				pendingOverlayQueueRef.current = []
				pendingOverlayQueueIndexRef.current = 0
				hasAppliedCurrentOverlayBatchRef.current = false
				setPendingOverlay(null)
				setOverlayUndoHistory([])

				if (previousRootFolder !== null)
					await discardProjectOverlayUndo(previousRootFolder)
			}

			await loadFilterHistory(nextRootFolder)
			await loadContextHistory(nextRootFolder)

			if (noticeMessage !== null) {
				setNotice({
					kind: "success",
					message: noticeMessage,
				})
			}

			if (openExplorerOnProjectOpen)
				await openFolderInExplorer(nextRootFolder)

			return true
		},
		[
			cleanupActiveNativeDrop,
			loadContextHistory,
			loadFilterHistory,
			locale,
			onRootFolderChange,
			openExplorerOnProjectOpen,
			replaceFiles,
			updateRootFolderState,
		],
	)

	const openConfiguredFolder = useCallback(
		async () => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				if (await invalidateMissingRootFolder())
					return

				await openFolderInExplorer(configuredRootFolder)
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			invalidateMissingRootFolder,
			locale,
		],
	)

	const selectRootFolder = useCallback(
		async () => {
			try {
				const currentRootFolder = rootFolderRef.current
				const referenceRootFolder = currentRootFolder ?? folderPickerReferenceRoot
				const defaultPath = referenceRootFolder === null ?
					undefined :
					await dirname(referenceRootFolder)
				const selectedPath = await open({
					directory: true,
					multiple: false,
					defaultPath,
					title: translate(
						locale,
						rootFolderRef.current === null ?
							"dialog.selectRoot" :
							"dialog.changeRoot",
					),
				})

				if (selectedPath === null)
					return

				if (typeof selectedPath !== "string") {
					throw new Error(translate(
						locale,
						"workspace.invalidFolderPicker",
					))
				}

				await configureRootFolder(
					selectedPath,
					translate(
						locale,
						"workspace.rootConfigured",
					),
				)
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			configureRootFolder,
			folderPickerReferenceRoot,
			locale,
		],
	)

	const closeRootFolder = useCallback(
		async () => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			let explorerCloseError: unknown = null

			if (closeExplorerOnFolderClose) {
				try {
					await closeFolderInExplorer(configuredRootFolder)
				} catch (error) {
					explorerCloseError = error
				}
			}

			try {
				if (!await onRootFolderChange(null))
					return

				await discardProjectOverlayUndo(configuredRootFolder)
				await cleanupActiveNativeDrop()
				updateRootFolderState(null)
				setContextFilterHistory([])
				setContextHistory([])
				replaceFiles([])
				pendingOverlayQueueRef.current = []
				pendingOverlayQueueIndexRef.current = 0
				hasAppliedCurrentOverlayBatchRef.current = false
				setPendingOverlay(null)
				setOverlayUndoHistory([])

				if (explorerCloseError !== null) {
					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.rootClosedExplorerWarning",
							{
								error: getErrorMessage(
									explorerCloseError,
									locale,
								),
							},
						),
					})
					return
				}

				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.rootClosed",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			cleanupActiveNativeDrop,
			closeExplorerOnFolderClose,
			locale,
			onRootFolderChange,
			replaceFiles,
			updateRootFolderState,
		],
	)

	const updateContextPathFilter = useCallback(
		(value: string) => {
			setContextPathFilter(value)
		},
		[],
	)

	const updateContextFilterTarget = useCallback(
		(value: ContextFilterTarget) => {
			setContextFilterTarget(value)
		},
		[],
	)

	const updateContextFilterMode = useCallback(
		(value: ContextFilterMode) => {
			setContextFilterMode(value)
		},
		[],
	)

	const clearContextFilter = useCallback(
		() => {
			setContextPathFilter("")
		},
		[],
	)

	const updatePathsOnly = useCallback(
		(value: boolean) => {
			setPathsOnly(value)
		},
		[],
	)

	const selectContextFilterHistory = useCallback(
		(entry: ContextFilterHistoryEntry) => {
			setContextPathFilter(entry.pattern)
			setContextFilterTarget(entry.target)
			setContextFilterMode(entry.mode)
		},
		[],
	)

	const deleteContextFilterHistory = useCallback(
		async (entry: ContextFilterHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				setContextFilterHistory(await deleteContextFilterHistoryEntry(
					configuredRootFolder,
					entry,
					contextFilterHistoryLimit,
				))
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			contextFilterHistoryLimit,
			locale,
		],
	)

	const addDroppedPaths = useCallback(
		async (paths: string[]) => {
			if (isOperationRunningRef.current) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.contextBusy",
					),
				})
				return
			}

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				setNotice({
					kind: "warning",
					message: translate(
						locale,
						"workspace.selectRootForContext",
					),
				})
				return
			}

			if (contextPathFilterError !== null) {
				setNotice({
					kind: "warning",
					message: contextPathFilterError,
				})
				return
			}

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				if (await invalidateMissingRootFolder())
					return

				const result = await processDrop(
					configuredRootFolder,
					paths,
					pathsOnly,
				)
				const contextFilter: ContextFilter = {
					pattern: contextPathFilter,
					target: contextFilterTarget,
					mode: contextFilterMode,
				}
				const filteredFiles = filterContextFiles(
					result.files,
					contextFilter,
				)
				const filteredSkippedFiles = filterSkippedFiles(
					result.skippedFiles,
					contextFilter,
				)
				const filterEnabled = normalizeContextPathFilter(contextPathFilter).length > 0

				if (filteredFiles.length === 0) {
					if (filterEnabled && result.files.length > 0) {
						setNotice({
							kind: "info",
							message: translate(
								locale,
								pathsOnly ?
									"workspace.noPathMatches" :
									"workspace.noFilterMatches",
							),
						})
						return
					}

					const skippedMessage = filteredSkippedFiles.length > 0 ?
						translateCount(
							locale,
							filteredSkippedFiles.length,
							pathsOnly ?
								"workspace.skippedGeneric.one" :
								"workspace.skippedText.one",
							pathsOnly ?
								"workspace.skippedGeneric.other" :
								"workspace.skippedText.other",
						) :
						""

					setNotice({
						kind: "warning",
						message: translate(
							locale,
							pathsOnly ?
								"workspace.noFiles" :
								"workspace.noTextFiles",
							{
								skipped: skippedMessage,
							},
						),
					})
					return
				}

				const mergeResult = appendFiles(filteredFiles)
				let autoCopyError: unknown = null
				let filterHistoryError: unknown = null

				if (filterEnabled) {
					try {
						setContextFilterHistory(await saveContextFilterHistoryEntry(
							configuredRootFolder,
							{
								pattern: normalizeContextPathFilter(contextPathFilter),
								target: contextFilterTarget,
								mode: contextFilterMode,
								lastUsedAt: Date.now(),
							},
							contextFilterHistoryLimit,
						))
					} catch (error) {
						filterHistoryError = error
					}
				}

				if (autoCopyContextAfterAdd) {
					try {
						await writeText(formatGeneratedContent(
							mergeResult.files,
							locale,
						))
					} catch (error) {
						autoCopyError = error
					}
				}

				const autoCopyMessage = autoCopyError !== null ?
					translate(
						locale,
						"workspace.autoCopyFailed",
						{
							error: getErrorMessage(
								autoCopyError,
								locale,
							),
						},
					) :
					""
				const historyMessage = filterHistoryError !== null ?
					translate(
						locale,
						"workspace.filterHistoryFailed",
					) :
					""

				setNotice({
					kind: filteredSkippedFiles.length > 0 || autoCopyError !== null || filterHistoryError !== null ?
						"warning" :
						mergeResult.addedFiles > 0 || mergeResult.updatedFiles > 0 ?
							"success" :
							"info",
					message: `${getContextAddSummary(
						locale,
						mergeResult,
						filteredSkippedFiles.length,
					)}${autoCopyMessage}${historyMessage}`,
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				isOperationRunningRef.current = false
				setIsProcessing(false)
			}
		},
		[
			appendFiles,
			autoCopyContextAfterAdd,
			contextFilterHistoryLimit,
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			invalidateMissingRootFolder,
			locale,
			pathsOnly,
		],
	)

	const removeDroppedPaths = useCallback(
		async (paths: string[]) => {
			if (isOperationRunningRef.current) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.contextBusy",
					),
				})
				return
			}

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				setNotice({
					kind: "warning",
					message: translate(
						locale,
						"workspace.selectRootForContext",
					),
				})
				return
			}

			if (contextPathFilterError !== null) {
				setNotice({
					kind: "warning",
					message: contextPathFilterError,
				})
				return
			}

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				if (await invalidateMissingRootFolder())
					return

				const removalPaths = await resolveContextRemovalPaths(
					configuredRootFolder,
					paths,
				)
				const currentFiles = filesRef.current
				const matchesRemovalPath = (
					file: GeneratedFile,
					removalPath: (typeof removalPaths)[number],
				): boolean => {
					if (!removalPath.isDirectory)
						return file.relativePath === removalPath.relativePath

					if (removalPath.relativePath === "./")
						return file.relativePath.startsWith("./")

					return file.relativePath.startsWith(`${removalPath.relativePath}/`)
				}
				const matchedSelections = removalPaths.filter(removalPath =>
					currentFiles.some(file => matchesRemovalPath(
						file,
						removalPath,
					))).length
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
				const filteredRemovalPaths = new Set(filteredRemovalFiles.map(file =>
					file.relativePath))
				const nextFiles = currentFiles.filter(file =>
					!filteredRemovalPaths.has(file.relativePath))
				const removedFiles = filteredRemovalFiles.length
				const notPresentFiles = removalPaths.length - matchedSelections
				const ignoredFiles = candidateFiles.length - filteredRemovalFiles.length

				if (removedFiles > 0)
					replaceFiles(nextFiles)

				setNotice({
					kind: removedFiles > 0 ?
						"success" :
						"info",
					message: getContextRemoveSummary(
						locale,
						removedFiles,
						notPresentFiles,
						ignoredFiles,
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				isOperationRunningRef.current = false
				setIsProcessing(false)
			}
		},
		[
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			invalidateMissingRootFolder,
			locale,
			replaceFiles,
		],
	)

	const updateOverlayBatchNotice = useCallback(
		(pendingFiles: number) => {
			const stats = overlayBatchStatsRef.current
			const totalFiles = stats.createdFiles +
				stats.editedFiles +
				stats.deletedFiles +
				stats.rejectedFiles +
				stats.skippedFiles +
				pendingFiles
			const detail = stats.firstFailure === null ?
				"" :
				translate(
					locale,
					"workspace.applyBatchFailureDetail",
					{
						error: stats.firstFailure,
					},
				)

			setNotice({
				kind: stats.rejectedFiles > 0 || stats.skippedFiles > 0 ?
					"warning" :
					pendingFiles > 0 ?
						"info" :
						"success",
				message: translate(
					locale,
					pendingFiles > 0 ?
						"workspace.applyBatchPending" :
						"workspace.applyBatchDone",
					{
						total: totalFiles,
						created: stats.createdFiles,
						edited: stats.editedFiles,
						deleted: stats.deletedFiles,
						pending: pendingFiles,
						rejected: stats.rejectedFiles,
						skipped: stats.skippedFiles,
						detail,
					},
				),
			})
		},
		[locale],
	)

	const recordOverlayFailure = useCallback(
		(
			message: string,
			rejectedFiles = 1,
		) => {
			const stats = overlayBatchStatsRef.current

			stats.rejectedFiles += rejectedFiles

			if (stats.firstFailure === null)
				stats.firstFailure = message
		},
		[],
	)

	const recordOverlaySkip = useCallback(
		(skippedFiles: number) => {
			overlayBatchStatsRef.current.skippedFiles += skippedFiles
		},
		[],
	)

	const advancePendingOverlay = useCallback(
		() => {
			const nextIndex = pendingOverlayQueueIndexRef.current + 1
			const queue = pendingOverlayQueueRef.current

			pendingOverlayQueueIndexRef.current = nextIndex

			const next = queue[nextIndex]

			if (next === undefined) {
				pendingOverlayQueueRef.current = []
				pendingOverlayQueueIndexRef.current = 0
				hasAppliedCurrentOverlayBatchRef.current = false
				setPendingOverlay(null)
				updateOverlayBatchNotice(0)
				void refreshOverlayUndoHistory()
				void cleanupActiveNativeDrop()
				return
			}

			setPendingOverlay({
				...next,
				queuePosition: nextIndex + 1,
				queueTotal: queue.length,
			})
			updateOverlayBatchNotice(queue
				.slice(nextIndex)
				.reduce(
					(
						total,
						item,
					) => total + item.fileCount + item.deleteCount,
					0,
				))
		},
		[
			cleanupActiveNativeDrop,
			refreshOverlayUndoHistory,
			updateOverlayBatchNotice,
		],
	)

	const applyDroppedPaths = useCallback(
		async (
			paths: string[],
			nativeDropRoot: string | null = null,
		) => {
			if (isOperationRunningRef.current) {
				if (nativeDropRoot !== null)
					await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.applyBusy",
					),
				})
				return
			}

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				if (nativeDropRoot !== null)
					await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

				setNotice({
					kind: "warning",
					message: translate(
						locale,
						"workspace.selectRootForApply",
					),
				})
				return
			}

			const uniquePaths = [...new Set(paths)]

			if (uniquePaths.length === 0) {
				if (nativeDropRoot !== null)
					await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

				return
			}

			await cleanupActiveNativeDrop()
			activeNativeDropRootRef.current = nativeDropRoot
			isOperationRunningRef.current = true
			setIsApplying(true)
			pendingOverlayQueueRef.current = []
			pendingOverlayQueueIndexRef.current = 0
			hasAppliedCurrentOverlayBatchRef.current = false
			setPendingOverlay(null)
			overlayBatchStatsRef.current = {
				createdFiles: 0,
				editedFiles: 0,
				deletedFiles: 0,
				rejectedFiles: 0,
				skippedFiles: 0,
				firstFailure: null,
			}

			try {
				if (await invalidateMissingRootFolder())
					return

				const pendingItems: OverlayQueueItem[] = []

				for (const path of uniquePaths) {
					const sourceLabel = getPathLabel(path)

					try {
						const itemPaths = [path]
						const plan = await prepareProjectOverlay(
							configuredRootFolder,
							itemPaths,
						)

						if (plan.fileCount === 0 && plan.deleteCount === 0) {
							recordOverlayFailure(translate(
								locale,
								"workspace.noApplyFilesForItem",
								{ source: sourceLabel },
							))
							continue
						}

						if (plan.ambiguityLimitExceeded) {
							recordOverlayFailure(
								translate(
									locale,
									"workspace.applyTooAmbiguous",
									{
										source: sourceLabel,
										count: plan.candidateCount,
										limit: plan.ambiguityLimit,
									},
								),
								plan.fileCount + plan.deleteCount,
							)
							continue
						}

						const recommendedIndex = plan.recommendedCandidateIndex
						const recommendedCandidate = recommendedIndex === null ?
							null :
							plan.candidates[recommendedIndex] ?? null

						if (recommendedCandidate !== null) {
							const result = await applyProjectOverlay(
								configuredRootFolder,
								itemPaths,
								recommendedCandidate,
								hasAppliedCurrentOverlayBatchRef.current,
								overlayUndoHistoryLimit,
							)
							hasAppliedCurrentOverlayBatchRef.current = true
							overlayBatchStatsRef.current.createdFiles += result.addedFiles
							overlayBatchStatsRef.current.editedFiles += result.replacedFiles
							overlayBatchStatsRef.current.deletedFiles += result.deletedFiles
							continue
						}

						pendingItems.push({
							paths: itemPaths,
							sourceLabel,
							fileCount: plan.fileCount,
							deleteCount: plan.deleteCount,
							candidates: plan.candidates,
						})
					} catch (error) {
						recordOverlayFailure(translate(
							locale,
							"workspace.applyItemFailed",
							{
								source: sourceLabel,
								error: getErrorMessage(
									error,
									locale,
								),
							},
						))
					}
				}

				pendingOverlayQueueRef.current = pendingItems
				pendingOverlayQueueIndexRef.current = 0

				const firstPending = pendingItems[0]

				if (firstPending !== undefined) {
					setPendingOverlay({
						...firstPending,
						queuePosition: 1,
						queueTotal: pendingItems.length,
					})
				}

				updateOverlayBatchNotice(pendingItems.reduce(
					(
						total,
						item,
					) => total + item.fileCount + item.deleteCount,
					0,
				))
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				isOperationRunningRef.current = false
				setIsApplying(false)

				if (pendingOverlayQueueRef.current.length === 0) {
					void refreshOverlayUndoHistory()
					void cleanupActiveNativeDrop()
				}
			}
		},
		[
			cleanupActiveNativeDrop,
			invalidateMissingRootFolder,
			locale,
			overlayUndoHistoryLimit,
			recordOverlayFailure,
			refreshOverlayUndoHistory,
			updateOverlayBatchNotice,
		],
	)

	const confirmPendingOverlay = useCallback(
		async (candidate: OverlayDestinationCandidate) => {
			const currentPendingOverlay = pendingOverlay
			const configuredRootFolder = rootFolderRef.current

			if (
				currentPendingOverlay === null ||
				configuredRootFolder === null ||
				isOperationRunningRef.current
			)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await applyProjectOverlay(
					configuredRootFolder,
					currentPendingOverlay.paths,
					candidate,
					hasAppliedCurrentOverlayBatchRef.current,
					overlayUndoHistoryLimit,
				)
				hasAppliedCurrentOverlayBatchRef.current = true
				overlayBatchStatsRef.current.createdFiles += result.addedFiles
				overlayBatchStatsRef.current.editedFiles += result.replacedFiles
				overlayBatchStatsRef.current.deletedFiles += result.deletedFiles
			} catch (error) {
				recordOverlayFailure(
					translate(
						locale,
						"workspace.applyItemFailed",
						{
							source: currentPendingOverlay.sourceLabel,
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
					currentPendingOverlay.fileCount +
					currentPendingOverlay.deleteCount,
				)
			} finally {
				isOperationRunningRef.current = false
				setIsApplying(false)
				advancePendingOverlay()
			}
		},
		[
			advancePendingOverlay,
			locale,
			overlayUndoHistoryLimit,
			pendingOverlay,
			recordOverlayFailure,
		],
	)

	const cancelPendingOverlay = useCallback(
		() => {
			const currentPendingOverlay = pendingOverlay

			if (currentPendingOverlay === null)
				return

			recordOverlaySkip(currentPendingOverlay.fileCount +
				currentPendingOverlay.deleteCount)
			advancePendingOverlay()
		},
		[
			advancePendingOverlay,
			pendingOverlay,
			recordOverlaySkip,
		],
	)

	const undoOverlay = useCallback(
		async (steps: number) => {
			if (
				isOperationRunningRef.current ||
				steps < 1 ||
				steps > overlayUndoHistory.length
			)
				return

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await undoProjectOverlay(
					configuredRootFolder,
					steps,
				)

				await refreshOverlayUndoHistory()
				setPendingOverlay(null)
				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.undoDone",
						{
							batches: result.undoneBatches,
							restored: result.restoredFiles,
							removed: result.removedFiles,
						},
					),
				})
			} catch (error) {
				await refreshOverlayUndoHistory().catch(() => undefined)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			} finally {
				isOperationRunningRef.current = false
				setIsApplying(false)
			}
		},
		[
			locale,
			overlayUndoHistory.length,
			refreshOverlayUndoHistory,
		],
	)

	const copyGeneratedContent = useCallback(
		async () => {
			if (generatedContent.length === 0)
				return

			try {
				await writeText(generatedContent)

				if (
					autoClearAfterExport &&
					await archiveContextSnapshot(
						generatedContent,
						filesRef.current.length,
					)
				)
					replaceFiles([])

				if (!autoClearAfterExport || filesRef.current.length === 0)
					setNotice(null)
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			archiveContextSnapshot,
			autoClearAfterExport,
			generatedContent,
			locale,
			replaceFiles,
		],
	)

	const downloadGeneratedContent = useCallback(
		async () => {
			if (generatedContent.length === 0)
				return

			try {
				const exportPath = await save({
					defaultPath: "orqeto-dev-context.txt",
					title: translate(
						locale,
						"dialog.saveContext",
					),
					filters: [
						{
							name: translate(
								locale,
								"dialog.textFile",
							),
							extensions: [
								"txt",
							],
						},
					],
				})

				if (exportPath === null)
					return

				await writeExportFile(
					exportPath,
					generatedContent,
				)

				if (
					autoClearAfterExport &&
					await archiveContextSnapshot(
						generatedContent,
						filesRef.current.length,
					)
				)
					replaceFiles([])

				if (!autoClearAfterExport || filesRef.current.length === 0)
					setNotice(null)
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
			}
		},
		[
			archiveContextSnapshot,
			autoClearAfterExport,
			generatedContent,
			locale,
			replaceFiles,
		],
	)

	const copyContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			try {
				await writeText(entry.content)
				setNotice(null)
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistoryCopyFailed",
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
		[locale],
	)

	const downloadContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			try {
				const exportPath = await save({
					defaultPath: "orqeto-dev-context-history.txt",
					title: translate(
						locale,
						"dialog.saveContext",
					),
					filters: [
						{
							name: translate(
								locale,
								"dialog.textFile",
							),
							extensions: [
								"txt",
							],
						},
					],
				})

				if (exportPath === null)
					return

				await writeExportFile(
					exportPath,
					entry.content,
				)
				setNotice(null)
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistoryDownloadFailed",
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
		[locale],
	)

	const deleteContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				setContextHistory(await deleteContextHistoryEntry(
					configuredRootFolder,
					entry.id,
					contextHistoryLimit,
				))
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.contextHistoryDeleteFailed",
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
			contextHistoryLimit,
			locale,
		],
	)

	const prepareForTabClose = useCallback(
		async (): Promise<boolean> => {
			if (
				isOperationRunningRef.current ||
				pendingOverlay !== null
			) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.tabBusy",
					),
				})
				return false
			}

			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder !== null) {
				if (closeExplorerOnFolderClose) {
					await closeFolderInExplorer(configuredRootFolder)
						.catch(() => undefined)
				}

				await discardProjectOverlayUndo(configuredRootFolder)
					.catch(() => undefined)
			}

			await cleanupActiveNativeDrop()
			return true
		},
		[
			cleanupActiveNativeDrop,
			closeExplorerOnFolderClose,
			locale,
			pendingOverlay,
		],
	)

	useEffect(
		() => {
			let cancelled = false

			async function initialize(): Promise<void> {
				try {
					const configuredRootFolder = rootFolderRef.current

					if (
						configuredRootFolder !== null &&
						!await folderExists(configuredRootFolder)
					) {
						await onRootFolderChange(null)
						updateRootFolderState(null)
						setNotice({
							kind: "warning",
							message: translate(
								locale,
								"workspace.savedRootMissing",
							),
						})
					}

					if (cancelled)
						return

					await loadFilterHistory(rootFolderRef.current)
					await loadContextHistory(rootFolderRef.current)
					await refreshOverlayUndoHistory()
				} catch (error) {
					if (!cancelled) {
						setNotice({
							kind: "error",
							message: getErrorMessage(
								error,
								locale,
							),
						})
					}
				} finally {
					if (!cancelled)
						setIsReady(true)
				}
			}

			void initialize()

			return () => {
				cancelled = true
			}
		},
		[
			loadContextHistory,
			loadFilterHistory,
			locale,
			onRootFolderChange,
			refreshOverlayUndoHistory,
			updateRootFolderState,
		],
	)

	return {
		rootFolder,
		locale,
		contextPathFilter,
		contextFilterTarget,
		contextFilterMode,
		contextPathFilterError,
		contextFilterHistory,
		contextHistory,
		pathsOnly,
		autoCopyContextAfterAdd,
		autoClearAfterExport,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
		files,
		notice,
		isReady,
		isProcessing,
		isApplying,
		pendingOverlay,
		overlayUndoHistory,
		generatedContent,
		generatedContentSize,
		selectRootFolder,
		configureRootFolder,
		prepareForTabClose,
		openConfiguredFolder,
		closeRootFolder,
		updateContextPathFilter,
		updateContextFilterTarget,
		updateContextFilterMode,
		clearContextFilter,
		updatePathsOnly,
		selectContextFilterHistory,
		deleteContextFilterHistory,
		clearGeneratedContent,
		copyGeneratedContent,
		downloadGeneratedContent,
		copyContextHistory,
		downloadContextHistory,
		deleteContextHistory,
		addDroppedPaths,
		removeDroppedPaths,
		applyDroppedPaths,
		confirmPendingOverlay,
		cancelPendingOverlay,
		undoOverlay,
	}
}
