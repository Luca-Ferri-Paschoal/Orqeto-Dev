import { getContextPathFilterError } from "../contextPathFilter"
import { formatGeneratedContent } from "../formatGeneratedContent"
import { getGeneratedContentSize } from "../formatGeneratedContent"
import { createClientOperationId } from "../operationOutcome"
import type {
	AppNotice,
	ContextHistoryEntry,
	ContextSelectionFile,
	FullProjectContextSummary,
	OverlayUndoHistoryEntry,
	PendingGitPatch,
	PendingProjectOverlay,
	ProjectDiagnosticCapabilities,
	ProjectDiagnosticKind,
	ProjectValidationCommandKind,
} from "../types"
import type {
	CancellableContextOperationKind,
	CancellableContextOperationToken,
	ContextWorkspacePreferences,
	OverlayBatchStats,
	OverlayQueueItem,
	PreparedApplyOutcome,
	PreparedDiagnosticContext,
	PreparedGitCommitContext,
	PreparedValidationCommandContext,
} from "./types"
import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "@/domain/contextFilter"
import {
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react"

export function useWorkspaceState(
	initialRootFolder: string | null,
	preferences: ContextWorkspacePreferences,
) {
	const {
		locale,
		workMode,
		contextFilterHistoryLimit,
		contextHistoryLimit,
		overlayUndoHistoryLimit,
		diagnosticFileLimit,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
	} = preferences
	const [rootFolder, setRootFolder] = useState<string | null>(initialRootFolder)
	const [contextPathFilter, setContextPathFilter] = useState("")
	const [contextFilterTarget, setContextFilterTarget] = useState<ContextFilterTarget>("fileName")
	const [contextFilterMode, setContextFilterMode] = useState<ContextFilterMode>("contains")
	const [contextFilterHistory, setContextFilterHistory] = useState<ContextFilterHistoryEntry[]>([])
	const [contextHistory, setContextHistory] = useState<ContextHistoryEntry[]>([])
	const [pathsOnly, setPathsOnly] = useState(false)
	const [files, setFiles] = useState<ContextSelectionFile[]>([])
	const [notice, setNotice] = useState<AppNotice | null>(null)
	const publishNotice = useCallback(
		(nextNotice: AppNotice | null): void => setNotice(nextNotice),
		[],
	)
	const [isReady, setIsReady] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [isApplying, setIsApplying] = useState(false)
	const [operationRevision, setOperationRevision] = useState(0)
	const [gitRepositoryState, setGitRepositoryState] = useState({ rootFolder: null as string | null, value: false })
	const isGitRepository = gitRepositoryState.rootFolder === rootFolder && gitRepositoryState.value
	const [isGeneratingCommitContext, setIsGeneratingCommitContext] = useState(false)
	const [isGeneratingProjectContext, setIsGeneratingProjectContext] = useState(false)
	const [isInspectingProjectContext, setIsInspectingProjectContext] = useState(false)
	const [fullProjectContextScanState, setFullProjectContextScanState] = useState<{
		rootFolder: string | null
		value: { summary: FullProjectContextSummary; relativePaths: string[] } | null
	}>({ rootFolder: null, value: null })
	const fullProjectContextSummary = fullProjectContextScanState.rootFolder === rootFolder ?
		fullProjectContextScanState.value?.summary ?? null :
		null
	const [diagnosticContextKind, setDiagnosticContextKind] = useState<ProjectDiagnosticKind | null>(null)
	const [isFixingLint, setIsFixingLint] = useState(false)
	const [preparedGitCommitContext, setPreparedGitCommitContext] = useState<PreparedGitCommitContext | null>(null)
	const [preparedDiagnosticContexts, setPreparedDiagnosticContexts] = useState<Record<ProjectDiagnosticKind, PreparedDiagnosticContext | null>>({ typecheck: null, eslint: null })
	const [preparedValidationCommandContexts, setPreparedValidationCommandContexts] = useState<Record<ProjectValidationCommandKind, PreparedValidationCommandContext | null>>({ lintfix: null, test: null })
	const [validationCommandKind, setValidationCommandKind] = useState<ProjectValidationCommandKind | null>(null)
	const [cancellableContextOperationKind, setCancellableContextOperationKind] = useState<CancellableContextOperationKind | null>(null)
	const [cancelledContextOperationKind, setCancelledContextOperationKind] = useState<CancellableContextOperationKind | null>(null)
	const [isCancellableContextOperationCancelled, setIsCancellableContextOperationCancelled] = useState(false)
	const emptyCapabilities: ProjectDiagnosticCapabilities = { typecheck: false, eslint: false, lintFixCommand: null, testCommand: null, developmentLogCommand: null }
	const [diagnosticCapabilitiesState, setDiagnosticCapabilitiesState] = useState({ rootFolder: null as string | null, value: emptyCapabilities })
	const diagnosticCapabilities = diagnosticCapabilitiesState.rootFolder === rootFolder ?
		diagnosticCapabilitiesState.value :
		emptyCapabilities
	const currentPreparedGitCommitContext = preparedGitCommitContext?.rootFolder === rootFolder &&
		preparedGitCommitContext.locale === locale && preparedGitCommitContext.workMode === workMode ?
		preparedGitCommitContext :
		null
	const getCurrentPreparedDiagnosticContext = (prepared: PreparedDiagnosticContext | null): PreparedDiagnosticContext | null => {
		if (prepared === null)
			return null

		return prepared.rootFolder === rootFolder &&
			prepared.locale === locale &&
			prepared.workMode === workMode &&
			prepared.diagnosticFileLimit === diagnosticFileLimit ?
			prepared :
			null
	}
	const currentPreparedDiagnosticContexts = {
		typecheck: getCurrentPreparedDiagnosticContext(preparedDiagnosticContexts.typecheck),
		eslint: getCurrentPreparedDiagnosticContext(preparedDiagnosticContexts.eslint),
	} satisfies Record<ProjectDiagnosticKind, PreparedDiagnosticContext | null>
	const getCurrentPreparedValidationCommandContext = (prepared: PreparedValidationCommandContext | null): PreparedValidationCommandContext | null => {
		if (prepared === null)
			return null

		return prepared.rootFolder === rootFolder && prepared.locale === locale ?
			prepared :
			null
	}
	const currentPreparedValidationCommandContexts = {
		lintfix: getCurrentPreparedValidationCommandContext(preparedValidationCommandContexts.lintfix),
		test: getCurrentPreparedValidationCommandContext(preparedValidationCommandContexts.test),
	} satisfies Record<ProjectValidationCommandKind, PreparedValidationCommandContext | null>
	const [pendingOverlay, setPendingOverlay] = useState<PendingProjectOverlay | null>(null)
	const [pendingGitPatch, setPendingGitPatch] = useState<PendingGitPatch | null>(null)
	const [overlayUndoHistory, setOverlayUndoHistory] = useState<OverlayUndoHistoryEntry[]>([])

	const filesRef = useRef<ContextSelectionFile[]>([])
	const contextSelectionRevisionRef = useRef(0)
	const rootFolderRef = useRef<string | null>(initialRootFolder)
	const rootRevisionRef = useRef(0)
	const isOperationRunningRef = useRef(false)
	const isGeneratingCommitContextRef = useRef(false)
	const isFixingLintRef = useRef(false)
	const isInspectingProjectContextRef = useRef(false)
	const fullProjectSummaryRequestVersionRef = useRef(0)
	const cancellableContextOperationSequenceRef = useRef(0)
	const cancellableContextOperationRef = useRef<CancellableContextOperationToken | null>(null)
	const trustedDiagnosticRootsRef = useRef(new Set<string>())
	const trustedCustomValidationCommandsRef = useRef(new Set<string>())
	const handledWorkModeRef = useRef(workMode)
	const deferredWorkModeCleanupRef = useRef(false)
	const pendingOverlayQueueRef = useRef<OverlayQueueItem[]>([])
	const pendingOverlayQueueIndexRef = useRef(0)
	const hasAppliedCurrentOverlayBatchRef = useRef(false)
	const activeNativeDropRootRef = useRef<string | null>(null)
	const routedOverlayResolutionRef = useRef<{ appendUndo: boolean; resolve: (outcome: PreparedApplyOutcome) => void } | null>(null)
	const routedGitPatchResolutionRef = useRef<{ resolve: (outcome: PreparedApplyOutcome) => void } | null>(null)
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
		protectedSecretFiles: 0,
		detectedSecrets: 0,
		permanentDeletedFiles: 0,
		permanentDeletedDirectories: 0,
		permanentDeletionError: null,
		rejectedFiles: 0,
		skippedFiles: 0,
		firstFailure: null,
	})

	const pathSelectionContent = useMemo(() => formatGeneratedContent(
		files.map(file => ({ relativePath: file.relativePath, content: null })),
		locale,
		workMode,
	), [files, locale, workMode])
	const generatedContentSize = useMemo(
		() => pathsOnly ?
			getGeneratedContentSize(pathSelectionContent) :
			null,
		[pathSelectionContent, pathsOnly],
	)
	const contextPathFilterError = useMemo(() => getContextPathFilterError({
		pattern: contextPathFilter,
		target: contextFilterTarget,
		mode: contextFilterMode,
	}, locale), [contextFilterMode, contextFilterTarget, contextPathFilter, locale])

	return {
		...preferences,
		activeNativeDropRootRef,
		cancellableContextOperationKind,
		cancellableContextOperationRef,
		cancellableContextOperationSequenceRef,
		cancelledContextOperationKind,
		closeExplorerOnFolderClose,
		contextFilterHistory,
		contextFilterHistoryLimit,
		contextFilterMode,
		contextFilterTarget,
		contextHistory,
		contextHistoryLimit,
		contextPathFilter,
		contextPathFilterError,
		contextSelectionRevisionRef,
		currentPreparedDiagnosticContexts,
		currentPreparedGitCommitContext,
		currentPreparedValidationCommandContexts,
		deferredWorkModeCleanupRef,
		diagnosticCapabilities,
		diagnosticCapabilitiesState,
		diagnosticContextKind,
		diagnosticFileLimit,
		files,
		filesRef,
		fullProjectContextScanState,
		fullProjectContextSummary,
		fullProjectSummaryRequestVersionRef,
		generatedContentSize,
		gitRepositoryState,
		handledWorkModeRef,
		hasAppliedCurrentOverlayBatchRef,
		isApplying,
		isCancellableContextOperationCancelled,
		isFixingLint,
		isFixingLintRef,
		isGeneratingCommitContext,
		isGeneratingCommitContextRef,
		isGeneratingProjectContext,
		isGitRepository,
		isInspectingProjectContext,
		isInspectingProjectContextRef,
		isOperationRunningRef,
		isProcessing,
		isReady,
		locale,
		notice,
		openExplorerOnProjectOpen,
		operationRevision,
		overlayBatchStatsRef,
		overlayUndoHistory,
		overlayUndoHistoryLimit,
		pathSelectionContent,
		pathsOnly,
		pendingGitPatch,
		pendingOverlay,
		pendingOverlayQueueIndexRef,
		pendingOverlayQueueRef,
		preparedDiagnosticContexts,
		preparedGitCommitContext,
		preparedValidationCommandContexts,
		publishNotice,
		rootFolder,
		rootFolderRef,
		rootRevisionRef,
		routedGitPatchResolutionRef,
		routedOverlayResolutionRef,
		setCancellableContextOperationKind,
		setCancelledContextOperationKind,
		setContextFilterHistory,
		setContextFilterMode,
		setContextFilterTarget,
		setContextHistory,
		setContextPathFilter,
		setDiagnosticCapabilitiesState,
		setDiagnosticContextKind,
		setFiles,
		setFullProjectContextScanState,
		setGitRepositoryState,
		setIsApplying,
		setIsCancellableContextOperationCancelled,
		setIsFixingLint,
		setIsGeneratingCommitContext,
		setIsGeneratingProjectContext,
		setIsInspectingProjectContext,
		setIsProcessing,
		setIsReady,
		setNotice,
		setOperationRevision,
		setOverlayUndoHistory,
		setPathsOnly,
		setPendingGitPatch,
		setPendingOverlay,
		setPreparedDiagnosticContexts,
		setPreparedGitCommitContext,
		setPreparedValidationCommandContexts,
		setRootFolder,
		setValidationCommandKind,
		trustedCustomValidationCommandsRef,
		trustedDiagnosticRootsRef,
		validationCommandKind,
		workMode,
	}
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>
