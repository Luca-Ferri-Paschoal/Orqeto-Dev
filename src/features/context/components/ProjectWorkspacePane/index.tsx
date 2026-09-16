import { formatByteSize } from "../../formatGeneratedContent"
import {
	type OperationUndoReference,
	projectIgnoreOutcomeFromResult,
} from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type {
	AppNotice,
	ContextMode,
	FolderAction,
	GitPatchPreview,
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
	ProjectSection,
} from "../../types"
import {
	type ContextWorkspacePreferences,
	type PreparedApplyOutcome,
	useContextWorkspace,
} from "../../useContextWorkspace"
import { ApplyDropZone } from "../ApplyDropZone"
import { ContentSummary } from "../ContentSummary"
import { ContextExportActions } from "../ContextExportActions"
import { DevIgnoreDialog } from "../DevIgnoreDialog"
import { DropZone } from "../DropZone"
import {
	type ContextSectionMode,
	FolderSettings,
} from "../FolderSettings"
import { GitPatchPreviewDialog } from "../GitPatchPreviewDialog"
import { OverlayDestinationDialog } from "../OverlayDestinationDialog"
import { styles } from "./style"
import { getErrorMessage } from "@/features/context/utils"
import {
	cleanupNativeDrop,
	createProjectIgnore,
	projectIgnoreExists as checkProjectIgnoreExists,
	updateProjectIgnore,
} from "@/infra/desktop"
import {
	translate,
	translateCount,
} from "@/infra/i18n"
import { LoadingOverlay } from "@/shared/components/LoadingOverlay"
import { Notice } from "@/shared/components/Notice"
import {
	containsPhysicalPosition,
	type PhysicalPosition,
} from "@/shared/dom/physicalPosition"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

type DropTarget = "contextAdd" | "contextRemove" | "apply" | "ignoreAdd" | "ignoreRemove"

interface NativeDropPayload {
	type: "enter" | "over" | "leave" | "drop"
	position?: PhysicalPosition
	paths?: string[]
	temporaryRoot?: string | null
}

type IgnoreNotice = AppNotice

interface ProjectIgnoreStatus {
	rootFolder: string
	exists: boolean
}

interface ProjectIgnoreNoticeState {
	rootFolder: string | null
	notice: IgnoreNotice
}

export interface ProjectWorkspaceHandle {
	addExternalContext: (paths: string[]) => Promise<void>
	addExternalContextAndCopy: (paths: string[]) => Promise<void>
	removeExternalContext: (paths: string[]) => Promise<void>
	addExternalIgnore: (paths: string[]) => Promise<void>
	removeExternalIgnore: (paths: string[]) => Promise<void>
	openExternalRoot: (path: string) => Promise<boolean>
	prepareForTabClose: () => Promise<boolean>
	canAcceptRoutedApply: () => boolean
	applyPreparedOverlay: (
		paths: string[],
		candidate: OverlayDestinationCandidate,
		sourceFingerprint: string,
		routingFingerprint: string,
		appendUndo: boolean,
	) => Promise<PreparedApplyOutcome>
	beginPreparedOverlayResolution: (
		paths: string[],
		sourceLabel: string,
		plan: PrepareProjectOverlayResult,
		appendUndo: boolean,
	) => Promise<PreparedApplyOutcome>
	beginPreparedGitPatch: (
		patchPath: string,
		preview: GitPatchPreview,
	) => Promise<PreparedApplyOutcome>
	undoApplicationIfLatest: (reference: OperationUndoReference) => Promise<boolean>
	cancelContextOperation: () => void
}

interface ProjectWorkspacePaneProps {
	tabId: string
	active: boolean
	interactionBlocked: boolean
	routingBusy: boolean
	routingDecisionPending: boolean
	vscodeAvailable: boolean
	initialRootFolder: string | null
	folderSectionExpanded: boolean
	folderAction: FolderAction
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
	ignoreDialogOpen: boolean
	folderPickerReferenceRoot: string | null
	preferences: ContextWorkspacePreferences
	onRootFolderChange: (rootFolder: string | null) => Promise<boolean>
	onFolderActionChange: (action: FolderAction) => void
	onSectionExpandedChange: (
		section: ProjectSection,
		expanded: boolean,
	) => void
	onContextModeChange: (
		tabId: string,
		mode: ContextMode,
	) => void
	onRegister: (
		tabId: string,
		handle: ProjectWorkspaceHandle | null,
	) => void
	onIgnoreDialogOpenChange: (open: boolean) => void
	onApplyDrop: (
		tabId: string,
		paths: string[],
		temporaryRoot: string | null,
	) => void
}

const DRAG_AUTO_SCROLL_EDGE_PX = 72
const DRAG_AUTO_SCROLL_MAX_STEP_PX = 18

