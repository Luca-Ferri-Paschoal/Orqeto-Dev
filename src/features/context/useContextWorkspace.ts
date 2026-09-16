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
	mergeContextSelection,
	normalizeContextSelection,
} from "./contextSelection"
import {
	formatGeneratedContent,
	getGeneratedContentByteCount,
	getGeneratedContentSize,
} from "./formatGeneratedContent"
import { formatGitCommitContext } from "./formatGitCommitContext"
import {
	createProjectDiagnosticNotice,
	formatProjectDiagnosticContext,
} from "./formatProjectDiagnosticContext"
import {
	createClientOperationId,
	createOperationOutcome,
	deriveOperationOutcomeStatus,
	filesApplyOutcomeFromResult,
	gitApplyOutcomeFromResult,
	isContextualUndoEligible,
	type OperationUndoReference,
	undoOutcomeFromResult,
} from "./operationOutcome"
import { createOperationOutcomeNotice } from "./operationOutcomeNotice"
import type {
	AppNotice,
	AppSettings,
	ContextHistoryEntry,
	ContextSelectionFile,
	FullProjectContextSummary,
	GitCommitContextData,
	GitPatchPreview,
	OverlayDestinationCandidate,
	OverlayUndoHistoryEntry,
	PendingGitPatch,
	PendingProjectOverlay,
	PrepareProjectOverlayResult,
	ProcessDropResult,
	ProjectDiagnosticCapabilities,
	ProjectDiagnosticContextData,
	ProjectDiagnosticKind,
	WorkMode,
} from "./types"
import {
	getErrorMessage,
	isGitPatchPath,
} from "@/features/context/utils"
import {
	deleteContextFilterHistoryEntry,
	deleteContextHistoryEntry,
	getContextFilterHistory,
	getContextHistory,
	getContextHistoryContent,
	saveContextFilterHistoryEntry,
	saveContextHistoryEntry,
} from "@/infra/configDatabase"
import {
	applyGitPatch,
	applyProjectOverlay,
	approveProjectDiagnostics,
	cleanupNativeDrop,
	closeFolderInExplorer,
	discardProjectOverlayUndo,
	findProjectForRoot,
	folderExists,
	generateGitCommitContext,
	generateProjectDiagnosticContext,
	getProjectDiagnosticCapabilities,
	getProjectOverlayUndoHistory,
	isGitRepository as checkGitRepository,
	materializeContextFiles,
	openFolderInExplorer,
	openFolderInVscode,
	prepareGitPatch,
	prepareProjectOverlay,
	processDrop,
	resolveContextRemovalPaths,
	saveContextHistoryExportFile,
	saveExportFile,
	saveFullProjectContextExportFile,
	undoProjectOverlay,
} from "@/infra/desktop"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { dirname } from "@tauri-apps/api/path"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import {
	confirm,
	open,
} from "@tauri-apps/plugin-dialog"
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"

interface OverlayQueueItem {
	paths: string[]
	sourceLabel: string
	sourceFingerprint: string
	routingFingerprint: string
	fileCount: number
	deleteCount: number
	candidates: OverlayDestinationCandidate[]
}

interface OverlayBatchStats {
	operationId: string
	createdFiles: number
	editedFiles: number
	deletedFiles: number
	unchangedFiles: number
	createdDirectories: number
	editedDirectories: number
	deletedDirectories: number
	unchangedDirectories: number
	rejectedFiles: number
	skippedFiles: number
	firstFailure: string | null
}

interface ContextSelectionActionStats {
	addedFiles: number
	addedDirectories: number
	unchangedFiles: number
	unchangedDirectories: number
	skippedFiles: number
	skippedDirectories: number
}

interface ContextRemovalActionStats {
	removedFiles: number
	removedDirectories: number
	notPresentFiles: number
	notPresentDirectories: number
	filteredFiles: number
	filteredDirectories: number
}

interface MaterializedContextResult {
	content: string
	fileCount: number
	directoryCount: number
	skippedFiles: number
	skippedDirectories: number
}

interface PreparedGitCommitContext {
	rootFolder: string
	locale: Locale
	workMode: WorkMode
	repositoryName: string
	content: string
	byteCount: number
}

interface PreparedDiagnosticContext {
	rootFolder: string
	locale: Locale
	workMode: WorkMode
	diagnosticFileLimit: number
	kind: ProjectDiagnosticKind
	content: string
	byteCount: number
}

type CancellableContextOperationKind = | "create" |
	"custom" |
	"commit" |
	"project" |
	"typecheck" |
	"eslint"

interface CancellableContextOperationToken {
	id: number
	kind: CancellableContextOperationKind
	cancelled: boolean
	cancellable: boolean
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

function getSafeProjectName(path: string): string {
	return getPathLabel(path)
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\.+$/, "") ||
		"project"
}

function formatApplyStatusDetail(
	locale: Locale,
	labelKey: Parameters<typeof translate>[1],
	files: number,
	directories: number,
): string {
	return `${translate(
		locale,
		labelKey,
	)}: ${translateCount(
		locale,
		files,
		"status.files.one",
		"status.files.other",
	)} · ${translateCount(
		locale,
		directories,
		"status.affectedDirectories.one",
		"status.affectedDirectories.other",
	)}`
}

function isPathInsideDirectory(
	filePath: string,
	directoryPath: string,
): boolean {
	if (directoryPath === "./")
		return filePath.startsWith("./")

	return filePath.startsWith(`${directoryPath}/`)
}

function selectionContainsPath(
	selection: ReadonlySet<string>,
	path: string,
	isDirectory: boolean,
): boolean {
	if (!isDirectory)
		return selection.has(path)

	for (const filePath of selection) {
		if (isPathInsideDirectory(
			filePath,
			path,
		))
			return true
	}

	return false
}

function countAffectedDirectories(
	filePaths: Iterable<string>,
	directoryScopes: readonly string[],
): number {
	const directories = new Set<string>()

	for (const filePath of filePaths) {
		const normalized = filePath.startsWith("./") ?
			filePath.slice(2) :
			filePath
		const segments = normalized.split("/")

		segments.pop()
		for (let index = 1; index <= segments.length; index += 1) {
			const directory = `./${segments.slice(
				0,
				index,
			).join("/")}`
			if (directoryScopes.some(scope =>
				scope === "./" ||
				directory === scope ||
				isPathInsideDirectory(
					directory,
					scope,
				)))
				directories.add(directory)
		}
	}

	return directories.size
}

function countInputDirectoriesByContribution(
	resolvedPaths: readonly { relativePath: string; isDirectory: boolean }[],
	eligiblePaths: ReadonlySet<string>,
	existingPaths: ReadonlySet<string>,
): {
	added: number
	unchanged: number
	skipped: number
} {
	let added = 0
	let unchanged = 0
	let skipped = 0

	for (const path of resolvedPaths) {
		if (!path.isDirectory)
			continue

		let hasEligible = false
		let hasNew = false

		for (const filePath of eligiblePaths) {
			if (!isPathInsideDirectory(
				filePath,
				path.relativePath,
			))
				continue

			hasEligible = true
			if (!existingPaths.has(filePath))
				hasNew = true
		}

		if (!hasEligible)
			skipped += 1
		else if (hasNew)
			added += 1
		else
			unchanged += 1
	}

	return {
		added,
		unchanged,
		skipped,
	}
}

export type ContextWorkspacePreferences = Omit<
	AppSettings,
	| "folderAction" |
	"folderSectionExpanded" |
	"contextSectionExpanded" |
	"applySectionExpanded" |
	"settingsGeneralExpanded" |
	"settingsContextExpanded" |
	"settingsHistoryExpanded" |
	"settingsVscodeExpanded" |
	"settingsExplorerExpanded"
>

export type PreparedApplyOutcome = | {
	status: "success"
	undoReference: OperationUndoReference
} | {
	status: "no_op" | "cancelled" | "failed" | "blocked"
	undoReference: null
}