function getDragAutoScrollStep(
	position: PhysicalPosition,
	scrollContainer: HTMLElement,
): number {
	const scaleFactor = window.devicePixelRatio || 1
	const clientY = position.y / scaleFactor
	const rect = scrollContainer.getBoundingClientRect()
	const visibleTop = Math.max(
		0,
		rect.top,
	)
	const visibleBottom = Math.min(
		window.innerHeight,
		rect.bottom,
	)
	const visibleHeight = Math.max(
		0,
		visibleBottom - visibleTop,
	)
	const edgeSize = Math.min(
		DRAG_AUTO_SCROLL_EDGE_PX,
		visibleHeight / 3,
	)

	if (edgeSize <= 0)
		return 0

	const topEdgeEnd = visibleTop + edgeSize

	if (clientY < topEdgeEnd) {
		const intensity = Math.min(
			1,
			Math.max(
				0,
				(topEdgeEnd - clientY) / edgeSize,
			),
		)

		return -Math.max(
			1,
			Math.round(DRAG_AUTO_SCROLL_MAX_STEP_PX * intensity * intensity),
		)
	}

	const bottomEdgeStart = visibleBottom - edgeSize

	if (clientY > bottomEdgeStart) {
		const intensity = Math.min(
			1,
			Math.max(
				0,
				(clientY - bottomEdgeStart) / edgeSize,
			),
		)

		return Math.max(
			1,
			Math.round(DRAG_AUTO_SCROLL_MAX_STEP_PX * intensity * intensity),
		)
	}

	return 0
}

export function ProjectWorkspacePane({
	tabId,
	active,
	interactionBlocked,
	routingBusy,
	routingDecisionPending,
	vscodeAvailable,
	initialRootFolder,
	folderSectionExpanded,
	folderAction,
	contextSectionExpanded,
	applySectionExpanded,
	ignoreDialogOpen,
	folderPickerReferenceRoot,
	preferences,
	onRootFolderChange,
	onFolderActionChange,
	onSectionExpandedChange,
	onContextModeChange,
	onRegister,
	onIgnoreDialogOpenChange,
	onApplyDrop,
}: ProjectWorkspacePaneProps) {
	const onRootFolderChangeRef = useRef(onRootFolderChange)

	useEffect(
		() => {
			onRootFolderChangeRef.current = onRootFolderChange
		},
		[onRootFolderChange],
	)

	const [requestedContextMode, setRequestedContextMode] = useState<ContextMode>("create")
	const changeRootFolder = useCallback(
		async (rootFolder: string | null): Promise<boolean> => {
			const changed = await onRootFolderChangeRef.current(rootFolder)

			if (changed)
				setRequestedContextMode("create")

			return changed
		},
		[],
	)
	const workspace = useContextWorkspace({
		active,
		initialRootFolder,
		folderPickerReferenceRoot,
		preferences,
		onRootFolderChange: changeRootFolder,
	})
	const workspaceRef = useRef(workspace)

	useEffect(
		() => {
			workspaceRef.current = workspace
		},
		[workspace],
	)

	const contextMode: ContextMode = workspace.rootFolder === null ||
		(requestedContextMode === "commit" && !workspace.isGitRepository) ||
		(requestedContextMode === "typecheck" && !workspace.diagnosticCapabilities.typecheck) ||
		(requestedContextMode === "eslint" && !workspace.diagnosticCapabilities.eslint) ?
		"create" :
		requestedContextMode
	const contextModeRef = useRef<ContextMode>("create")

	useEffect(
		() => {
			contextModeRef.current = contextMode
			onContextModeChange(
				tabId,
				contextMode,
			)
		},
		[
			contextMode,
			onContextModeChange,
			tabId,
		],
	)

	const {
		contextFilterMode: workspaceContextFilterMode,
		contextFilterTarget: workspaceContextFilterTarget,
		contextPathFilter: workspaceContextPathFilter,
		refreshFullProjectContextSummary,
		rootFolder: workspaceRootFolder,
	} = workspace

	useEffect(
		() => {
			if (
				!active ||
				contextMode !== "project" ||
				workspaceRootFolder === null
			)
				return

			const refreshTimer = window.setTimeout(
				() => void refreshFullProjectContextSummary(),
				180,
			)

			return () => window.clearTimeout(refreshTimer)
		},
		[
			active,
			contextMode,
			refreshFullProjectContextSummary,
			workspaceContextFilterMode,
			workspaceContextFilterTarget,
			workspaceContextPathFilter,
			workspaceRootFolder,
		],
	)

	const [projectIgnoreStatus, setProjectIgnoreStatus] = useState<ProjectIgnoreStatus | null>(null)
	const [isUpdatingProjectIgnore, setIsUpdatingProjectIgnore] = useState(false)
	const [ignoreNoticeState, setIgnoreNoticeState] = useState<ProjectIgnoreNoticeState | null>(null)
	const projectIgnoreFileExists = workspace.rootFolder === null ?
		false :
		projectIgnoreStatus?.rootFolder === workspace.rootFolder ?
			projectIgnoreStatus.exists :
			null
	const ignoreNotice = ignoreNoticeState?.rootFolder === workspace.rootFolder ?
		ignoreNoticeState.notice :
		null
	const ignoreDialogOpenRef = useRef(ignoreDialogOpen)
	const isUpdatingProjectIgnoreRef = useRef(isUpdatingProjectIgnore)
	const onIgnoreDialogOpenChangeRef = useRef(onIgnoreDialogOpenChange)
	const ignoreUpdateQueueRef = useRef<Promise<void>>(Promise.resolve())
	const pendingIgnoreOperationsRef = useRef(0)
	const ignoreAddDropZoneRef = useRef<HTMLElement | null>(null)
	const ignoreRemoveDropZoneRef = useRef<HTMLElement | null>(null)

	const setIgnoreNotice = useCallback(
		(notice: IgnoreNotice | null): void => {
			setIgnoreNoticeState(notice === null ?
				null :
				{
					rootFolder: workspaceRef.current.rootFolder,
					notice,
				})
		},
		[],
	)

	const setProjectIgnoreFileExists = useCallback(
		(
			rootFolder: string,
			exists: boolean,
		): void => {
			setProjectIgnoreStatus({
				rootFolder,
				exists,
			})
		},
		[],
	)

	const addDroppedPaths = workspace.addDroppedPaths
	const removeDroppedPaths = workspace.removeDroppedPaths
	const pendingOverlay = workspace.pendingOverlay
	const pendingGitPatch = workspace.pendingGitPatch
	const [dragTarget, setDragTarget] = useState<DropTarget | null>(null)
	const visibleDragTarget = active ?
		dragTarget :
		null
	const contextAddDropZoneRef = useRef<HTMLElement | null>(null)
	const contextRemoveDropZoneRef = useRef<HTMLElement | null>(null)
	const applyDropZoneRef = useRef<HTMLElement | null>(null)
	const cancelledOperationKind = workspace.cancelledContextOperationKind
	const isProcessingForInteraction = workspace.isProcessing &&
		cancelledOperationKind !== "create" &&
		cancelledOperationKind !== "custom"
	const isGeneratingCommitContextForInteraction = workspace.isGeneratingCommitContext &&
		cancelledOperationKind !== "commit"
	const isGeneratingProjectContextForInteraction = workspace.isGeneratingProjectContext &&
		cancelledOperationKind !== "project"
	const isInspectingProjectContextForInteraction = workspace.isInspectingProjectContext &&
		cancelledOperationKind !== "project"
	const diagnosticContextKindForInteraction = workspace.diagnosticContextKind === cancelledOperationKind ?
		null :
		workspace.diagnosticContextKind
	const isGeneratingDerivedContextForInteraction = isGeneratingCommitContextForInteraction ||
		isGeneratingProjectContextForInteraction ||
		isInspectingProjectContextForInteraction ||
		diagnosticContextKindForInteraction !== null
	const isInteractionBusy = !workspace.isReady ||
		isProcessingForInteraction ||
		workspace.isApplying ||
		isGeneratingDerivedContextForInteraction ||
		isUpdatingProjectIgnore
	const isTabBusy = isInteractionBusy || routingBusy
	const suppressLoadingOverlay = routingDecisionPending ||
		pendingOverlay !== null ||
		pendingGitPatch !== null
	const canCancelTabOperation = !routingBusy &&
		!workspace.isCancellableContextOperationCancelled &&
		workspace.cancellableContextOperationKind !== null

	const contextAddDropEnabled = contextMode === "create" &&
		!interactionBlocked &&
		!routingBusy &&
		!ignoreDialogOpen &&
		workspace.rootFolder !== null &&
		workspace.isReady &&
		!isProcessingForInteraction &&
		!workspace.isApplying &&
		!isGeneratingDerivedContextForInteraction &&
		workspace.contextPathFilterError === null
	const contextRemoveDropEnabled = contextMode === "create" &&
		!interactionBlocked &&
		!routingBusy &&
		!ignoreDialogOpen &&
		workspace.rootFolder !== null &&
		workspace.isReady &&
		!isProcessingForInteraction &&
		!workspace.isApplying &&
		!isGeneratingDerivedContextForInteraction &&
		workspace.contextPathFilterError === null
	const applyDropEnabled = !interactionBlocked &&
		!routingBusy &&
		!ignoreDialogOpen &&
		workspace.rootFolder !== null &&
		workspace.isReady &&
		!isProcessingForInteraction &&
		!workspace.isApplying &&
		!isGeneratingDerivedContextForInteraction &&
		pendingOverlay === null &&
		pendingGitPatch === null
	const undoEnabled = !interactionBlocked &&
		!routingBusy &&
		!ignoreDialogOpen &&
		workspace.rootFolder !== null &&
		workspace.isReady &&
		!isProcessingForInteraction &&
		!workspace.isApplying &&
		!isGeneratingDerivedContextForInteraction &&
		pendingOverlay === null &&
		pendingGitPatch === null

	useEffect(
		() => {
			ignoreDialogOpenRef.current = ignoreDialogOpen
		},
		[ignoreDialogOpen],
	)

	useEffect(
		() => {
			isUpdatingProjectIgnoreRef.current = isUpdatingProjectIgnore
		},
		[isUpdatingProjectIgnore],
	)

	useEffect(
		() => {
			onIgnoreDialogOpenChangeRef.current = onIgnoreDialogOpenChange
		},
		[onIgnoreDialogOpenChange],
	)

	const setIgnoreOperationPending = useCallback(
		(pending: boolean): void => {
			pendingIgnoreOperationsRef.current += pending ?
				1 :
				-1
			pendingIgnoreOperationsRef.current = Math.max(
				0,
				pendingIgnoreOperationsRef.current,
			)
			const isPending = pendingIgnoreOperationsRef.current > 0

			isUpdatingProjectIgnoreRef.current = isPending
			setIsUpdatingProjectIgnore(isPending)
		},
		[],
	)

	useEffect(
		() => {
			let cancelled = false
			const rootFolder = workspace.rootFolder

			if (rootFolder === null) {
				onIgnoreDialogOpenChangeRef.current(false)
				return
			}

			void checkProjectIgnoreExists(rootFolder)
				.then(exists => {
					if (!cancelled) {
						setProjectIgnoreFileExists(
							rootFolder,
							exists,
						)
					}
				})
				.catch(error => {
					if (cancelled)
						return

					setProjectIgnoreFileExists(
						rootFolder,
						false,
					)
					setIgnoreNotice({
						kind: "error",
						message: getErrorMessage(
							error,
							workspaceRef.current.locale,
						),
					})
				})

			return () => {
				cancelled = true
			}
		},
		[
			setIgnoreNotice,
			setProjectIgnoreFileExists,
			workspace.rootFolder,
		],
	)

	useEffect(
		() => {
			if (!active && ignoreDialogOpen)
				onIgnoreDialogOpenChangeRef.current(false)
		},
		[
			active,
			ignoreDialogOpen,
		],
	)

	const updateIgnorePaths = useCallback(
		async (
			paths: string[],
			ignorePaths: boolean,
			externalAction = false,
		): Promise<void> => {
			const rootFolder = workspaceRef.current.rootFolder

			if (rootFolder === null) {
				if (externalAction) {
					throw new Error(translate(
						workspaceRef.current.locale,
						"workspace.externalNoProject",
					))
				}

				return
			}

			if (paths.length === 0)
				return

			if (!ignoreDialogOpenRef.current) {
				const message = translate(
					workspaceRef.current.locale,
					"devIgnore.externalClosed",
				)

				setIgnoreNotice({
					kind: "warning",
					message,
				})

				if (externalAction)
					throw new Error(message)

				return
			}

			const uniquePaths = [...new Set(paths)]

			setIgnoreOperationPending(true)
			const operation = ignoreUpdateQueueRef.current
				.catch(() => undefined)
				.then(async () => {
					setIgnoreNotice(null)
					const result = await updateProjectIgnore(
						rootFolder,
						uniquePaths,
						ignorePaths,
					)

					setProjectIgnoreFileExists(
						rootFolder,
						true,
					)
					const currentLocale = workspaceRef.current.locale
					const outcome = projectIgnoreOutcomeFromResult(
						rootFolder,
						ignorePaths,
						result,
					)

					setIgnoreNotice(createOperationOutcomeNotice(
						currentLocale,
						outcome,
						ignorePaths ?
							"devIgnore.addedSummary" :
							"devIgnore.removedSummary",
					))
				})

			ignoreUpdateQueueRef.current = operation.catch(() => undefined)

			try {
				await operation
			} catch (error) {
				setIgnoreNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						workspaceRef.current.locale,
					),
				})

				if (externalAction)
					throw error
			} finally {
				setIgnoreOperationPending(false)
			}
		},
		[
			setIgnoreNotice,
			setIgnoreOperationPending,
			setProjectIgnoreFileExists,
		],
	)

	const updateIgnorePathsRef = useRef(updateIgnorePaths)

	useEffect(
		() => {
			updateIgnorePathsRef.current = updateIgnorePaths
		},
		[updateIgnorePaths],
	)

	const handleDevIgnore = useCallback(
		async (): Promise<void> => {
			const rootFolder = workspaceRef.current.rootFolder

			if (rootFolder === null || projectIgnoreFileExists === null)
				return

			setIgnoreOperationPending(true)
			setIgnoreNotice(null)

			try {
				const exists = await checkProjectIgnoreExists(rootFolder)

				setProjectIgnoreFileExists(
					rootFolder,
					exists,
				)

				if (exists) {
					onIgnoreDialogOpenChangeRef.current(true)
					return
				}

				await createProjectIgnore(rootFolder)
				setProjectIgnoreFileExists(
					rootFolder,
					true,
				)
				setIgnoreNotice({
					kind: "success",
					message: translate(
						workspaceRef.current.locale,
						"folder.devIgnore.created",
					),
				})
			} catch (error) {
				setIgnoreNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						workspaceRef.current.locale,
					),
				})
			} finally {
				setIgnoreOperationPending(false)
			}
		},
		[
			projectIgnoreFileExists,
			setIgnoreNotice,
			setIgnoreOperationPending,
			setProjectIgnoreFileExists,
		],
	)

	useEffect(
		() => {
			onRegister(
				tabId,
				{
					addExternalContext: async paths => {
						if (ignoreDialogOpenRef.current) {
							throw new Error(translate(
								workspaceRef.current.locale,
								"workspace.externalContextUnavailableInIgnore",
							))
						}
						if (contextModeRef.current !== "create") {
							throw new Error(translate(
								workspaceRef.current.locale,
								"workspace.externalContextUnavailableOutsideCreate",
							))
						}

						await workspaceRef.current.addDroppedPaths(
							paths,
							false,
							true,
						)
					},
					addExternalContextAndCopy: async paths => {
						if (ignoreDialogOpenRef.current) {
							throw new Error(translate(
								workspaceRef.current.locale,
								"workspace.externalContextCopyUnavailableInIgnore",
							))
						}
						if (contextModeRef.current !== "create") {
							throw new Error(translate(
								workspaceRef.current.locale,
								"workspace.externalContextUnavailableOutsideCreate",
							))
						}

						await workspaceRef.current.addDroppedPaths(
							paths,
							true,
							true,
						)
					},
					removeExternalContext: async paths => {
						if (ignoreDialogOpenRef.current) {
							throw new Error(translate(
								workspaceRef.current.locale,
								"workspace.externalContextUnavailableInIgnore",
							))
						}
						if (contextModeRef.current !== "create") {
							throw new Error(translate(
								workspaceRef.current.locale,
								"workspace.externalContextUnavailableOutsideCreate",
							))
						}

						await workspaceRef.current.removeDroppedPaths(
							paths,
							true,
						)
					},
					addExternalIgnore: paths => updateIgnorePathsRef.current(
						paths,
						true,
						true,
					),
					removeExternalIgnore: paths => updateIgnorePathsRef.current(
						paths,
						false,
						true,
					),
					openExternalRoot: path => {
						if (isUpdatingProjectIgnoreRef.current)
							return Promise.resolve(false)

						const currentWorkspace = workspaceRef.current

						return currentWorkspace.configureRootFolder(
							path,
							translate(
								currentWorkspace.locale,
								"workspace.openedExternally",
							),
						)
					},
					prepareForTabClose: async () => {
						if (isUpdatingProjectIgnoreRef.current)
							return false

						return workspaceRef.current.prepareForTabClose()
					},
					canAcceptRoutedApply: () => {
						const currentWorkspace = workspaceRef.current

						return currentWorkspace.rootFolder !== null &&
							!ignoreDialogOpenRef.current &&
							!isUpdatingProjectIgnoreRef.current &&
							currentWorkspace.isReady &&
							!currentWorkspace.isProcessing &&
							!currentWorkspace.isApplying &&
							!currentWorkspace.isGeneratingCommitContext &&
							!currentWorkspace.isGeneratingProjectContext &&
							currentWorkspace.diagnosticContextKind === null &&
							currentWorkspace.pendingOverlay === null &&
							currentWorkspace.pendingGitPatch === null
					},
					applyPreparedOverlay: (paths, candidate, sourceFingerprint, routingFingerprint, appendUndo) => workspaceRef.current.applyPreparedOverlay(
						paths,
						candidate,
						sourceFingerprint,
						routingFingerprint,
						appendUndo,
					),
					beginPreparedOverlayResolution: (paths, sourceLabel, plan, appendUndo) => workspaceRef.current.beginPreparedOverlayResolution(
						paths,
						sourceLabel,
						plan,
						appendUndo,
					),
					beginPreparedGitPatch: (patchPath, preview) => workspaceRef.current.beginPreparedGitPatch(
						patchPath,
						preview,
					),
					undoApplicationIfLatest: reference => workspaceRef.current.undoApplicationIfLatest(reference),
					cancelContextOperation: () => workspaceRef.current.cancelCancellableContextOperation(),
				},
			)

			return () => {
				onRegister(
					tabId,
					null,
				)
			}
		},
		[
			onRegister,
			tabId,
		],
	)

	useEffect(
		() => {
			if (!active)
				return

			let unlistenTauri: (() => void) | undefined
			let unlistenNative: (() => void) | undefined
			let cancelled = false
			let dragPosition: PhysicalPosition | null = null
			let autoScrollFrame: number | null = null

			function getDropTarget(position: PhysicalPosition): DropTarget | null {
				if (
					interactionBlocked ||
					routingBusy ||
					pendingOverlay !== null ||
					pendingGitPatch !== null
				)
					return null

				if (ignoreDialogOpen) {
					if (isUpdatingProjectIgnore)
						return null

					if (containsPhysicalPosition(
						ignoreAddDropZoneRef.current,
						position,
					))
						return "ignoreAdd"

					if (containsPhysicalPosition(
						ignoreRemoveDropZoneRef.current,
						position,
					))
						return "ignoreRemove"

					return null
				}

				if (
					contextAddDropEnabled &&
					containsPhysicalPosition(
						contextAddDropZoneRef.current,
						position,
					)
				)
					return "contextAdd"

				if (
					contextRemoveDropEnabled &&
					containsPhysicalPosition(
						contextRemoveDropZoneRef.current,
						position,
					)
				)
					return "contextRemove"

				if (
					applyDropEnabled &&
					containsPhysicalPosition(
						applyDropZoneRef.current,
						position,
					)
				)
					return "apply"

				return null
			}

			function stopAutoScroll(): void {
				dragPosition = null

				if (autoScrollFrame !== null) {
					window.cancelAnimationFrame(autoScrollFrame)
					autoScrollFrame = null
				}
			}

			function getAutoScrollContainer(): HTMLElement | null {
				return applyDropZoneRef.current?.closest<HTMLElement>(".orqeto-scroll-area") ?? null
			}

			function runAutoScroll(): void {
				autoScrollFrame = null

				if (dragPosition === null)
					return

				const scrollContainer = getAutoScrollContainer()

				if (scrollContainer === null)
					return

				const scrollStep = getDragAutoScrollStep(
					dragPosition,
					scrollContainer,
				)

				if (scrollStep === 0)
					return

				const previousScrollTop = scrollContainer.scrollTop
				scrollContainer.scrollTop += scrollStep
				setDragTarget(getDropTarget(dragPosition))

				if (scrollContainer.scrollTop !== previousScrollTop)
					autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
			}

			function updateAutoScroll(position: PhysicalPosition): void {
				if (
					interactionBlocked ||
					routingBusy ||
					pendingOverlay !== null ||
					pendingGitPatch !== null ||
					(!ignoreDialogOpen && !contextAddDropEnabled && !contextRemoveDropEnabled && !applyDropEnabled)
				) {
					stopAutoScroll()
					return
				}

				dragPosition = position

				if (autoScrollFrame === null)
					autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
			}

			function handleDrop(
				target: DropTarget | null,
				paths: string[],
				temporaryRoot: string | null,
			): void {
				if (target === "contextAdd") {
					void addDroppedPaths(paths)
						.finally(() => temporaryRoot === null ?
							undefined :
							cleanupNativeDrop(temporaryRoot)
								.catch(() => undefined))
					return
				}

				if (target === "contextRemove") {
					void removeDroppedPaths(paths)
						.finally(() => temporaryRoot === null ?
							undefined :
							cleanupNativeDrop(temporaryRoot)
								.catch(() => undefined))
					return
				}

				if (target === "ignoreAdd" || target === "ignoreRemove") {
					void updateIgnorePaths(
						paths,
						target === "ignoreAdd",
					)
						.finally(() => temporaryRoot === null ?
							undefined :
							cleanupNativeDrop(temporaryRoot)
								.catch(() => undefined))
					return
				}

				if (target === "apply") {
					onApplyDrop(
						tabId,
						paths,
						temporaryRoot,
					)
					return
				}

				if (temporaryRoot !== null)
					void cleanupNativeDrop(temporaryRoot)
			}

			function disposeListeners(): void {
				const tauriDisposer = unlistenTauri
				const nativeDisposer = unlistenNative
				unlistenTauri = undefined
				unlistenNative = undefined
				tauriDisposer?.()
				nativeDisposer?.()
			}

			async function subscribe(): Promise<void> {
				try {
					const tauriDisposer = await getCurrentWindow().onDragDropEvent(event => {
						if (event.payload.type === "leave") {
							stopAutoScroll()
							setDragTarget(null)
							return
						}

						const target = getDropTarget(event.payload.position)

						if (
							event.payload.type === "enter" ||
							event.payload.type === "over"
						) {
							updateAutoScroll(event.payload.position)
							setDragTarget(target)
							return
						}

						stopAutoScroll()
						setDragTarget(null)
						handleDrop(
							target,
							event.payload.paths,
							null,
						)
					})

					if (cancelled) {
						tauriDisposer()
						return
					}

					unlistenTauri = tauriDisposer
					const nativeDisposer = await listen<NativeDropPayload>(
						"native-drag-drop",
						event => {
							const payload = event.payload

							if (payload.type === "leave") {
								stopAutoScroll()
								setDragTarget(null)
								return
							}

							if (payload.position === undefined)
								return

							const target = getDropTarget(payload.position)

							if (
								payload.type === "enter" ||
								payload.type === "over"
							) {
								updateAutoScroll(payload.position)
								setDragTarget(target)
								return
							}

							stopAutoScroll()
							setDragTarget(null)
							handleDrop(
								target,
								payload.paths ?? [],
								payload.temporaryRoot ?? null,
							)
						},
					)

					if (cancelled) {
						nativeDisposer()
						return
					}

					unlistenNative = nativeDisposer
				} catch {
					disposeListeners()
					stopAutoScroll()
					setDragTarget(null)
				}
			}

			void subscribe()

			return () => {
				cancelled = true
				stopAutoScroll()
				disposeListeners()
			}
		},
		[
			active,
			addDroppedPaths,
			applyDropEnabled,
			contextAddDropEnabled,
			contextRemoveDropEnabled,
			interactionBlocked,
			routingBusy,
			ignoreDialogOpen,
			isUpdatingProjectIgnore,
			pendingGitPatch,
			pendingOverlay,
			removeDroppedPaths,
			updateIgnorePaths,
			onApplyDrop,
			tabId,
		],
	)

	const projectContextMetadata = contextMode === "project" ?
		isInspectingProjectContextForInteraction && workspace.fullProjectContextSummary === null ?
			translate(
				workspace.locale,
				"folder.projectContext.calculating",
			) :
			workspace.fullProjectContextSummary === null ?
				null :
				translateCount(
					workspace.locale,
					workspace.fullProjectContextSummary.fileCount,
					"context.summary.one",
					"context.summary.other",
					{
						size: formatByteSize(workspace.fullProjectContextSummary.byteCount),
					},
				) :
		null
	const preparedContextByteCount = contextMode === "commit" ?
		workspace.gitCommitContextByteCount :
		contextMode === "typecheck" ?
			workspace.diagnosticContextByteCounts.typecheck :
			contextMode === "eslint" ?
				workspace.diagnosticContextByteCounts.eslint :
				null
	const contextExportMetadata = projectContextMetadata ?? (preparedContextByteCount === null ?
		null :
		formatByteSize(preparedContextByteCount))
	const hasGenerateStep = contextMode === "commit"
	const generatedContextReady = contextMode === "project" ||
		(contextMode !== "create" && preparedContextByteCount !== null)
	const contextExportBusy = contextMode === "project" ?
		isGeneratingProjectContextForInteraction :
		contextMode === "commit" ?
			isGeneratingCommitContextForInteraction :
			contextMode === "typecheck" ?
				diagnosticContextKindForInteraction === "typecheck" :
				contextMode === "eslint" && diagnosticContextKindForInteraction === "eslint"
	const projectScope = contextMode === "create" ?
		"custom" :
		"full"
	const validationMode = contextMode === "eslint" ?
		"eslint" :
		"typecheck"

	function changeContextSectionMode(mode: ContextSectionMode): void {
		if (mode === "project") {
			if (contextMode !== "create" && contextMode !== "project")
				setRequestedContextMode("create")
			return
		}

		if (mode === "commit") {
			setRequestedContextMode("commit")
			return
		}

		if (contextMode === "typecheck" || contextMode === "eslint")
			return

		setRequestedContextMode(workspace.diagnosticCapabilities.typecheck ?
			"typecheck" :
			"eslint")
	}

	function generateSelectedContext(): void {
		if (contextMode === "commit")
			void workspace.generateGitCommitContextReport()
	}

	function generateValidation(kind: "typecheck" | "eslint"): void {
		setRequestedContextMode(kind)
		void workspace.generateDiagnosticContextReport(kind)
	}

	function copySelectedContext(): void {
		if (contextMode === "project") {
			void workspace.copyFullProjectContext()
			return
		}

		if (contextMode === "commit") {
			void workspace.copyGitCommitContext()
			return
		}

		if (contextMode === "typecheck") {
			void workspace.copyDiagnosticContext("typecheck")
			return
		}

		if (contextMode === "eslint")
			void workspace.copyDiagnosticContext("eslint")
	}

	function downloadSelectedContext(): void {
		if (contextMode === "project") {
			void workspace.downloadFullProjectContext()
			return
		}

		if (contextMode === "commit") {
			void workspace.downloadGitCommitContext()
			return
		}

		if (contextMode === "typecheck") {
			void workspace.downloadDiagnosticContext("typecheck")
			return
		}

		if (contextMode === "eslint")
			void workspace.downloadDiagnosticContext("eslint")
	}

	return (
		<div
			hidden={!active}
			className={styles.root}
			aria-busy={isTabBusy}
		>
			<div
				inert={isTabBusy}
				className={styles.content}
			>
				{ignoreNotice && (
					<Notice
						kind={ignoreNotice.kind}
						message={ignoreNotice.message}
						details={ignoreNotice.details}
					/>
				)}

				{workspace.notice && (
					<Notice
						kind={workspace.notice.kind}
						message={workspace.notice.message}
						details={workspace.notice.details}
					/>
				)}

				<section className={styles.workspaceCard}>
					<FolderSettings
						rootFolder={workspace.rootFolder}
						locale={workspace.locale}
						disabled={isInteractionBusy || routingBusy || interactionBlocked}
						isGitRepository={workspace.isGitRepository}
						hasTypecheckContext={workspace.diagnosticCapabilities.typecheck}
						hasEslintContext={workspace.diagnosticCapabilities.eslint}
						contextMode={contextMode}
						projectIgnoreExists={projectIgnoreFileExists}
						vscodeAvailable={vscodeAvailable}
						expanded={folderSectionExpanded}
						selectedAction={folderAction}
						onSelectedActionChange={onFolderActionChange}
						onExpandedChange={expanded => onSectionExpandedChange(
							"folder",
							expanded,
						)}
						onContextModeChange={changeContextSectionMode}
						onSelectFolder={() => void workspace.selectRootFolder()}
						onOpenFolder={() => void workspace.openConfiguredFolder()}
						onOpenVscode={() => void workspace.openConfiguredFolderInVscode()}
						onCloseFolder={() => void workspace.closeRootFolder()}
						onDevIgnore={() => void handleDevIgnore()}
					>
						{workspace.rootFolder !== null && (contextMode === "create" || contextMode === "project") && (
							<div className={styles.modeDetails}>
								<div className={styles.secondaryModeRow}>
									<span className={styles.secondaryModeLabel}>
										{translate(
											workspace.locale,
											"folder.projectScope.label",
										)}
									</span>
									<div
										className={styles.secondaryModeButtons}
										role="group"
										aria-label={translate(
											workspace.locale,
											"folder.projectScope.label",
										)}
									>
										<button
											type="button"
											aria-pressed={projectScope === "full"}
											className={styles.secondaryModeButton({ selected: projectScope === "full" })}
											disabled={isInteractionBusy || routingBusy || interactionBlocked}
											onClick={() => setRequestedContextMode("project")}
										>
											{translate(
												workspace.locale,
												"folder.projectScope.full",
											)}
										</button>
										<button
											type="button"
											aria-pressed={projectScope === "custom"}
											className={styles.secondaryModeButton({ selected: projectScope === "custom" })}
											disabled={isInteractionBusy || routingBusy || interactionBlocked}
											onClick={() => setRequestedContextMode("create")}
										>
											{translate(
												workspace.locale,
												"folder.projectScope.custom",
											)}
										</button>
									</div>
								</div>

								<DropZone
									addElementRef={contextAddDropZoneRef}
									removeElementRef={contextRemoveDropZoneRef}
									addEnabled={contextAddDropEnabled}
									removeEnabled={contextRemoveDropEnabled}
									isAddDragging={visibleDragTarget === "contextAdd"}
									isRemoveDragging={visibleDragTarget === "contextRemove"}
									isProcessing={isProcessingForInteraction}
									locale={workspace.locale}
									filterPattern={workspace.contextPathFilter}
									filterTarget={workspace.contextFilterTarget}
									filterMode={workspace.contextFilterMode}
									filterError={workspace.contextPathFilterError}
									filterHistory={workspace.contextFilterHistory}
									pathsOnly={workspace.pathsOnly}
									detailsExpanded={contextSectionExpanded}
									embedded
									showDropTargets={contextMode === "create"}
									showFilters={folderSectionExpanded}
									onFilterPatternChange={workspace.updateContextPathFilter}
									onFilterTargetChange={workspace.updateContextFilterTarget}
									onFilterModeChange={workspace.updateContextFilterMode}
									onFilterClear={workspace.clearContextFilter}
									onPathsOnlyChange={workspace.updatePathsOnly}
									onFilterHistorySelect={workspace.selectContextFilterHistory}
									onFilterHistoryDelete={entry => void workspace.deleteContextFilterHistory(entry)}
									onDetailsExpandedChange={() => undefined}
								/>

								{contextMode === "create" ?
									(
										<ContentSummary
											files={workspace.files}
											contentSize={workspace.generatedContentSize}
											liveContent={!workspace.pathsOnly}
											history={workspace.contextHistory}
											locale={workspace.locale}
											disabled={isInteractionBusy || routingBusy || interactionBlocked}
											onCopy={() => void workspace.copyGeneratedContent()}
											onDownload={() => void workspace.downloadGeneratedContent()}
											onClear={() => void workspace.clearGeneratedContent()}
											onHistoryCopy={entry => void workspace.copyContextHistory(entry)}
											onHistoryDownload={entry => void workspace.downloadContextHistory(entry)}
											onHistoryDelete={entry => void workspace.deleteContextHistory(entry)}
										/>
									) :
									(
										<ContextExportActions
											locale={workspace.locale}
											metadata={contextExportMetadata}
											busy={contextExportBusy}
											disabled={isInteractionBusy || routingBusy || interactionBlocked || workspace.contextPathFilterError !== null}
											generated={generatedContextReady}
											onCopy={copySelectedContext}
											onDownload={downloadSelectedContext}
										/>
									)}
							</div>
						)}

						{workspace.rootFolder !== null && contextMode === "commit" && (
							<ContextExportActions
								locale={workspace.locale}
								metadata={contextExportMetadata}
								busy={contextExportBusy}
								disabled={isInteractionBusy || routingBusy || interactionBlocked}
								generated={generatedContextReady}
								onGenerate={hasGenerateStep ?
									generateSelectedContext :
									undefined}
								onCopy={copySelectedContext}
								onDownload={downloadSelectedContext}
							/>
						)}

						{workspace.rootFolder !== null && (contextMode === "typecheck" || contextMode === "eslint") && (
							<div className={styles.modeDetails}>
								<div className={styles.secondaryModeRow}>
									<span className={styles.secondaryModeLabel}>
										{translate(
											workspace.locale,
											"folder.validation.label",
										)}
									</span>
									<div className={styles.secondaryModeButtons}>
										{workspace.diagnosticCapabilities.typecheck && (
											<button
												type="button"
												aria-pressed={validationMode === "typecheck"}
												className={styles.secondaryModeButton({ selected: validationMode === "typecheck" })}
												disabled={isInteractionBusy || routingBusy || interactionBlocked}
												onClick={() => generateValidation("typecheck")}
											>
												{translate(
													workspace.locale,
													"folder.contextMode.typecheck",
												)}
											</button>
										)}
										{workspace.diagnosticCapabilities.eslint && (
											<button
												type="button"
												aria-pressed={validationMode === "eslint"}
												className={styles.secondaryModeButton({ selected: validationMode === "eslint" })}
												disabled={isInteractionBusy || routingBusy || interactionBlocked}
												onClick={() => generateValidation("eslint")}
											>
												{translate(
													workspace.locale,
													"folder.contextMode.eslint",
												)}
											</button>
										)}
									</div>
								</div>

								<ContextExportActions
									locale={workspace.locale}
									metadata={contextExportMetadata}
									busy={contextExportBusy}
									disabled={isInteractionBusy || routingBusy || interactionBlocked}
									generated={generatedContextReady}
									onCopy={copySelectedContext}
									onDownload={downloadSelectedContext}
								/>
							</div>
						)}
					</FolderSettings>
				</section>

				<ApplyDropZone
					elementRef={applyDropZoneRef}
					enabled={applyDropEnabled}
					undoEnabled={undoEnabled}
					isDragging={visibleDragTarget === "apply"}
					isApplying={workspace.isApplying}
					undoHistory={pendingOverlay === null && pendingGitPatch === null ?
						workspace.overlayUndoHistory :
						[]}
					locale={workspace.locale}
					workMode={workspace.workMode}
					detailsExpanded={applySectionExpanded}
					onDetailsExpandedChange={expanded => onSectionExpandedChange(
						"apply",
						expanded,
					)}
					onUndo={steps => void workspace.undoOverlay(steps)}
				/>

				{active && ignoreDialogOpen && workspace.rootFolder !== null && (
					<DevIgnoreDialog
						addElementRef={ignoreAddDropZoneRef}
						removeElementRef={ignoreRemoveDropZoneRef}
						isAddDragging={visibleDragTarget === "ignoreAdd"}
						isRemoveDragging={visibleDragTarget === "ignoreRemove"}
						disabled={isUpdatingProjectIgnore}
						locale={workspace.locale}
						onClose={() => onIgnoreDialogOpenChange(false)}
					/>
				)}

			</div>

			{active && pendingGitPatch !== null && (
				<GitPatchPreviewDialog
					key={`${pendingGitPatch.patchFingerprint}:${pendingGitPatch.patchName}`}
					pendingPatch={pendingGitPatch}
					disabled={workspace.isApplying}
					locale={workspace.locale}
					onCancel={workspace.cancelPendingGitPatch}
					onConfirm={() => void workspace.confirmPendingGitPatch()}
				/>
			)}

			{active && pendingOverlay !== null && (
				<OverlayDestinationDialog
					key={`${pendingOverlay.queuePosition}:${pendingOverlay.paths.join("|")}`}
					pendingOverlay={pendingOverlay}
					disabled={workspace.isApplying}
					locale={workspace.locale}
					onCancel={workspace.cancelPendingOverlay}
					onConfirm={candidate => void workspace.confirmPendingOverlay(candidate)}
				/>
			)}

			{!suppressLoadingOverlay && (
				<LoadingOverlay
					active={isTabBusy}
					scope="container"
					label={translate(
						workspace.locale,
						"app.loading",
					)}
					cancelLabel={translate(
						workspace.locale,
						"app.loading.cancel",
					)}
					onCancel={canCancelTabOperation ?
						workspace.cancelCancellableContextOperation :
						undefined}
				/>
			)}
		</div>
	)
}