export interface UseContextWorkspaceOptions {
	active: boolean
	initialRootFolder: string | null
	folderPickerReferenceRoot: string | null
	preferences: ContextWorkspacePreferences
	onRootFolderChange: (rootFolder: string | null) => Promise<boolean>
}

export function useContextWorkspace({
	active,
	initialRootFolder,
	folderPickerReferenceRoot,
	preferences,
	onRootFolderChange,
}: UseContextWorkspaceOptions) {
	const [rootFolder, setRootFolder] = useState<string | null>(initialRootFolder)
	const {
		locale,
		workMode,
		autoCopyContextAfterAdd,
		autoClearAfterExport,
		contextFilterHistoryLimit,
		contextHistoryLimit,
		overlayUndoHistoryLimit,
		diagnosticFileLimit,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
	} = preferences
	const [contextPathFilter, setContextPathFilter] = useState("")
	const [contextFilterTarget, setContextFilterTarget] = useState<ContextFilterTarget>("fileName")
	const [contextFilterMode, setContextFilterMode] = useState<ContextFilterMode>("contains")
	const [contextFilterHistory, setContextFilterHistory] = useState<ContextFilterHistoryEntry[]>([])
	const [contextHistory, setContextHistory] = useState<ContextHistoryEntry[]>([])
	const [pathsOnly, setPathsOnly] = useState(false)
	const [files, setFiles] = useState<ContextSelectionFile[]>([])
	const [notice, setNotice] = useState<AppNotice | null>(null)
	const [isReady, setIsReady] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [isApplying, setIsApplying] = useState(false)
	const [operationRevision, setOperationRevision] = useState(0)
	const [gitRepositoryState, setGitRepositoryState] = useState<{
		rootFolder: string | null
		value: boolean
	}>({
		rootFolder: null,
		value: false,
	})
	const isGitRepository = gitRepositoryState.rootFolder === rootFolder && gitRepositoryState.value
	const [isGeneratingCommitContext, setIsGeneratingCommitContext] = useState(false)
	const [isGeneratingProjectContext, setIsGeneratingProjectContext] = useState(false)
	const [isInspectingProjectContext, setIsInspectingProjectContext] = useState(false)
	const [fullProjectContextSummaryState, setFullProjectContextSummaryState] = useState<{
		rootFolder: string | null
		value: FullProjectContextSummary | null
	}>({
		rootFolder: null,
		value: null,
	})
	const fullProjectContextSummary = fullProjectContextSummaryState.rootFolder === rootFolder ?
		fullProjectContextSummaryState.value :
		null
	const [diagnosticContextKind, setDiagnosticContextKind] = useState<ProjectDiagnosticKind | null>(null)
	const [preparedGitCommitContext, setPreparedGitCommitContext] = useState<PreparedGitCommitContext | null>(null)
	const [preparedDiagnosticContexts, setPreparedDiagnosticContexts] = useState<Record<ProjectDiagnosticKind, PreparedDiagnosticContext | null>>({
		typecheck: null,
		eslint: null,
	})
	const [cancellableContextOperationKind, setCancellableContextOperationKind] = useState<CancellableContextOperationKind | null>(null)
	const [cancelledContextOperationKind, setCancelledContextOperationKind] = useState<CancellableContextOperationKind | null>(null)
	const [isCancellableContextOperationCancelled, setIsCancellableContextOperationCancelled] = useState(false)
	const [diagnosticCapabilitiesState, setDiagnosticCapabilitiesState] = useState<{
		rootFolder: string | null
		value: ProjectDiagnosticCapabilities
	}>({
		rootFolder: null,
		value: {
			typecheck: false,
			eslint: false,
		},
	})
	const diagnosticCapabilities = diagnosticCapabilitiesState.rootFolder === rootFolder ?
		diagnosticCapabilitiesState.value :
		{
			typecheck: false,
			eslint: false,
		}
	const currentPreparedGitCommitContext = preparedGitCommitContext?.rootFolder === rootFolder &&
		preparedGitCommitContext.locale === locale &&
		preparedGitCommitContext.workMode === workMode ?
		preparedGitCommitContext :
		null
	const getCurrentPreparedDiagnosticContext = (prepared: PreparedDiagnosticContext | null): PreparedDiagnosticContext | null =>
		prepared?.rootFolder === rootFolder &&
			prepared.locale === locale &&
			prepared.workMode === workMode &&
			prepared.diagnosticFileLimit === diagnosticFileLimit ?
			prepared :
			null
	const currentPreparedDiagnosticContexts = {
		typecheck: getCurrentPreparedDiagnosticContext(preparedDiagnosticContexts.typecheck),
		eslint: getCurrentPreparedDiagnosticContext(preparedDiagnosticContexts.eslint),
	} satisfies Record<ProjectDiagnosticKind, PreparedDiagnosticContext | null>
	const [pendingOverlay, setPendingOverlay] = useState<PendingProjectOverlay | null>(null)
	const [pendingGitPatch, setPendingGitPatch] = useState<PendingGitPatch | null>(null)
	const [overlayUndoHistory, setOverlayUndoHistory] = useState<OverlayUndoHistoryEntry[]>([])
	const filesRef = useRef<ContextSelectionFile[]>([])
	const contextSelectionRevisionRef = useRef(0)
	const rootFolderRef = useRef<string | null>(initialRootFolder)
	const rootRevisionRef = useRef(0)
	const isOperationRunningRef = useRef(false)
	const isGeneratingCommitContextRef = useRef(false)
	const isInspectingProjectContextRef = useRef(false)
	const fullProjectSummaryRequestVersionRef = useRef(0)
	const cancellableContextOperationSequenceRef = useRef(0)
	const cancellableContextOperationRef = useRef<CancellableContextOperationToken | null>(null)
	const contextFilterRef = useRef<ContextFilter>({
		pattern: "",
		target: "fileName",
		mode: "contains",
	})
	const contextPathFilterErrorRef = useRef<string | null>(null)
	const trustedDiagnosticRootsRef = useRef(new Set<string>())
	const handledWorkModeRef = useRef(workMode)
	const deferredWorkModeCleanupRef = useRef(false)
	const pendingOverlayQueueRef = useRef<OverlayQueueItem[]>([])
	const pendingOverlayQueueIndexRef = useRef(0)
	const hasAppliedCurrentOverlayBatchRef = useRef(false)
	const activeNativeDropRootRef = useRef<string | null>(null)
	const routedOverlayResolutionRef = useRef<{
		appendUndo: boolean
		resolve: (outcome: PreparedApplyOutcome) => void
	} | null>(null)
	const routedGitPatchResolutionRef = useRef<{
		resolve: (outcome: PreparedApplyOutcome) => void
	} | null>(null)
	const overlayBatchStatsRef = useRef<OverlayBatchStats>({
		operationId: createClientOperationId("files_apply"),
		createdFiles: 0,
		editedFiles: 0,
		deletedFiles: 0,
		unchangedFiles: 0,
		createdDirectories: 0,
		editedDirectories: 0,
		deletedDirectories: 0,
		unchangedDirectories: 0,
		rejectedFiles: 0,
		skippedFiles: 0,
		firstFailure: null,
	})

	const pathSelectionContent = useMemo(
		() => formatGeneratedContent(
			files.map(file => ({
				relativePath: file.relativePath,
				content: null,
			})),
			locale,
			workMode,
		),
		[
			files,
			locale,
			workMode,
		],
	)
	const generatedContentSize = useMemo(
		() => pathsOnly ?
			getGeneratedContentSize(pathSelectionContent) :
			null,
		[
			pathSelectionContent,
			pathsOnly,
		],
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
	useEffect(
		() => {
			contextFilterRef.current = {
				pattern: contextPathFilter,
				target: contextFilterTarget,
				mode: contextFilterMode,
			}
			contextPathFilterErrorRef.current = contextPathFilterError
		},
		[
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
		],
	)

	const beginCancellableContextOperation = useCallback(
		(
			kind: CancellableContextOperationKind,
			cancellable = true,
		): CancellableContextOperationToken | null => {
			if (cancellableContextOperationRef.current !== null)
				return null

			const token: CancellableContextOperationToken = {
				id: cancellableContextOperationSequenceRef.current + 1,
				kind,
				cancelled: false,
				cancellable,
			}
			cancellableContextOperationSequenceRef.current = token.id
			cancellableContextOperationRef.current = token
			setCancelledContextOperationKind(null)
			setIsCancellableContextOperationCancelled(false)
			setCancellableContextOperationKind(cancellable ?
				kind :
				null)
			return token
		},
		[],
	)

	const isCancellableContextOperationActive = useCallback(
		(token: CancellableContextOperationToken): boolean =>
			cancellableContextOperationRef.current === token && !token.cancelled,
		[],
	)

	const commitCancellableContextOperation = useCallback(
		(token: CancellableContextOperationToken): boolean => {
			if (!isCancellableContextOperationActive(token))
				return false

			token.cancellable = false
			setCancellableContextOperationKind(null)
			return true
		},
		[isCancellableContextOperationActive],
	)

	const finishCancellableContextOperation = useCallback(
		(token: CancellableContextOperationToken): boolean => {
			if (cancellableContextOperationRef.current !== token)
				return false

			cancellableContextOperationRef.current = null
			setCancellableContextOperationKind(null)
			setCancelledContextOperationKind(null)
			setIsCancellableContextOperationCancelled(false)
			return true
		},
		[],
	)

	const cancelCancellableContextOperation = useCallback(
		(): void => {
			const token = cancellableContextOperationRef.current

			if (token === null || token.cancelled || !token.cancellable)
				return

			token.cancellable = false
			token.cancelled = true
			cancellableContextOperationRef.current = null
			setCancellableContextOperationKind(null)
			setCancelledContextOperationKind(token.kind)
			setIsCancellableContextOperationCancelled(true)

			if (token.kind === "create" || token.kind === "custom") {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsProcessing(false)
			}

			if (token.kind === "commit") {
				isGeneratingCommitContextRef.current = false
				setIsGeneratingCommitContext(false)
			}

			if (token.kind === "project") {
				isGeneratingCommitContextRef.current = false
				isInspectingProjectContextRef.current = false
				setIsGeneratingProjectContext(false)
				setIsInspectingProjectContext(false)
			}

			if (token.kind === "typecheck" || token.kind === "eslint") {
				isGeneratingCommitContextRef.current = false
				setDiagnosticContextKind(current => current === token.kind ?
					null :
					current)
			}
		},
		[],
	)

	const replaceFiles = useCallback(
		(nextFiles: ContextSelectionFile[]) => {
			const normalizedFiles = normalizeContextSelection(nextFiles)

			contextSelectionRevisionRef.current += 1
			filesRef.current = normalizedFiles
			setFiles(normalizedFiles)
		},
		[],
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
		[],
	)

	const updateRootFolderState = useCallback(
		(value: string | null) => {
			if (rootFolderRef.current !== value)
				rootRevisionRef.current += 1

			rootFolderRef.current = value
			setRootFolder(value)
		},
		[],
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
		[rootFolder],
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
		],
	)

	const loadFilterHistory = useCallback(
		async (path: string | null): Promise<void> => {
			const revision = rootRevisionRef.current

			if (path === null) {
				if (rootFolderRef.current === null)
					setContextFilterHistory([])
				return
			}

			const entries = await getContextFilterHistory(
				path,
				contextFilterHistoryLimit,
			)
			if (rootFolderRef.current === path && rootRevisionRef.current === revision)
				setContextFilterHistory(entries)
		},
		[contextFilterHistoryLimit],
	)

	const loadContextHistory = useCallback(
		async (path: string | null): Promise<void> => {
			const revision = rootRevisionRef.current

			if (path === null) {
				if (rootFolderRef.current === null)
					setContextHistory([])
				return
			}

			const entries = await getContextHistory(
				path,
				contextHistoryLimit,
			)
			if (rootFolderRef.current === path && rootRevisionRef.current === revision)
				setContextHistory(entries)
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

	useEffect(
		() => {
			const workModeChanged = handledWorkModeRef.current !== workMode

			if (!workModeChanged && !deferredWorkModeCleanupRef.current)
				return

			if (isOperationRunningRef.current) {
				deferredWorkModeCleanupRef.current = true
				return
			}

			handledWorkModeRef.current = workMode
			deferredWorkModeCleanupRef.current = false
			routedOverlayResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedOverlayResolutionRef.current = null
			routedGitPatchResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedGitPatchResolutionRef.current = null
			pendingOverlayQueueRef.current = []
			pendingOverlayQueueIndexRef.current = 0
			hasAppliedCurrentOverlayBatchRef.current = false
			setPendingOverlay(null)
			setPendingGitPatch(null)
			void cleanupActiveNativeDrop()
		},
		[
			cleanupActiveNativeDrop,
			operationRevision,
			workMode,
		],
	)

	const refreshOverlayUndoHistory = useCallback(
		async (): Promise<OverlayUndoHistoryEntry[]> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null) {
				setOverlayUndoHistory([])
				return []
			}

			const revision = rootRevisionRef.current
			const entries = await getProjectOverlayUndoHistory(
				configuredRootFolder,
				overlayUndoHistoryLimit,
			)

			if (
				rootFolderRef.current === configuredRootFolder &&
				rootRevisionRef.current === revision
			)
				setOverlayUndoHistory(entries)
			return entries
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
				const revision = rootRevisionRef.current
				const entries = await saveContextHistoryEntry(
					configuredRootFolder,
					{
						content,
						fileCount,
						byteCount: getGeneratedContentByteCount(content),
						createdAt: Date.now(),
					},
					contextHistoryLimit,
				)
				if (
					rootFolderRef.current === configuredRootFolder &&
					rootRevisionRef.current === revision
				)
					setContextHistory(entries)
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

	const materializeSelectedContext = useCallback(
		async (selection: readonly ContextSelectionFile[] = filesRef.current): Promise<MaterializedContextResult | null> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null || selection.length === 0)
				return null

			const rootRevision = rootRevisionRef.current
			const selectionRevision = contextSelectionRevisionRef.current
			const relativePaths = selection.map(file => file.relativePath)
			const result = await materializeContextFiles(
				configuredRootFolder,
				relativePaths,
				pathsOnly,
			)

			if (
				rootFolderRef.current !== configuredRootFolder ||
				rootRevisionRef.current !== rootRevision ||
				contextSelectionRevisionRef.current !== selectionRevision
			) {
				throw new Error(translate(
					locale,
					"workspace.contextChangedDuringExport",
				))
			}

			return {
				content: formatGeneratedContent(
					result.files,
					locale,
					workMode,
				),
				fileCount: result.files.length,
				directoryCount: countAffectedDirectories(
					result.files.map(file => file.relativePath),
					["./"],
				),
				skippedFiles: result.skippedFiles.length,
				skippedDirectories: countAffectedDirectories(
					result.skippedFiles.map(file => file.relativePath),
					["./"],
				),
			}
		},
		[
			locale,
			pathsOnly,
			workMode,
		],
	)

	const copyContextToClipboard = useCallback(
		async (
			content: string,
			fileCount: number,
			clearAfterCopy: boolean,
		): Promise<boolean> => {
			await writeText(content)

			if (!clearAfterCopy)
				return true

			if (!await archiveContextSnapshot(
				content,
				fileCount,
			))
				return false

			replaceFiles([])
			return true
		},
		[
			archiveContextSnapshot,
			replaceFiles,
		],
	)

	const clearGeneratedContent = useCallback(
		async (): Promise<void> => {
			if (isOperationRunningRef.current || filesRef.current.length === 0)
				return

			isOperationRunningRef.current = true
			setIsProcessing(true)
			const selectedCount = filesRef.current.length

			try {
				const materialized = await materializeSelectedContext()

				if (materialized !== null && materialized.skippedFiles > 0) {
					const outcome = createOperationOutcome({
						operationType: "context_remove",
						projectRoot: rootFolderRef.current,
						status: "blocked",
						counters: [{
							kind: "unavailable",
							files: materialized.skippedFiles,
							directories: materialized.skippedDirectories,
						}],
					})

					setNotice(createOperationOutcomeNotice(
						locale,
						outcome,
						"workspace.contextClearBlockedUnavailable",
					))
					return
				}

				if (
					materialized !== null &&
					materialized.content.length > 0 &&
					!await archiveContextSnapshot(
						materialized.content,
						materialized.fileCount,
					)
				)
					return

				replaceFiles([])
				const outcome = createOperationOutcome({
					operationType: "context_remove",
					projectRoot: rootFolderRef.current,
					status: "success",
					counters: [{
						kind: "removed",
						files: selectedCount,
						directories: 0,
					}],
				})

				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.contextCleared",
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
				setOperationRevision(revision => revision + 1)
				setIsProcessing(false)
			}
		},
		[
			archiveContextSnapshot,
			locale,
			materializeSelectedContext,
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
			routedOverlayResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedOverlayResolutionRef.current = null
			routedGitPatchResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			routedGitPatchResolutionRef.current = null
			updateRootFolderState(null)
			setContextFilterHistory([])
			setContextHistory([])
			replaceFiles([])
			pendingOverlayQueueRef.current = []
			pendingOverlayQueueIndexRef.current = 0
			hasAppliedCurrentOverlayBatchRef.current = false
			setPendingOverlay(null)
			setPendingGitPatch(null)
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
			if (
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
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

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
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
					setPendingGitPatch(null)
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
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsProcessing(false)
			}
		},
		[
			cleanupActiveNativeDrop,
			loadContextHistory,
			loadFilterHistory,
			locale,
			onRootFolderChange,
			openExplorerOnProjectOpen,
			pendingGitPatch,
			pendingOverlay,
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

	const openConfiguredFolderInVscode = useCallback(
		async () => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				if (await invalidateMissingRootFolder())
					return

				await openFolderInVscode(configuredRootFolder)
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

			if (
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				setNotice({
					kind: "info",
					message: translate(
						locale,
						"workspace.tabBusy",
					),
				})
				return
			}

			isOperationRunningRef.current = true
			setIsProcessing(true)

			try {
				if (!await onRootFolderChange(null))
					return

				updateRootFolderState(null)
				setContextFilterHistory([])
				setContextHistory([])
				replaceFiles([])
				pendingOverlayQueueRef.current = []
				pendingOverlayQueueIndexRef.current = 0
				hasAppliedCurrentOverlayBatchRef.current = false
				setPendingOverlay(null)
				setPendingGitPatch(null)
				setOverlayUndoHistory([])

				let cleanupError: unknown = null

				try {
					await cleanupActiveNativeDrop()
				} catch (error) {
					cleanupError = error
				}

				try {
					await discardProjectOverlayUndo(configuredRootFolder)
				} catch (error) {
					cleanupError = error
				}

				if (closeExplorerOnFolderClose) {
					try {
						await closeFolderInExplorer(configuredRootFolder)
					} catch (error) {
						cleanupError ??= error
					}
				}

				if (cleanupError !== null) {
					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.rootClosedCleanupWarning",
							{
								error: getErrorMessage(
									cleanupError,
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
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsProcessing(false)
			}
		},
		[
			cleanupActiveNativeDrop,
			closeExplorerOnFolderClose,
			locale,
			onRootFolderChange,
			pendingGitPatch,
			pendingOverlay,
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
				const revision = rootRevisionRef.current
				const entries = await deleteContextFilterHistoryEntry(
					configuredRootFolder,
					entry,
					contextFilterHistoryLimit,
				)
				if (
					rootFolderRef.current === configuredRootFolder &&
					rootRevisionRef.current === revision
				)
					setContextFilterHistory(entries)
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
		async (
			paths: string[],
			copyAfterAdd = false,
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

				const rootRevision = rootRevisionRef.current
				const selectionRevision = contextSelectionRevisionRef.current
				const existingPaths = new Set(filesRef.current.map(file => file.relativePath))
				const result = await processDrop(
					configuredRootFolder,
					uniquePaths,
				)

				if (!commitCancellableContextOperation(cancellationToken))
					return

				if (
					rootFolderRef.current !== configuredRootFolder ||
					rootRevisionRef.current !== rootRevision ||
					contextSelectionRevisionRef.current !== selectionRevision
				) {
					throw new Error(translate(
						locale,
						"workspace.contextChangedDuringSelection",
					))
				}

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
				const eligiblePathSet = new Set(filteredFiles.map(file => file.relativePath))
				const directoryStats = countInputDirectoriesByContribution(
					result.directories.map(relativePath => ({
						relativePath,
						isDirectory: true,
					})),
					eligiblePathSet,
					existingPaths,
				)
				const mergeResult = appendFiles(filteredFiles)
				const actionStats: ContextSelectionActionStats = {
					addedFiles: mergeResult.addedFiles,
					addedDirectories: directoryStats.added,
					unchangedFiles: mergeResult.unchangedFiles,
					unchangedDirectories: directoryStats.unchanged,
					skippedFiles: filteredSkippedFiles.length +
						(result.files.length - filteredFiles.length),
					skippedDirectories: directoryStats.skipped + result.skippedDirectoryCount,
				}
				let autoCopyError: unknown = null
				let filterHistoryError: unknown = null
				let exportSkippedFiles = 0
				let exportSkippedDirectories = 0

				if (filterEnabled) {
					try {
						const revision = rootRevisionRef.current
						const entries = await saveContextFilterHistoryEntry(
							configuredRootFolder,
							{
								pattern: normalizeContextPathFilter(contextPathFilter),
								target: contextFilterTarget,
								mode: contextFilterMode,
								lastUsedAt: Date.now(),
							},
							contextFilterHistoryLimit,
						)
						if (
							rootFolderRef.current === configuredRootFolder &&
							rootRevisionRef.current === revision
						)
							setContextFilterHistory(entries)
					} catch (error) {
						filterHistoryError = error
					}
				}

				let contextCopiedAfterAdd = false
				if (copyAfterAdd || autoCopyContextAfterAdd) {
					try {
						const materialized = await materializeSelectedContext(mergeResult.files)

						exportSkippedFiles = materialized?.skippedFiles ?? 0
						exportSkippedDirectories = materialized?.skippedDirectories ?? 0
						if (materialized === null || materialized.content.length === 0) {
							throw new Error(translate(
								locale,
								"workspace.contextNothingAvailable",
							))
						}

						if (copyAfterAdd && materialized.skippedFiles > 0) {
							throw new Error(translate(
								locale,
								"workspace.contextCopyIncomplete",
							))
						}

						if (copyAfterAdd) {
							if (!await copyContextToClipboard(
								materialized.content,
								materialized.fileCount,
								autoClearAfterExport,
							)) {
								if (externalAction) {
									throw new Error(translate(
										locale,
										"workspace.contextCopyNotCompleted",
									))
								}

								return
							}
						} else
							await writeText(materialized.content)

						contextCopiedAfterAdd = true
					} catch (error) {
						if (externalAction && copyAfterAdd)
							throw error

						autoCopyError = error
					}
				}

				const warnings: string[] = []
				const extraDetails: string[] = []

				if (copyAfterAdd && contextCopiedAfterAdd) {
					extraDetails.push(translate(
						locale,
						"workspace.contextCopiedAfterAdd",
					))
				}
				if (autoCopyError !== null) {
					warnings.push(translate(
						locale,
						copyAfterAdd ?
							"workspace.contextCopyAfterAddFailed" :
							"workspace.autoCopyFailed",
						{
							error: getErrorMessage(
								autoCopyError,
								locale,
							),
						},
					))
				}
				if (filterHistoryError !== null) {
					warnings.push(translate(
						locale,
						"workspace.filterHistoryFailed",
					))
				}

				const skippedFiles = actionStats.skippedFiles + exportSkippedFiles
				const skippedDirectories = actionStats.skippedDirectories + exportSkippedDirectories
				const outcome = createOperationOutcome({
					operationType: "context_add",
					projectRoot: configuredRootFolder,
					status: deriveOperationOutcomeStatus({
						changed: actionStats.addedFiles,
						unchanged: actionStats.unchangedFiles,
						skipped: skippedFiles + skippedDirectories,
						warnings: warnings.length,
					}),
					counters: [
						{
							kind: "added",
							files: actionStats.addedFiles,
							directories: actionStats.addedDirectories,
						},
						{
							kind: "already_present",
							files: actionStats.unchangedFiles,
							directories: actionStats.unchangedDirectories,
						},
						{
							kind: "skipped",
							files: actionStats.skippedFiles,
							directories: actionStats.skippedDirectories,
						},
						{
							kind: "unavailable",
							files: exportSkippedFiles,
							directories: exportSkippedDirectories,
						},
					],
					warnings,
				})

				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.contextSelectionUpdated",
					{},
					extraDetails,
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
			appendFiles,
			autoClearAfterExport,
			autoCopyContextAfterAdd,
			copyContextToClipboard,
			contextFilterHistoryLimit,
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			invalidateMissingRootFolder,
			locale,
			materializeSelectedContext,
		],
	)

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
				const currentPathSet = new Set(currentFiles.map(file => file.relativePath))
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
				const filteredRemovalPaths = new Set(filteredRemovalFiles.map(file =>
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
		],
	)

	const updateOverlayBatchNotice = useCallback(
		(pendingFiles: number) => {
			const stats = overlayBatchStatsRef.current
			const changedFiles = stats.createdFiles +
				stats.editedFiles +
				stats.deletedFiles
			const failureDetail = stats.firstFailure === null ?
				null :
				translate(
					locale,
					"workspace.applyBatchFailureDetail",
					{
						error: stats.firstFailure,
					},
				)

			if (pendingFiles > 0) {
				const details = [
					formatApplyStatusDetail(
						locale,
						"status.apply.created",
						stats.createdFiles,
						stats.createdDirectories,
					),
					formatApplyStatusDetail(
						locale,
						"status.apply.edited",
						stats.editedFiles,
						stats.editedDirectories,
					),
					formatApplyStatusDetail(
						locale,
						"status.apply.deleted",
						stats.deletedFiles,
						stats.deletedDirectories,
					),
					formatApplyStatusDetail(
						locale,
						"status.apply.unchanged",
						stats.unchangedFiles,
						stats.unchangedDirectories,
					),
					translate(
						locale,
						"status.apply.pending",
						{ count: pendingFiles },
					),
				]

				if (stats.rejectedFiles > 0) {
					details.push(translate(
						locale,
						"status.apply.rejected",
						{ count: stats.rejectedFiles },
					))
				}
				if (stats.skippedFiles > 0) {
					details.push(translate(
						locale,
						"status.apply.skipped",
						{ count: stats.skippedFiles },
					))
				}
				if (failureDetail !== null)
					details.push(failureDetail)

				setNotice({
					kind: stats.rejectedFiles > 0 || stats.skippedFiles > 0 ?
						"warning" :
						"info",
					message: translate(
						locale,
						"workspace.applyBatchPendingSummary",
					),
					details,
				})
				return
			}

			const failures = failureDetail === null ?
				[] :
				[failureDetail]
			const outcome = filesApplyOutcomeFromResult(
				rootFolderRef.current,
				{
					operationId: stats.operationId,
					appliedAtUnixMs: null,
					addedFiles: stats.createdFiles,
					replacedFiles: stats.editedFiles,
					deletedFiles: stats.deletedFiles,
					unchangedFiles: stats.unchangedFiles,
					addedDirectories: stats.createdDirectories,
					replacedDirectories: stats.editedDirectories,
					deletedDirectories: stats.deletedDirectories,
					unchangedDirectories: stats.unchangedDirectories,
				},
				{
					rejectedFiles: stats.rejectedFiles,
					skippedFiles: stats.skippedFiles,
					failures,
				},
			)

			setNotice(createOperationOutcomeNotice(
				locale,
				outcome,
				changedFiles === 0 && stats.unchangedFiles > 0 && failures.length === 0 ?
					"workspace.applyAlreadyApplied" :
					"workspace.applyBatchDoneSummary",
			))
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

			if (workMode === "git") {
				if (!isGitRepository) {
					if (nativeDropRoot !== null)
						await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.gitModeRequiresRepository",
						),
					})
					return
				}

				if (uniquePaths.length !== 1) {
					if (nativeDropRoot !== null)
						await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.gitModeSinglePatch",
						),
					})
					return
				}

				const patchPath = uniquePaths[0]

				if (patchPath === undefined || !isGitPatchPath(patchPath)) {
					if (nativeDropRoot !== null)
						await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

					setNotice({
						kind: "warning",
						message: translate(
							locale,
							"workspace.gitModePatchOnly",
						),
					})
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
				setPendingGitPatch(null)
				let previewReady = false

				try {
					if (await invalidateMissingRootFolder())
						return

					const preview = await prepareGitPatch(
						configuredRootFolder,
						patchPath,
					)

					setPendingGitPatch({
						patchPath,
						...preview,
					})
					setNotice(null)
					previewReady = true
				} catch (error) {
					setNotice({
						kind: "error",
						message: translate(
							locale,
							"workspace.gitPatchValidationFailed",
							{
								error: getErrorMessage(
									error,
									locale,
								),
							},
						),
					})
				} finally {
					isOperationRunningRef.current = false
					setOperationRevision(revision => revision + 1)
					setIsApplying(false)

					if (!previewReady)
						void cleanupActiveNativeDrop()
				}

				return
			}

			if (uniquePaths.some(isGitPatchPath)) {
				if (nativeDropRoot !== null)
					await cleanupNativeDrop(nativeDropRoot).catch(() => undefined)

				setNotice({
					kind: "warning",
					message: translate(
						locale,
						"workspace.filesModePatchRejected",
					),
				})
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
			setPendingGitPatch(null)
			overlayBatchStatsRef.current = {
				operationId: createClientOperationId("files_apply"),
				createdFiles: 0,
				editedFiles: 0,
				deletedFiles: 0,
				unchangedFiles: 0,
				createdDirectories: 0,
				editedDirectories: 0,
				deletedDirectories: 0,
				unchangedDirectories: 0,
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
								plan.sourceFingerprint,
								plan.routingFingerprint,
								hasAppliedCurrentOverlayBatchRef.current,
								overlayUndoHistoryLimit,
							)
							const changed = result.addedFiles + result.replacedFiles + result.deletedFiles > 0

							if (changed)
								hasAppliedCurrentOverlayBatchRef.current = true

							overlayBatchStatsRef.current.createdFiles += result.addedFiles
							overlayBatchStatsRef.current.editedFiles += result.replacedFiles
							overlayBatchStatsRef.current.deletedFiles += result.deletedFiles
							overlayBatchStatsRef.current.unchangedFiles += result.unchangedFiles
							overlayBatchStatsRef.current.createdDirectories += result.addedDirectories
							overlayBatchStatsRef.current.editedDirectories += result.replacedDirectories
							overlayBatchStatsRef.current.deletedDirectories += result.deletedDirectories
							overlayBatchStatsRef.current.unchangedDirectories += result.unchangedDirectories
							continue
						}

						pendingItems.push({
							paths: itemPaths,
							sourceLabel,
							sourceFingerprint: plan.sourceFingerprint,
							routingFingerprint: plan.routingFingerprint,
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
				setOperationRevision(revision => revision + 1)
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
			isGitRepository,
			locale,
			overlayUndoHistoryLimit,
			recordOverlayFailure,
			refreshOverlayUndoHistory,
			updateOverlayBatchNotice,
			workMode,
		],
	)

	const applyPreparedOverlay = useCallback(
		async (
			paths: string[],
			candidate: OverlayDestinationCandidate,
			sourceFingerprint: string,
			routingFingerprint: string,
			appendUndo: boolean,
		): Promise<PreparedApplyOutcome> => {
			const configuredRootFolder = rootFolderRef.current

			if (
				configuredRootFolder === null ||
				isOperationRunningRef.current
			) {
				return {
					status: "failed",
					undoReference: null,
				}
			}

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await applyProjectOverlay(
					configuredRootFolder,
					paths,
					candidate,
					sourceFingerprint,
					routingFingerprint,
					appendUndo,
					overlayUndoHistoryLimit,
				)
				const outcome = filesApplyOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				await refreshOverlayUndoHistory()
				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					outcome.status === "no_op" ?
						"workspace.applyAlreadyApplied" :
						"workspace.overlayAppliedSummary",
					outcome.status === "no_op" ?
						{} :
						{ destination: candidate.destinationRelativePath },
				))

				if (outcome.undoReference === null) {
					return {
						status: "no_op",
						undoReference: null,
					}
				}

				return {
					status: "success",
					undoReference: outcome.undoReference,
				}
			} catch (error) {
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
				return {
					status: "failed",
					undoReference: null,
				}
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)
			}
		},
		[
			locale,
			overlayUndoHistoryLimit,
			refreshOverlayUndoHistory,
		],
	)

	const beginPreparedOverlayResolution = useCallback(
		(
			paths: string[],
			sourceLabel: string,
			plan: PrepareProjectOverlayResult,
			appendUndo: boolean,
		): Promise<PreparedApplyOutcome> => {
			if (
				plan.candidates.length === 0 ||
				plan.ambiguityLimitExceeded ||
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				return Promise.resolve({
					status: "failed",
					undoReference: null,
				})
			}

			routedOverlayResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})

			setPendingOverlay({
				paths,
				sourceLabel,
				sourceFingerprint: plan.sourceFingerprint,
				routingFingerprint: plan.routingFingerprint,
				fileCount: plan.fileCount,
				deleteCount: plan.deleteCount,
				candidates: plan.candidates,
				queuePosition: 1,
				queueTotal: 1,
			})
			setNotice({
				kind: "info",
				message: translate(
					locale,
					"workspace.chooseDestination",
				),
			})

			return new Promise(resolve => {
				routedOverlayResolutionRef.current = {
					appendUndo,
					resolve,
				}
			})
		},
		[
			locale,
			pendingGitPatch,
			pendingOverlay,
		],
	)

	const beginPreparedGitPatch = useCallback(
		(
			patchPath: string,
			preview: GitPatchPreview,
		): Promise<PreparedApplyOutcome> => {
			if (
				workMode !== "git" ||
				isOperationRunningRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
			) {
				return Promise.resolve({
					status: "failed",
					undoReference: null,
				})
			}

			routedGitPatchResolutionRef.current?.resolve({
				status: "cancelled",
				undoReference: null,
			})
			setPendingGitPatch({
				patchPath,
				...preview,
			})
			setNotice(null)

			return new Promise(resolve => {
				routedGitPatchResolutionRef.current = {
					resolve,
				}
			})
		},
		[
			pendingGitPatch,
			pendingOverlay,
			workMode,
		],
	)

	const undoApplicationIfLatest = useCallback(
		async (reference: OperationUndoReference): Promise<boolean> => {
			const configuredRootFolder = rootFolderRef.current

			if (
				configuredRootFolder === null ||
				configuredRootFolder !== reference.projectRoot ||
				isOperationRunningRef.current
			)
				return false

			const currentHistory = await getProjectOverlayUndoHistory(
				configuredRootFolder,
				overlayUndoHistoryLimit,
			)

			if (!isContextualUndoEligible(
				reference,
				currentHistory[0],
			))
				return false

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await undoProjectOverlay(
					configuredRootFolder,
					1,
				)
				const outcome = undoOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				await refreshOverlayUndoHistory()
				setPendingOverlay(null)
				setPendingGitPatch(null)
				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.undoDone",
					{
						batches: result.undoneBatches,
						restored: result.restoredFiles,
						removed: result.removedFiles,
					},
				))
				return true
			} catch (error) {
				await refreshOverlayUndoHistory().catch(() => undefined)
				setNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						locale,
					),
				})
				return false
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)
			}
		},
		[
			locale,
			overlayUndoHistoryLimit,
			refreshOverlayUndoHistory,
		],
	)

	const confirmPendingGitPatch = useCallback(
		async (): Promise<void> => {
			const currentPatch = pendingGitPatch
			const configuredRootFolder = rootFolderRef.current
			const routedResolution = routedGitPatchResolutionRef.current

			if (
				currentPatch === null ||
				configuredRootFolder === null ||
				workMode !== "git" ||
				isOperationRunningRef.current
			)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)

			try {
				const result = await applyGitPatch(
					configuredRootFolder,
					currentPatch.patchPath,
					currentPatch.patchFingerprint,
					overlayUndoHistoryLimit,
				)
				const outcome = gitApplyOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				setPendingGitPatch(null)
				await refreshOverlayUndoHistory()
				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.gitPatchAppliedSummary",
					{ patch: currentPatch.patchName },
				))

				if (routedResolution !== null) {
					routedGitPatchResolutionRef.current = null
					routedResolution.resolve(outcome.undoReference === null ?
						{
							status: "failed",
							undoReference: null,
						} :
						{
							status: "success",
							undoReference: outcome.undoReference,
						})
				}
			} catch (error) {
				setPendingGitPatch(null)
				await refreshOverlayUndoHistory().catch(() => undefined)
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.gitPatchApplyFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})

				if (routedResolution !== null) {
					routedGitPatchResolutionRef.current = null
					routedResolution.resolve({
						status: "failed",
						undoReference: null,
					})
				}
			} finally {
				isOperationRunningRef.current = false
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)

				if (routedResolution === null)
					void cleanupActiveNativeDrop()
			}
		},
		[
			cleanupActiveNativeDrop,
			locale,
			overlayUndoHistoryLimit,
			pendingGitPatch,
			refreshOverlayUndoHistory,
			workMode,
		],
	)

	const cancelPendingGitPatch = useCallback(
		() => {
			if (pendingGitPatch === null)
				return

			const routedResolution = routedGitPatchResolutionRef.current

			setPendingGitPatch(null)

			if (routedResolution !== null) {
				routedGitPatchResolutionRef.current = null
				routedResolution.resolve({
					status: "cancelled",
					undoReference: null,
				})
				return
			}

			void cleanupActiveNativeDrop()
		},
		[
			cleanupActiveNativeDrop,
			pendingGitPatch,
		],
	)

	const confirmPendingOverlay = useCallback(
		async (candidate: OverlayDestinationCandidate) => {
			const currentPendingOverlay = pendingOverlay
			const configuredRootFolder = rootFolderRef.current
			const routedResolution = routedOverlayResolutionRef.current

			if (
				currentPendingOverlay === null ||
				configuredRootFolder === null ||
				isOperationRunningRef.current
			)
				return

			isOperationRunningRef.current = true
			setIsApplying(true)

			if (routedResolution !== null) {
				try {
					const result = await applyProjectOverlay(
						configuredRootFolder,
						currentPendingOverlay.paths,
						candidate,
						currentPendingOverlay.sourceFingerprint,
						currentPendingOverlay.routingFingerprint,
						routedResolution.appendUndo,
						overlayUndoHistoryLimit,
					)
					const outcome = filesApplyOutcomeFromResult(
						configuredRootFolder,
						result,
					)

					await refreshOverlayUndoHistory()
					setPendingOverlay(null)
					routedOverlayResolutionRef.current = null
					setNotice(createOperationOutcomeNotice(
						locale,
						outcome,
						outcome.status === "no_op" ?
							"workspace.applyAlreadyApplied" :
							"workspace.overlayAppliedSummary",
						outcome.status === "no_op" ?
							{} :
							{ destination: candidate.destinationRelativePath },
					))

					routedResolution.resolve(outcome.undoReference === null ?
						{
							status: "no_op",
							undoReference: null,
						} :
						{
							status: "success",
							undoReference: outcome.undoReference,
						})
				} catch (error) {
					setPendingOverlay(null)
					routedOverlayResolutionRef.current = null
					setNotice({
						kind: "error",
						message: translate(
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
					})
					routedResolution.resolve({
						status: "failed",
						undoReference: null,
					})
				} finally {
					isOperationRunningRef.current = false
					setOperationRevision(revision => revision + 1)
					setIsApplying(false)
				}

				return
			}

			try {
				const result = await applyProjectOverlay(
					configuredRootFolder,
					currentPendingOverlay.paths,
					candidate,
					currentPendingOverlay.sourceFingerprint,
					currentPendingOverlay.routingFingerprint,
					hasAppliedCurrentOverlayBatchRef.current,
					overlayUndoHistoryLimit,
				)
				const changed = result.addedFiles + result.replacedFiles + result.deletedFiles > 0

				if (changed)
					hasAppliedCurrentOverlayBatchRef.current = true

				overlayBatchStatsRef.current.createdFiles += result.addedFiles
				overlayBatchStatsRef.current.editedFiles += result.replacedFiles
				overlayBatchStatsRef.current.deletedFiles += result.deletedFiles
				overlayBatchStatsRef.current.unchangedFiles += result.unchangedFiles
				overlayBatchStatsRef.current.createdDirectories += result.addedDirectories
				overlayBatchStatsRef.current.editedDirectories += result.replacedDirectories
				overlayBatchStatsRef.current.deletedDirectories += result.deletedDirectories
				overlayBatchStatsRef.current.unchangedDirectories += result.unchangedDirectories
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
				setOperationRevision(revision => revision + 1)
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
			refreshOverlayUndoHistory,
		],
	)

	const cancelPendingOverlay = useCallback(
		() => {
			const currentPendingOverlay = pendingOverlay

			if (currentPendingOverlay === null)
				return

			const routedResolution = routedOverlayResolutionRef.current

			if (routedResolution !== null) {
				setPendingOverlay(null)
				routedOverlayResolutionRef.current = null
				routedResolution.resolve({
					status: "cancelled",
					undoReference: null,
				})
				return
			}

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
				const outcome = undoOutcomeFromResult(
					configuredRootFolder,
					result,
				)

				await refreshOverlayUndoHistory()
				setPendingOverlay(null)
				setPendingGitPatch(null)
				setNotice(createOperationOutcomeNotice(
					locale,
					outcome,
					"workspace.undoDone",
					{
						batches: result.undoneBatches,
						restored: result.restoredFiles,
						removed: result.removedFiles,
					},
				))
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
				setOperationRevision(revision => revision + 1)
				setIsApplying(false)
			}
		},
		[
			locale,
			overlayUndoHistory.length,
			refreshOverlayUndoHistory,
		],
	)

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
					content,
					byteCount: getGeneratedContentByteCount(content),
				})
				setNotice({
					kind: data.status.trim().length === 0 ?
						"info" :
						"success",
					message: translate(
						locale,
						data.status.trim().length === 0 ?
							"workspace.gitCommitContextClean" :
							"workspace.gitCommitContextGenerated",
					),
				})
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
			beginCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			loadGitCommitContext,
			locale,
			workMode,
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
					suggestedFileName: `${safeRepositoryName}-commit-context.txt`,
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
		],
	)

	const refreshFullProjectContextSummary = useCallback(
		async (): Promise<void> => {
			fullProjectSummaryRequestVersionRef.current += 1
			const requestedRootFolder = rootFolderRef.current

			if (requestedRootFolder === null)
				return

			setFullProjectContextSummaryState({
				rootFolder: requestedRootFolder,
				value: null,
			})

			if (contextPathFilterErrorRef.current !== null)
				return

			if (isInspectingProjectContextRef.current)
				return

			const cancellationToken = beginCancellableContextOperation("project")

			if (cancellationToken === null)
				return

			isInspectingProjectContextRef.current = true
			setIsInspectingProjectContext(true)

			try {
				if (await invalidateMissingRootFolder())
					return

				while (rootFolderRef.current !== null) {
					const requestVersion = fullProjectSummaryRequestVersionRef.current
					const configuredRootFolder = rootFolderRef.current

					if (configuredRootFolder === null)
						return

					if (contextPathFilterErrorRef.current !== null)
						return

					const filter = { ...contextFilterRef.current }
					let selection: ProcessDropResult

					try {
						selection = await processDrop(
							configuredRootFolder,
							[configuredRootFolder],
						)
					} catch (error) {
						if (requestVersion !== fullProjectSummaryRequestVersionRef.current)
							continue

						throw error
					}

					if (!isCancellableContextOperationActive(cancellationToken))
						return

					if (requestVersion !== fullProjectSummaryRequestVersionRef.current)
						continue

					if (rootFolderRef.current !== configuredRootFolder)
						continue

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

					setFullProjectContextSummaryState({
						rootFolder: configuredRootFolder,
						value: {
							fileCount: filteredFiles.length,
							byteCount,
						},
					})
					return
				}
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
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
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			invalidateMissingRootFolder,
			locale,
		],
	)

	const discoverFullProjectContextFiles = useCallback(
		async (cancellationToken: CancellableContextOperationToken) => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return null

			if (contextPathFilterError !== null) {
				setNotice({
					kind: "warning",
					message: contextPathFilterError,
				})
				return null
			}

			if (await invalidateMissingRootFolder())
				return null

			const rootRevision = rootRevisionRef.current
			const filter: ContextFilter = {
				pattern: contextPathFilter,
				target: contextFilterTarget,
				mode: contextFilterMode,
			}
			const selection = await processDrop(
				configuredRootFolder,
				[configuredRootFolder],
			)

			if (!isCancellableContextOperationActive(cancellationToken))
				return null

			if (
				rootFolderRef.current !== configuredRootFolder ||
				rootRevisionRef.current !== rootRevision
			) {
				throw new Error(translate(
					locale,
					"workspace.contextChangedDuringExport",
				))
			}

			return {
				rootFolder: configuredRootFolder,
				files: filterContextFiles(
					selection.files,
					filter,
				),
			}
		},
		[
			isCancellableContextOperationActive,
			contextFilterMode,
			contextFilterTarget,
			contextPathFilter,
			contextPathFilterError,
			invalidateMissingRootFolder,
			locale,
		],
	)

	const loadFullProjectContext = useCallback(
		async (cancellationToken: CancellableContextOperationToken): Promise<string | null> => {
			const discovery = await discoverFullProjectContextFiles(cancellationToken)

			if (discovery === null)
				return null

			if (discovery.files.length === 0) {
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
				discovery.files.map(file => file.relativePath),
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

			return formatGeneratedContent(
				materialized.files,
				locale,
				workMode,
			)
		},
		[
			isCancellableContextOperationActive,
			discoverFullProjectContextFiles,
			locale,
			pathsOnly,
			workMode,
		],
	)

	const copyFullProjectContext = useCallback(
		async (): Promise<void> => {
			if (isGeneratingCommitContextRef.current)
				return

			const cancellationToken = beginCancellableContextOperation("project")

			if (cancellationToken === null)
				return

			isGeneratingCommitContextRef.current = true
			setIsGeneratingProjectContext(true)

			try {
				const content = await loadFullProjectContext(cancellationToken)

				if (content === null || !commitCancellableContextOperation(cancellationToken))
					return

				await writeText(content)
				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.projectContextCopied",
					),
				})
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

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
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isGeneratingCommitContextRef.current = false
					setIsGeneratingProjectContext(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			loadFullProjectContext,
			locale,
		],
	)

	const downloadFullProjectContext = useCallback(
		async (): Promise<void> => {
			if (isGeneratingCommitContextRef.current)
				return

			const cancellationToken = beginCancellableContextOperation("project")

			if (cancellationToken === null)
				return

			isGeneratingCommitContextRef.current = true
			setIsGeneratingProjectContext(true)

			try {
				const discovery = await discoverFullProjectContextFiles(cancellationToken)

				if (discovery === null)
					return

				if (discovery.files.length === 0) {
					setNotice({
						kind: "info",
						message: translate(
							locale,
							"workspace.projectContextEmpty",
						),
					})
					return
				}

				if (!commitCancellableContextOperation(cancellationToken))
					return

				const result = await saveFullProjectContextExportFile({
					rootFolder: discovery.rootFolder,
					relativePaths: discovery.files.map(file => file.relativePath),
					pathsOnly,
					locale,
					workMode,
					suggestedFileName: `${getSafeProjectName(discovery.rootFolder)}-project-context.txt`,
					dialogTitle: translate(
						locale,
						"dialog.saveProjectContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
				})

				if (result.fileCount === 0) {
					setNotice({
						kind: "info",
						message: translate(
							locale,
							"workspace.projectContextEmpty",
						),
					})
					return
				}

				if (!result.saved)
					return

				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.projectContextDownloaded",
					),
				})
			} catch (error) {
				if (!isCancellableContextOperationActive(cancellationToken))
					return

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
			} finally {
				if (finishCancellableContextOperation(cancellationToken)) {
					isGeneratingCommitContextRef.current = false
					setIsGeneratingProjectContext(false)
				}
			}
		},
		[
			beginCancellableContextOperation,
			commitCancellableContextOperation,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			discoverFullProjectContextFiles,
			locale,
			pathsOnly,
			workMode,
		],
	)

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

			let projectCodeExecutionApproved = trustedDiagnosticRootsRef.current.has(configuredRootFolder)

			if (!projectCodeExecutionApproved) {
				projectCodeExecutionApproved = await confirm(
					translate(
						locale,
						"workspace.diagnosticTrustMessage",
					),
					{
						title: translate(
							locale,
							"workspace.diagnosticTrustTitle",
						),
						kind: "warning",
						okLabel: translate(
							locale,
							"workspace.diagnosticTrustConfirm",
						),
						cancelLabel: translate(
							locale,
							"workspace.diagnosticTrustCancel",
						),
					},
				)

				if (!projectCodeExecutionApproved || !isCancellableContextOperationActive(cancellationToken))
					return null

				await approveProjectDiagnostics(configuredRootFolder)
				trustedDiagnosticRootsRef.current.add(configuredRootFolder)
			}

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
			workMode,
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
				setNotice(createProjectDiagnosticNotice(
					result.data,
					locale,
				))
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
			beginCancellableContextOperation,
			diagnosticFileLimit,
			finishCancellableContextOperation,
			isCancellableContextOperationActive,
			loadDiagnosticContext,
			locale,
			workMode,
		],
	)

	const copyDiagnosticContext = useCallback(
		async (kind: ProjectDiagnosticKind): Promise<void> => {
			const prepared = currentPreparedDiagnosticContexts[kind]

			if (prepared === null)
				return

			try {
				await writeText(prepared.content)
				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.diagnosticContextCopied",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.diagnosticContextCopyFailed",
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
			currentPreparedDiagnosticContexts,
			locale,
		],
	)

	const downloadDiagnosticContext = useCallback(
		async (kind: ProjectDiagnosticKind): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current
			const prepared = currentPreparedDiagnosticContexts[kind]

			if (configuredRootFolder === null || prepared === null)
				return

			try {
				const saved = await saveExportFile({
					suggestedFileName: `${getSafeProjectName(configuredRootFolder)}-${kind}-context.txt`,
					dialogTitle: translate(
						locale,
						kind === "typecheck" ?
							"dialog.saveTypecheckContext" :
							"dialog.saveEslintContext",
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
						"workspace.diagnosticContextDownloaded",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.diagnosticContextDownloadFailed",
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
			currentPreparedDiagnosticContexts,
			locale,
		],
	)

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

				const preserveSelection = autoClearAfterExport && materialized.skippedFiles > 0

				if (autoClearAfterExport && !preserveSelection) {
					if (!await archiveContextSnapshot(
						materialized.content,
						materialized.fileCount,
					))
						return

					replaceFiles([])
				}

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
		],
	)

	const copyContextHistory = useCallback(
		async (entry: ContextHistoryEntry): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				const revision = rootRevisionRef.current
				const content = await getContextHistoryContent(
					configuredRootFolder,
					entry.id,
				)

				if (
					rootFolderRef.current !== configuredRootFolder ||
					rootRevisionRef.current !== revision
				)
					return

				await writeText(content)
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
			const configuredRootFolder = rootFolderRef.current

			if (configuredRootFolder === null)
				return

			try {
				const saved = await saveContextHistoryExportFile({
					rootFolder: configuredRootFolder,
					id: entry.id,
					suggestedFileName: "orqeto-dev-context-history.txt",
					dialogTitle: translate(
						locale,
						"dialog.saveContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
				})

				if (!saved)
					return
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
				const revision = rootRevisionRef.current
				const entries = await deleteContextHistoryEntry(
					configuredRootFolder,
					entry.id,
					contextHistoryLimit,
				)
				if (
					rootFolderRef.current === configuredRootFolder &&
					rootRevisionRef.current === revision
				)
					setContextHistory(entries)
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
				isGeneratingCommitContextRef.current ||
				pendingOverlay !== null ||
				pendingGitPatch !== null
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

			await cleanupActiveNativeDrop()
			return true
		},
		[
			cleanupActiveNativeDrop,
			locale,
			pendingGitPatch,
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
		workMode,
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
		isGitRepository,
		isGeneratingCommitContext,
		gitCommitContextByteCount: currentPreparedGitCommitContext?.byteCount ?? null,
		diagnosticContextByteCounts: {
			typecheck: currentPreparedDiagnosticContexts.typecheck?.byteCount ?? null,
			eslint: currentPreparedDiagnosticContexts.eslint?.byteCount ?? null,
		},
		isGeneratingProjectContext,
		isInspectingProjectContext,
		fullProjectContextSummary,
		diagnosticContextKind,
		cancellableContextOperationKind,
		cancelledContextOperationKind,
		isCancellableContextOperationCancelled,
		diagnosticCapabilities,
		pendingOverlay,
		pendingGitPatch,
		overlayUndoHistory,
		generatedContent: pathSelectionContent,
		generatedContentSize,
		selectRootFolder,
		configureRootFolder,
		prepareForTabClose,
		openConfiguredFolder,
		openConfiguredFolderInVscode,
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
		generateGitCommitContextReport,
		copyGitCommitContext,
		downloadGitCommitContext,
		copyFullProjectContext,
		downloadFullProjectContext,
		refreshFullProjectContextSummary,
		generateDiagnosticContextReport,
		copyDiagnosticContext,
		downloadDiagnosticContext,
		cancelCancellableContextOperation,
		addDroppedPaths,
		removeDroppedPaths,
		applyDroppedPaths,
		applyPreparedOverlay,
		beginPreparedOverlayResolution,
		beginPreparedGitPatch,
		undoApplicationIfLatest,
		confirmPendingGitPatch,
		cancelPendingGitPatch,
		confirmPendingOverlay,
		cancelPendingOverlay,
		undoOverlay,
	}
}
