import { styles } from "./style"
import {
	type ProjectApplyChoice,
	ProjectApplyDialog,
} from "@/features/context/components/ProjectApplyDialog"
import { ProjectTabs } from "@/features/context/components/ProjectTabs"
import {
	type ProjectWorkspaceHandle,
	ProjectWorkspacePane,
} from "@/features/context/components/ProjectWorkspacePane"
import { SettingsDrawer } from "@/features/context/components/SettingsDrawer"
import {
	type FileRoutingProjectEvidence,
	selectUniqueCompleteExactRootFileRoutingProject,
	selectUniqueStrongFileRoutingProject,
} from "@/features/context/fileRoutingConfidence"
import {
	getRoutedApplyMessageKey,
	type OperationUndoReference,
	type RoutedApplyState,
} from "@/features/context/operationOutcome"
import type {
	AppNotice,
	ContextMode,
	GitPatchPreview,
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
	ProjectSection,
	ProjectTab,
	WorkMode,
} from "@/features/context/types"
import { useAppSettings } from "@/features/context/useAppSettings"
import type {
	ContextWorkspacePreferences,
	PreparedApplyOutcome,
} from "@/features/context/useContextWorkspace"
import {
	getErrorMessage,
	isGitPatchPath,
} from "@/features/context/utils"
import {
	deleteProjectTab,
	flushProjectTabWrites,
	getActiveProjectTabId,
	getProjectTabs,
	saveProjectTabOrder,
	setActiveProjectTabId,
	upsertProjectTab,
} from "@/infra/configDatabase"
import {
	ackExternalAction,
	cleanupNativeDrop,
	closeFolderInExplorer,
	destroyMainWindow,
	discardProjectOverlayUndo,
	findProjectForPaths,
	findProjectForRoot,
	folderExists,
	getOverlayRecoveryStatus,
	isVscodeAvailable,
	nextExternalAction,
	openFolderInExplorer,
	prepareGitPatch,
	prepareProjectOverlay,
	setExternalIntegrationState,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { BootLoadingOverlayCleanup } from "@/shared/components/BootLoadingOverlayCleanup"
import { Notice } from "@/shared/components/Notice"
import OverlayScrollbarManager from "@/shared/components/OverlayScrollbarManager"
import { getVersion } from "@tauri-apps/api/app"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Settings } from "lucide-react"
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"

const EXTERNAL_ACTIONS_PENDING_EVENT = "external-actions-pending"

type PendingExternalSelectionAction = {
	type: "add" | "addAndCopy" | "remove"
	target: "context" | "ignore"
	paths: string[]
}

interface FileProjectAnalysis {
	tab: ProjectTab & { rootFolder: string }
	plan: PrepareProjectOverlayResult
	concreteCandidates: OverlayDestinationCandidate[]
	concreteCount: number
	available: boolean
}

interface GitProjectAnalysis {
	tab: ProjectTab & { rootFolder: string }
	preview: GitPatchPreview
	available: boolean
}

type ProjectApplySelection = | {
	type: "project"
	tabId: string
} | {
	type: "root"
} | {
	type: "cancel"
}

interface PendingProjectApplySelection {
	mode: WorkMode
	sourceLabel: string
	projects: ProjectApplyChoice[]
	allowCurrentRoot: boolean
	currentProjectName: string
}

type RoutedApplyNoticeKind = RoutedApplyState

interface RoutedApplyNotice {
	kind: RoutedApplyNoticeKind
	projectName: string
	tabId: string
	undoReference: OperationUndoReference | null
}

function getProjectName(rootFolder: string | null): string {
	if (rootFolder === null)
		return ""

	const normalized = rootFolder
		.replaceAll("\\", "/")
		.replace(/\/$/, "")
	const name = normalized.split("/").filter(Boolean).at(-1)

	return name ?? rootFolder
}

function getSourceLabel(path: string): string {
	const normalized = path
		.replaceAll("\\", "/")
		.replace(/\/$/, "")
	const parts = normalized.split("/").filter(Boolean)

	return parts.at(-1) ?? path
}

function isRootFallbackOnlyCandidate(candidate: OverlayDestinationCandidate): boolean {
	return candidate.destinationRelativePath === "./" &&
		candidate.matchedFiles === 0 &&
		candidate.matchedDirectories === 0 &&
		candidate.sourceContextMatches === 0
}

function getConcreteOverlayCandidates(plan: PrepareProjectOverlayResult): OverlayDestinationCandidate[] {
	if (plan.recommendedCandidateIndex !== null) {
		const recommendedCandidate = plan.candidates[plan.recommendedCandidateIndex]

		if (recommendedCandidate !== undefined)
			return [recommendedCandidate]
	}

	return plan.candidates.filter(candidate => !isRootFallbackOnlyCandidate(candidate))
}

function getConcreteOverlayCount(
	plan: PrepareProjectOverlayResult,
	concreteCandidates: readonly OverlayDestinationCandidate[],
): number {
	if (plan.ambiguityLimitExceeded) {
		return Math.max(
			2,
			plan.candidateCount,
		)
	}

	return concreteCandidates.length
}

function isSameOverlayCandidate(
	left: OverlayDestinationCandidate,
	right: OverlayDestinationCandidate,
): boolean {
	return left.destinationRelativePath === right.destinationRelativePath &&
		left.sourcePrefix === right.sourcePrefix
}

function withOnlyOverlayCandidates(
	plan: PrepareProjectOverlayResult,
	candidates: OverlayDestinationCandidate[],
): PrepareProjectOverlayResult {
	return {
		...plan,
		candidates,
		candidateCount: candidates.length,
		ambiguityLimitExceeded: false,
		recommendedCandidateIndex: candidates.length === 1 ?
			0 :
			null,
	}
}

function createProjectTab(rootFolder: string | null = null): ProjectTab {
	return {
		id: `tab-${crypto.randomUUID()}`,
		rootFolder,
		folderSectionExpanded: true,
		contextSectionExpanded: true,
		applySectionExpanded: true,
	}
}

async function mapFilesystemHeavySerially<Item, Result>(
	items: readonly Item[],
	mapper: (item: Item) => Promise<Result>,
): Promise<Result[]> {
	const results: Result[] = []

	for (const item of items)
		results.push(await mapper(item))

	return results
}

function moveTabToInsertionPosition(
	tabs: readonly ProjectTab[],
	sourceId: string,
	insertionIndex: number,
): ProjectTab[] {
	const sourceIndex = tabs.findIndex(tab => tab.id === sourceId)

	if (sourceIndex < 0)
		return [...tabs]

	const nextTabs = [...tabs]
	const [source] = nextTabs.splice(
		sourceIndex,
		1,
	)

	if (source === undefined)
		return [...tabs]

	const boundedIndex = Math.max(
		0,
		Math.min(
			insertionIndex,
			nextTabs.length,
		),
	)

	nextTabs.splice(
		boundedIndex,
		0,
		source,
	)

	return nextTabs
}

export function App() {
	const appSettings = useAppSettings()
	const [tabs, setTabs] = useState<ProjectTab[]>([])
	const [activeTabId, setActiveTabId] = useState("")
	const [tabsReady, setTabsReady] = useState(false)
	const [isSettingsOpen, setIsSettingsOpen] = useState(false)
	const [globalNotice, setGlobalNotice] = useState<AppNotice | null>(null)
	const [appVersion, setAppVersion] = useState("")
	const [lastRootFolder, setLastRootFolder] = useState<string | null>(null)
	const [pendingProjectApplySelection, setPendingProjectApplySelection] = useState<PendingProjectApplySelection | null>(null)
	const [routedApplyNotice, setRoutedApplyNotice] = useState<RoutedApplyNotice | null>(null)
	const [isRoutingApply, setIsRoutingApply] = useState(false)
	const [ignoreDialogTabId, setIgnoreDialogTabId] = useState<string | null>(null)
	const [workspaceContextModes, setWorkspaceContextModes] = useState<Record<string, ContextMode>>({})
	const [isSettingsOperationBusy, setIsSettingsOperationBusy] = useState(false)
	const [routingApplyTabId, setRoutingApplyTabId] = useState<string | null>(null)
	const [vscodeAvailable, setVscodeAvailable] = useState(false)
	const tabsRef = useRef<ProjectTab[]>([])
	const activeTabIdRef = useRef("")
	const workspaceHandlesRef = useRef(new Map<string, ProjectWorkspaceHandle>())
	const pendingExternalSelectionActionsRef = useRef(new Map<string, PendingExternalSelectionAction[]>())
	const ignoreDialogTabIdRef = useRef<string | null>(null)
	const initializationStartedRef = useRef(false)
	const processingExternalActionsRef = useRef(false)
	const externalActionsRequestedRef = useRef(false)
	const isClosingAppRef = useRef(false)
	const rootChangeRevisionsRef = useRef(new Map<string, number>())
	const tabOrderSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
	const activeTabSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
	const projectApplySelectionResolverRef = useRef<((selection: ProjectApplySelection) => void) | null>(null)
	const isRoutingApplyRef = useRef(false)
	const externalIntegrationWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

	useEffect(
		() => {
			let cancelled = false

			void getVersion()
				.then(version => {
					if (!cancelled)
						setAppVersion(version)
				})
				.catch(() => {
					if (!cancelled)
						setAppVersion("")
				})

			return () => {
				cancelled = true
			}
		},
		[],
	)

	useEffect(
		() => {
			let cancelled = false

			async function refreshVscodeAvailability(): Promise<void> {
				try {
					const available = await isVscodeAvailable()

					if (!cancelled)
						setVscodeAvailable(available)
				} catch {
					if (!cancelled)
						setVscodeAvailable(false)
				}
			}

			function handleWindowFocus(): void {
				void refreshVscodeAvailability()
			}

			void refreshVscodeAvailability()
			window.addEventListener(
				"focus",
				handleWindowFocus,
			)

			return () => {
				cancelled = true
				window.removeEventListener(
					"focus",
					handleWindowFocus,
				)
			}
		},
		[],
	)

	useEffect(
		() => {
			if (!appSettings.isReady)
				return

			let cancelled = false
			void getOverlayRecoveryStatus()
				.then(status => {
					if (!cancelled && status.blocked) {
						setGlobalNotice({
							kind: "error",
							message: translate(
								appSettings.locale,
								"app.recoveryBlocked",
							),
						})
					}
				})
				.catch(error => {
					if (!cancelled) {
						setGlobalNotice({
							kind: "error",
							message: getErrorMessage(
								error,
								appSettings.locale,
							),
						})
					}
				})

			return () => {
				cancelled = true
			}
		},
		[
			appSettings.isReady,
			appSettings.locale,
		],
	)

	const preferences = useMemo<ContextWorkspacePreferences>(
		() => ({
			locale: appSettings.locale,
			theme: appSettings.theme,
			workMode: appSettings.workMode,
			autoCopyContextAfterAdd: appSettings.autoCopyContextAfterAdd,
			autoClearAfterExport: appSettings.autoClearAfterExport,
			contextFilterHistoryLimit: appSettings.contextFilterHistoryLimit,
			contextHistoryLimit: appSettings.contextHistoryLimit,
			overlayUndoHistoryLimit: appSettings.overlayUndoHistoryLimit,
			diagnosticFileLimit: appSettings.diagnosticFileLimit,
			openExplorerOnAppStart: appSettings.openExplorerOnAppStart,
			openExplorerOnProjectOpen: appSettings.openExplorerOnProjectOpen,
			closeExplorerOnFolderClose: appSettings.closeExplorerOnFolderClose,
			closeExplorerOnAppExit: appSettings.closeExplorerOnAppExit,
			hideOpenProjectSubfolders: appSettings.hideOpenProjectSubfolders,
		}),
		[
			appSettings.autoClearAfterExport,
			appSettings.autoCopyContextAfterAdd,
			appSettings.closeExplorerOnAppExit,
			appSettings.closeExplorerOnFolderClose,
			appSettings.contextFilterHistoryLimit,
			appSettings.contextHistoryLimit,
			appSettings.hideOpenProjectSubfolders,
			appSettings.locale,
			appSettings.theme,
			appSettings.workMode,
			appSettings.openExplorerOnAppStart,
			appSettings.openExplorerOnProjectOpen,
			appSettings.overlayUndoHistoryLimit,
			appSettings.diagnosticFileLimit,
		],
	)

	const updateTabsState = useCallback(
		(nextTabs: ProjectTab[]) => {
			tabsRef.current = nextTabs
			setTabs(nextTabs)
		},
		[],
	)

	const updateActiveTabState = useCallback(
		(id: string) => {
			activeTabIdRef.current = id
			setActiveTabId(id)

			const rootFolder = tabsRef.current.find(tab => tab.id === id)?.rootFolder

			if (rootFolder)
				setLastRootFolder(rootFolder)
		},
		[],
	)

	const updateIgnoreDialogState = useCallback(
		(
			tabId: string,
			open: boolean,
		) => {
			const nextTabId = open ?
				tabId :
				ignoreDialogTabIdRef.current === tabId ?
					null :
					ignoreDialogTabIdRef.current

			ignoreDialogTabIdRef.current = nextTabId
			setIgnoreDialogTabId(nextTabId)
		},
		[],
	)

	const persistActiveTab = useCallback(
		async (id: string): Promise<void> => {
			updateActiveTabState(id)

			const operation = activeTabSaveQueueRef.current
				.catch(() => undefined)
				.then(() => setActiveProjectTabId(id))
			activeTabSaveQueueRef.current = operation.catch(() => undefined)

			try {
				await operation
			} catch (error) {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			}
		},
		[
			appSettings.locale,
			updateActiveTabState,
		],
	)

	const persistTabOrder = useCallback(
		async (ids: string[]): Promise<void> => {
			const operation = tabOrderSaveQueueRef.current
				.catch(() => undefined)
				.then(() => saveProjectTabOrder(ids))
			tabOrderSaveQueueRef.current = operation.catch(() => undefined)
			await operation
		},
		[],
	)

	const handleSectionExpandedChange = useCallback(
		async (
			section: ProjectSection,
			expanded: boolean,
		): Promise<void> => {
			if (section === "folder") {
				await appSettings.updateFolderSectionExpanded(expanded)
				return
			}

			if (section === "context") {
				await appSettings.updateContextSectionExpanded(expanded)
				return
			}

			await appSettings.updateApplySectionExpanded(expanded)
		},
		[appSettings],
	)

	const handleRootFolderChange = useCallback(
		async (
			tabId: string,
			rootFolder: string | null,
		): Promise<boolean> => {
			const revision = (rootChangeRevisionsRef.current.get(tabId) ?? 0) + 1
			rootChangeRevisionsRef.current.set(
				tabId,
				revision,
			)
			const isCurrentRevision = (): boolean =>
				rootChangeRevisionsRef.current.get(tabId) === revision
			const currentTabs = tabsRef.current
			const tabIndex = currentTabs.findIndex(tab => tab.id === tabId)
			const currentTab = currentTabs[tabIndex]

			if (currentTab === undefined)
				return false

			if (ignoreDialogTabIdRef.current === tabId) {
				updateIgnoreDialogState(
					tabId,
					false,
				)
			}

			try {
				if (rootFolder !== null) {
					const otherTabs = currentTabs.filter(tab =>
						tab.id !== tabId && tab.rootFolder !== null)
					const otherRoots = otherTabs.flatMap(tab =>
						tab.rootFolder === null ?
							[] :
							[tab.rootFolder])
					const existingIndex = otherRoots.length === 0 ?
						null :
						await findProjectForRoot(
							otherRoots,
							rootFolder,
						)

					if (!isCurrentRevision())
						return false

					if (existingIndex !== null) {
						const existingTab = otherTabs[existingIndex]

						if (existingTab !== undefined)
							await persistActiveTab(existingTab.id)

						setGlobalNotice({
							kind: "info",
							message: translate(
								appSettings.locale,
								"workspace.projectAlreadyOpen",
							),
						})
						return false
					}
				}

				const nextTab: ProjectTab = {
					...currentTab,
					rootFolder,
				}

				if (!isCurrentRevision())
					return false

				await upsertProjectTab(
					nextTab,
					tabIndex,
				)

				if (!isCurrentRevision())
					return false

				const latestTabs = tabsRef.current
				const nextTabs = latestTabs.map(tab =>
					tab.id === tabId ?
						nextTab :
						tab)

				updateTabsState(nextTabs)

				if (rootFolder !== null)
					setLastRootFolder(rootFolder)

				setGlobalNotice(null)
				return true
			} catch (error) {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
				return false
			}
		},
		[
			appSettings.locale,
			persistActiveTab,
			updateIgnoreDialogState,
			updateTabsState,
		],
	)

	const registerWorkspace = useCallback(
		(
			tabId: string,
			handle: ProjectWorkspaceHandle | null,
		) => {
			if (handle === null) {
				workspaceHandlesRef.current.delete(tabId)
				return
			}

			workspaceHandlesRef.current.set(
				tabId,
				handle,
			)

			const pending = pendingExternalSelectionActionsRef.current.get(tabId)

			if (pending === undefined)
				return

			pendingExternalSelectionActionsRef.current.delete(tabId)
			void (async () => {
				for (const action of pending) {
					try {
						if (action.target === "ignore") {
							if (action.type === "add")
								await handle.addExternalIgnore(action.paths)
							else
								await handle.removeExternalIgnore(action.paths)

							continue
						}

						if (action.type === "add")
							await handle.addExternalContext(action.paths)
						else if (action.type === "addAndCopy")
							await handle.addExternalContextAndCopy(action.paths)
						else
							await handle.removeExternalContext(action.paths)
					} catch (error) {
						setGlobalNotice({
							kind: "error",
							message: getErrorMessage(
								error,
								appSettings.locale,
							),
						})
					}
				}
			})()
		},
		[appSettings.locale],
	)

	const addTab = useCallback(
		async () => {
			const currentTabs = tabsRef.current
			const nextTab = createProjectTab()

			try {
				await upsertProjectTab(
					nextTab,
					currentTabs.length,
				)
				const latestTabs = tabsRef.current
				if (!latestTabs.some(tab => tab.id === nextTab.id)) {
					const nextTabs = [
						...latestTabs,
						nextTab,
					]
					updateTabsState(nextTabs)
					await persistTabOrder(nextTabs.map(tab => tab.id))
				}
				await persistActiveTab(nextTab.id)
				setGlobalNotice(null)
			} catch (error) {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			}
		},
		[
			appSettings.locale,
			persistActiveTab,
			persistTabOrder,
			updateTabsState,
		],
	)

	const closeTab = useCallback(
		async (tabId: string) => {
			const currentTabs = tabsRef.current

			if (currentTabs.length <= 1)
				return

			const tabIndex = currentTabs.findIndex(tab => tab.id === tabId)
			const tab = currentTabs[tabIndex]

			if (tab === undefined)
				return

			const handle = workspaceHandlesRef.current.get(tabId)

			if (handle !== undefined && !await handle.prepareForTabClose()) {
				setGlobalNotice({
					kind: "info",
					message: translate(
						appSettings.locale,
						"workspace.tabBusy",
					),
				})
				return
			}

			rootChangeRevisionsRef.current.set(
				tabId,
				(rootChangeRevisionsRef.current.get(tabId) ?? 0) + 1,
			)

			try {
				await deleteProjectTab(tabId)

				if (tab.rootFolder !== null) {
					if (appSettings.closeExplorerOnFolderClose) {
						await closeFolderInExplorer(tab.rootFolder)
							.catch(() => undefined)
					}

					await discardProjectOverlayUndo(tab.rootFolder)
						.catch(() => undefined)
				}

				workspaceHandlesRef.current.delete(tabId)
				pendingExternalSelectionActionsRef.current.delete(tabId)
				rootChangeRevisionsRef.current.delete(tabId)

				if (ignoreDialogTabIdRef.current === tabId) {
					updateIgnoreDialogState(
						tabId,
						false,
					)
				}

				const latestTabs = tabsRef.current
				const latestTabIndex = latestTabs.findIndex(current => current.id === tabId)
				const nextTabs = latestTabs.filter(current => current.id !== tabId)
				updateTabsState(nextTabs)
				await persistTabOrder(nextTabs.map(current => current.id))

				if (activeTabIdRef.current === tabId) {
					const currentTabsAfterPersistence = tabsRef.current
					const nextActiveTab = currentTabsAfterPersistence[Math.min(
						Math.max(
							0,
							latestTabIndex,
						),
						currentTabsAfterPersistence.length - 1,
					)]

					if (
						nextActiveTab !== undefined &&
						activeTabIdRef.current === tabId
					)
						await persistActiveTab(nextActiveTab.id)
				}
			} catch (error) {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			}
		},
		[
			appSettings.closeExplorerOnFolderClose,
			appSettings.locale,
			persistActiveTab,
			persistTabOrder,
			updateIgnoreDialogState,
			updateTabsState,
		],
	)

	const moveTab = useCallback(
		async (
			sourceId: string,
			insertionIndex: number,
		) => {
			const previousTabs = tabsRef.current
			const nextTabs = moveTabToInsertionPosition(
				previousTabs,
				sourceId,
				insertionIndex,
			)

			if (nextTabs.every((
				tab,
				index,
			) => tab.id === previousTabs[index]?.id))
				return

			updateTabsState(nextTabs)

			try {
				await persistTabOrder(nextTabs.map(tab => tab.id))
			} catch (error) {
				const latestTabs = tabsRef.current
				const stillMatchesFailedOrder = latestTabs.length === nextTabs.length &&
					latestTabs.every((
						tab,
						index,
					) => tab.id === nextTabs[index]?.id)
				if (stillMatchesFailedOrder)
					updateTabsState([...previousTabs])
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			}
		},
		[
			appSettings.locale,
			persistTabOrder,
			updateTabsState,
		],
	)

	const openExternalRoot = useCallback(
		async (path: string): Promise<void> => {
			if (!await folderExists(path)) {
				setGlobalNotice({
					kind: "error",
					message: translate(
						appSettings.locale,
						"workspace.requestedRootUnavailable",
					),
				})
				return
			}

			const currentTabs = tabsRef.current
			const rootedTabs = currentTabs.filter((tab): tab is ProjectTab & { rootFolder: string } =>
				tab.rootFolder !== null)
			const roots = rootedTabs.flatMap(tab =>
				tab.rootFolder === null ?
					[] :
					[tab.rootFolder])
			const matchingIndex = roots.length === 0 ?
				null :
				await findProjectForRoot(
					roots,
					path,
				)

			if (matchingIndex !== null) {
				const matchingTab = rootedTabs[matchingIndex]

				if (matchingTab === undefined)
					return

				await persistActiveTab(matchingTab.id)
				setGlobalNotice(null)

				if (
					appSettings.openExplorerOnProjectOpen &&
					matchingTab.rootFolder !== null
				)
					await openFolderInExplorer(matchingTab.rootFolder)

				return
			}

			if (
				appSettings.hideOpenProjectSubfolders &&
				roots.length > 0
			) {
				const parentIndex = await findProjectForPaths(
					roots,
					[path],
				)

				if (parentIndex !== null) {
					const parentTab = rootedTabs[parentIndex]

					if (parentTab !== undefined) {
						await persistActiveTab(parentTab.id)
						setGlobalNotice(null)

						if (appSettings.openExplorerOnProjectOpen)
							await openFolderInExplorer(parentTab.rootFolder)

						return
					}
				}
			}

			const activeTab = currentTabs.find(tab => tab.id === activeTabIdRef.current)
			const blankTab = activeTab?.rootFolder === null ?
				activeTab :
				currentTabs.find(tab => tab.rootFolder === null)

			if (blankTab !== undefined) {
				await persistActiveTab(blankTab.id)
				const handle = workspaceHandlesRef.current.get(blankTab.id)

				if (handle !== undefined) {
					if (await handle.openExternalRoot(path))
						setGlobalNotice(null)

					return
				}

				if (await handleRootFolderChange(
					blankTab.id,
					path,
				)) {
					setGlobalNotice(null)

					if (appSettings.openExplorerOnProjectOpen)
						await openFolderInExplorer(path)
				}

				return
			}

			const nextTab = createProjectTab(path)

			await upsertProjectTab(
				nextTab,
				currentTabs.length,
			)
			const latestTabs = tabsRef.current
			const nextTabs = latestTabs.some(tab => tab.id === nextTab.id) ?
				latestTabs :
				[
					...latestTabs,
					nextTab,
				]
			updateTabsState(nextTabs)
			await persistTabOrder(nextTabs.map(tab => tab.id))
			await persistActiveTab(nextTab.id)
			setGlobalNotice(null)

			if (appSettings.openExplorerOnProjectOpen)
				await openFolderInExplorer(path)
		},
		[
			appSettings.hideOpenProjectSubfolders,
			appSettings.locale,
			appSettings.openExplorerOnProjectOpen,
			handleRootFolderChange,
			persistActiveTab,
			persistTabOrder,
			updateTabsState,
		],
	)

	const updateWorkspaceContextMode = useCallback(
		(
			tabId: string,
			mode: ContextMode,
		): void => {
			setWorkspaceContextModes(current => current[tabId] === mode ?
				current :
				{
					...current,
					[tabId]: mode,
				})
		},
		[],
	)

	const routeExternalSelectionAction = useCallback(
		async (
			paths: string[],
			type: PendingExternalSelectionAction["type"],
		): Promise<void> => {
			const rootedTabs = tabsRef.current.filter(tab => tab.rootFolder !== null)
			const roots = rootedTabs.flatMap(tab =>
				tab.rootFolder === null ?
					[] :
					[tab.rootFolder])
			const matchingIndex = roots.length === 0 ?
				null :
				await findProjectForPaths(
					roots,
					paths,
				)

			if (matchingIndex === null) {
				setGlobalNotice({
					kind: "warning",
					message: translate(
						appSettings.locale,
						"workspace.externalNoProject",
					),
				})
				return
			}

			const matchingTab = rootedTabs[matchingIndex]

			if (matchingTab === undefined)
				return

			const openIgnoreTabId = ignoreDialogTabIdRef.current

			if (type === "addAndCopy" && openIgnoreTabId === matchingTab.id) {
				setGlobalNotice({
					kind: "warning",
					message: translate(
						appSettings.locale,
						"workspace.externalContextCopyUnavailableInIgnore",
					),
				})
				return
			}

			const target: PendingExternalSelectionAction["target"] = openIgnoreTabId === matchingTab.id ?
				"ignore" :
				"context"

			if (
				target === "context" &&
				workspaceContextModes[matchingTab.id] !== "create"
			) {
				setGlobalNotice({
					kind: "warning",
					message: translate(
						appSettings.locale,
						"workspace.externalContextUnavailableOutsideCreate",
					),
				})
				return
			}

			// Keep an Ignore dialog that belongs to another project open. External
			// context actions can be processed by the mounted workspace in the
			// background without changing which project is in Ignore mode.
			if (openIgnoreTabId === null || openIgnoreTabId === matchingTab.id)
				await persistActiveTab(matchingTab.id)

			setGlobalNotice(null)
			const handle = workspaceHandlesRef.current.get(matchingTab.id)

			if (handle !== undefined) {
				if (target === "ignore") {
					if (type === "add")
						await handle.addExternalIgnore(paths)
					else
						await handle.removeExternalIgnore(paths)

					return
				}

				if (type === "add")
					await handle.addExternalContext(paths)
				else if (type === "addAndCopy")
					await handle.addExternalContextAndCopy(paths)
				else
					await handle.removeExternalContext(paths)

				return
			}

			const pending = pendingExternalSelectionActionsRef.current.get(matchingTab.id) ?? []

			pending.push({
				type,
				target,
				paths,
			})
			pendingExternalSelectionActionsRef.current.set(
				matchingTab.id,
				pending,
			)
		},
		[
			appSettings.locale,
			persistActiveTab,
			workspaceContextModes,
		],
	)

	const requestProjectApplySelection = useCallback(
		(selection: PendingProjectApplySelection): Promise<ProjectApplySelection> => {
			projectApplySelectionResolverRef.current?.({ type: "cancel" })
			setPendingProjectApplySelection(selection)

			return new Promise(resolve => {
				projectApplySelectionResolverRef.current = resolve
			})
		},
		[],
	)

	const resolveProjectApplySelection = useCallback(
		(selection: ProjectApplySelection) => {
			const resolve = projectApplySelectionResolverRef.current

			projectApplySelectionResolverRef.current = null
			setPendingProjectApplySelection(null)
			resolve?.(selection)
		},
		[],
	)

	const runRoutingAnalysis = useCallback(
		async <T,>(operation: () => Promise<T>): Promise<T> => operation(),
		[],
	)

	const setProjectSwitchNotice = useCallback(
		(
			kind: RoutedApplyNoticeKind,
			tab: ProjectTab,
			undoReference: OperationUndoReference | null = null,
		) => {
			setRoutedApplyNotice({
				kind,
				projectName: getProjectName(tab.rootFolder),
				tabId: tab.id,
				undoReference,
			})
		},
		[],
	)

	const routeApplyDrop = useCallback(
		async (
			sourceTabId: string,
			paths: string[],
			temporaryRoot: string | null,
		): Promise<void> => {
			if (isRoutingApplyRef.current) {
				if (temporaryRoot !== null)
					await cleanupNativeDrop(temporaryRoot).catch(() => undefined)

				setGlobalNotice({
					kind: "info",
					message: translate(
						appSettings.locale,
						"workspace.applyBusy",
					),
				})
				return
			}

			const sourceTab = tabsRef.current.find(tab => tab.id === sourceTabId)

			if (sourceTab?.rootFolder === null || sourceTab === undefined) {
				if (temporaryRoot !== null)
					await cleanupNativeDrop(temporaryRoot).catch(() => undefined)

				setGlobalNotice({
					kind: "warning",
					message: translate(
						appSettings.locale,
						"workspace.selectRootForApply",
					),
				})
				return
			}

			const uniquePaths = [...new Set(paths)]

			if (uniquePaths.length === 0) {
				if (temporaryRoot !== null)
					await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
				return
			}

			isRoutingApplyRef.current = true
			setIsRoutingApply(true)
			setRoutingApplyTabId(sourceTabId)
			setGlobalNotice(null)
			setRoutedApplyNotice(null)

			const appendUndoTabs = new Set<string>()
			let routedTabId: string | null = null
			let routedApplication: {
				tabId: string
				undoReference: OperationUndoReference
			} | null = null

			try {
				const rootedTabs = tabsRef.current.filter((tab): tab is ProjectTab & { rootFolder: string } =>
					tab.rootFolder !== null)

				if (appSettings.workMode === "git") {
					if (uniquePaths.length !== 1) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"workspace.gitModeSinglePatch",
							),
						})
						return
					}

					const patchPath = uniquePaths[0]

					if (patchPath === undefined || !isGitPatchPath(patchPath)) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"workspace.gitModePatchOnly",
							),
						})
						return
					}

					const analyses = (await runRoutingAnalysis(() => mapFilesystemHeavySerially(rootedTabs, async tab => {
						try {
							const preview = await prepareGitPatch(
								tab.rootFolder,
								patchPath,
							)
							const handle = workspaceHandlesRef.current.get(tab.id)

							return {
								tab,
								preview,
								available: handle?.canAcceptRoutedApply() === true,
							} satisfies GitProjectAnalysis
						} catch {
							return null
						}
					}))).filter((analysis): analysis is GitProjectAnalysis => analysis !== null)

					if (analyses.length === 0) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"workspace.gitPatchNoOpenProject",
							),
						})
						return
					}

					let selectedAnalysis: GitProjectAnalysis | undefined

					if (analyses.length === 1)
						selectedAnalysis = analyses[0]
					else {
						const projects = analyses.map(analysis => ({
							tabId: analysis.tab.id,
							projectName: getProjectName(analysis.tab.rootFolder),
							destinationPath: null,
							destinationCount: 1,
							available: analysis.available,
							unavailableReason: analysis.available ?
								undefined :
								"busy" as const,
						}))

						if (!projects.some(project => project.available)) {
							setGlobalNotice({
								kind: "warning",
								message: translate(
									appSettings.locale,
									"projectRoute.projectUnavailable",
								),
							})
							return
						}

						const selection = await requestProjectApplySelection({
							mode: "git",
							sourceLabel: getSourceLabel(patchPath),
							projects,
							allowCurrentRoot: false,
							currentProjectName: getProjectName(sourceTab.rootFolder),
						})

						if (selection.type !== "project")
							return

						selectedAnalysis = analyses.find(analysis => analysis.tab.id === selection.tabId)
					}

					if (selectedAnalysis === undefined || !selectedAnalysis.available) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"projectRoute.projectUnavailable",
							),
						})
						return
					}

					const handle = workspaceHandlesRef.current.get(selectedAnalysis.tab.id)

					if (handle === undefined || !handle.canAcceptRoutedApply()) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"projectRoute.projectUnavailable",
							),
						})
						return
					}

					const didSwitch = activeTabIdRef.current !== selectedAnalysis.tab.id

					if (didSwitch) {
						await persistActiveTab(selectedAnalysis.tab.id)
						routedTabId = selectedAnalysis.tab.id
						setProjectSwitchNotice(
							"git_preview",
							selectedAnalysis.tab,
						)
					}

					const outcome = await handle.beginPreparedGitPatch(
						patchPath,
						selectedAnalysis.preview,
					)

					if (didSwitch) {
						if (outcome.status === "success") {
							routedApplication = {
								tabId: selectedAnalysis.tab.id,
								undoReference: outcome.undoReference,
							}
							setProjectSwitchNotice(
								"applied",
								selectedAnalysis.tab,
								outcome.undoReference,
							)
						} else
							setRoutedApplyNotice(null)
					}

					return
				}

				if (uniquePaths.some(isGitPatchPath)) {
					setGlobalNotice({
						kind: "warning",
						message: translate(
							appSettings.locale,
							"workspace.filesModePatchRejected",
						),
					})
					return
				}

				for (const path of uniquePaths) {
					const sourceLabel = getSourceLabel(path)
					const analyses = (await runRoutingAnalysis(() => mapFilesystemHeavySerially(rootedTabs, async tab => {
						try {
							const plan = await prepareProjectOverlay(
								tab.rootFolder,
								[path],
							)
							const concreteCandidates = getConcreteOverlayCandidates(plan)
							const concreteCount = getConcreteOverlayCount(
								plan,
								concreteCandidates,
							)
							const handle = workspaceHandlesRef.current.get(tab.id)

							return {
								tab,
								plan,
								concreteCandidates,
								concreteCount,
								available: handle?.canAcceptRoutedApply() === true,
							} satisfies FileProjectAnalysis
						} catch {
							return null
						}
					}))).filter((analysis): analysis is FileProjectAnalysis => analysis !== null)

					const sourceAnalysis = analyses.find(analysis => analysis.tab.id === sourceTabId)
					const rootCandidate = sourceAnalysis?.plan.rootCandidate ?? null
					const sourceHandle = workspaceHandlesRef.current.get(sourceTabId)
					const allowCurrentRoot = rootCandidate !== null &&
						sourceAnalysis?.available === true &&
						sourceHandle !== undefined
					const totalConcreteDestinations = analyses.reduce(
						(
							total,
							analysis,
						) => total + analysis.concreteCount,
						0,
					)
					type StrongProjectAnalysis = Omit<FileRoutingProjectEvidence, "candidate"> & {
						analysis: FileProjectAnalysis
						candidate: OverlayDestinationCandidate
					}
					const exactRootProjectCandidates = analyses.flatMap((analysis): StrongProjectAnalysis[] => {
						if (!analysis.available || analysis.plan.rootCandidate === null)
							return []

						return [{
							analysis,
							projectName: getProjectName(analysis.tab.rootFolder),
							sourceLabel,
							fileCount: analysis.plan.fileCount,
							candidate: analysis.plan.rootCandidate,
						}]
					})
					const exactRootProjectMatch = selectUniqueCompleteExactRootFileRoutingProject<StrongProjectAnalysis>(exactRootProjectCandidates)
					const strongProjectCandidates = analyses.flatMap((analysis): StrongProjectAnalysis[] => {
						if (
							!analysis.available ||
							analysis.plan.ambiguityLimitExceeded ||
							analysis.concreteCount !== 1
						)
							return []

						const candidate = analysis.concreteCandidates[0]

						if (candidate === undefined)
							return []

						return [{
							analysis,
							projectName: getProjectName(analysis.tab.rootFolder),
							sourceLabel,
							fileCount: analysis.plan.fileCount,
							candidate,
						}]
					})
					const strongProjectMatch = selectUniqueStrongFileRoutingProject<StrongProjectAnalysis>(strongProjectCandidates)

					const applyRootWithConfirmation = async (): Promise<void> => {
						if (
							!allowCurrentRoot ||
							sourceAnalysis === undefined ||
							rootCandidate === null ||
							sourceHandle === undefined
						) {
							setGlobalNotice({
								kind: "warning",
								message: translate(
									appSettings.locale,
									"projectRoute.noDestination",
								),
							})
							return
						}

						const didSwitch = activeTabIdRef.current !== sourceTabId

						if (didSwitch) {
							await persistActiveTab(sourceTabId)
							routedTabId = sourceTabId
							setProjectSwitchNotice(
								"resolve",
								sourceTab,
							)
						}

						const rootPlan = withOnlyOverlayCandidates(
							sourceAnalysis.plan,
							[rootCandidate],
						)
						const outcome = await sourceHandle.beginPreparedOverlayResolution(
							[path],
							sourceLabel,
							rootPlan,
							appendUndoTabs.has(sourceTabId),
						)

						if (outcome.status === "success") {
							appendUndoTabs.add(sourceTabId)

							if (didSwitch || routedTabId === sourceTabId) {
								routedApplication = {
									tabId: sourceTabId,
									undoReference: outcome.undoReference,
								}
								setProjectSwitchNotice(
									"applied",
									sourceTab,
									outcome.undoReference,
								)
							}
						} else if (didSwitch && outcome.status === "no_op") {
							if (routedApplication?.tabId !== sourceTabId) {
								setProjectSwitchNotice(
									"already_applied",
									sourceTab,
								)
							}
						} else if (didSwitch && routedApplication?.tabId !== sourceTabId)
							setRoutedApplyNotice(null)
					}

					const applyProjectAnalysis = async (
						analysis: FileProjectAnalysis,
						forcedCandidate?: OverlayDestinationCandidate,
					): Promise<void> => {
						const handle = workspaceHandlesRef.current.get(analysis.tab.id)

						if (
							!analysis.available ||
							handle === undefined ||
							!handle.canAcceptRoutedApply()
						) {
							setGlobalNotice({
								kind: "warning",
								message: translate(
									appSettings.locale,
									"projectRoute.projectUnavailable",
								),
							})
							return
						}

						const didSwitch = activeTabIdRef.current !== analysis.tab.id

						if (didSwitch) {
							await persistActiveTab(analysis.tab.id)
							routedTabId = analysis.tab.id

							if (analysis.concreteCount > 1) {
								setProjectSwitchNotice(
									"resolve",
									analysis.tab,
								)
							}
						}

						let outcome: PreparedApplyOutcome

						if (forcedCandidate !== undefined) {
							outcome = await handle.applyPreparedOverlay(
								[path],
								forcedCandidate,
								analysis.plan.sourceFingerprint,
								analysis.plan.routingFingerprint,
								appendUndoTabs.has(analysis.tab.id),
							)
						} else if (analysis.concreteCount === 1) {
							const candidate = analysis.concreteCandidates[0]

							if (candidate === undefined) {
								setGlobalNotice({
									kind: "warning",
									message: translate(
										appSettings.locale,
										"projectRoute.noDestination",
									),
								})
								return
							}

							outcome = await handle.applyPreparedOverlay(
								[path],
								candidate,
								analysis.plan.sourceFingerprint,
								analysis.plan.routingFingerprint,
								appendUndoTabs.has(analysis.tab.id),
							)
						} else {
							if (analysis.plan.ambiguityLimitExceeded) {
								setGlobalNotice({
									kind: "warning",
									message: translate(
										appSettings.locale,
										"workspace.applyTooAmbiguous",
										{
											source: sourceLabel,
											count: analysis.concreteCount,
											limit: analysis.plan.ambiguityLimit,
										},
									),
								})
								if (didSwitch)
									setRoutedApplyNotice(null)
								return
							}

							outcome = await handle.beginPreparedOverlayResolution(
								[path],
								sourceLabel,
								withOnlyOverlayCandidates(
									analysis.plan,
									analysis.concreteCandidates,
								),
								appendUndoTabs.has(analysis.tab.id),
							)
						}

						if (outcome.status === "success") {
							appendUndoTabs.add(analysis.tab.id)

							if (didSwitch || routedTabId === analysis.tab.id) {
								routedApplication = {
									tabId: analysis.tab.id,
									undoReference: outcome.undoReference,
								}
								setProjectSwitchNotice(
									"applied",
									analysis.tab,
									outcome.undoReference,
								)
							}
						} else if (didSwitch && outcome.status === "no_op") {
							if (routedApplication?.tabId !== analysis.tab.id) {
								setProjectSwitchNotice(
									"already_applied",
									analysis.tab,
								)
							}
						} else if (didSwitch && routedApplication?.tabId !== analysis.tab.id)
							setRoutedApplyNotice(null)
					}

					if (exactRootProjectMatch !== null) {
						await applyProjectAnalysis(
							exactRootProjectMatch.analysis,
							exactRootProjectMatch.candidate,
						)
						continue
					}

					if (strongProjectMatch !== null) {
						await applyProjectAnalysis(
							strongProjectMatch.analysis,
							strongProjectMatch.candidate,
						)
						continue
					}

					if (totalConcreteDestinations === 0) {
						await applyRootWithConfirmation()
						continue
					}

					if (totalConcreteDestinations === 1) {
						const uniqueAnalysis = analyses.find(analysis => analysis.concreteCount === 1)

						if (uniqueAnalysis?.available === true) {
							await applyProjectAnalysis(uniqueAnalysis)
							continue
						}
					}

					const projectAnalyses = analyses
						.map(analysis => {
							if (
								analysis.tab.id !== sourceTabId ||
								!allowCurrentRoot ||
								rootCandidate === null ||
								analysis.plan.ambiguityLimitExceeded
							)
								return analysis

							const candidates = analysis.concreteCandidates.filter(candidate =>
								!isSameOverlayCandidate(
									candidate,
									rootCandidate,
								))

							return {
								...analysis,
								concreteCandidates: candidates,
								concreteCount: candidates.length,
							}
						})
						.filter(analysis => analysis.concreteCount > 0)
					const projects = projectAnalyses.map(analysis => ({
						tabId: analysis.tab.id,
						projectName: getProjectName(analysis.tab.rootFolder),
						destinationPath: analysis.concreteCount === 1 ?
							analysis.concreteCandidates[0]?.destinationRelativePath ?? null :
							null,
						destinationCount: analysis.concreteCount,
						available: analysis.available && !analysis.plan.ambiguityLimitExceeded,
						unavailableReason: analysis.plan.ambiguityLimitExceeded ?
							"tooAmbiguous" as const :
							analysis.available ?
								undefined :
								"busy" as const,
					}))

					if (!allowCurrentRoot && !projects.some(project => project.available)) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"projectRoute.noDestination",
							),
						})
						continue
					}

					const selection = await requestProjectApplySelection({
						mode: "files",
						sourceLabel,
						projects,
						allowCurrentRoot,
						currentProjectName: getProjectName(sourceTab.rootFolder),
					})

					if (selection.type === "cancel")
						continue

					if (selection.type === "root") {
						await applyRootWithConfirmation()
						continue
					}

					const selectedAnalysis = projectAnalyses.find(analysis => analysis.tab.id === selection.tabId)

					if (selectedAnalysis === undefined) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"projectRoute.noDestination",
							),
						})
						continue
					}

					await applyProjectAnalysis(selectedAnalysis)
				}
			} catch (error) {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			} finally {
				projectApplySelectionResolverRef.current = null
				setPendingProjectApplySelection(null)
				isRoutingApplyRef.current = false
				setIsRoutingApply(false)
				setRoutingApplyTabId(null)

				if (temporaryRoot !== null)
					await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
			}
		},
		[
			appSettings.locale,
			appSettings.workMode,
			persistActiveTab,
			requestProjectApplySelection,
			runRoutingAnalysis,
			setProjectSwitchNotice,
		],
	)

	const undoRoutedApplication = useCallback(
		async (): Promise<void> => {
			const currentNotice = routedApplyNotice

			if (currentNotice === null || currentNotice.undoReference === null)
				return

			const handle = workspaceHandlesRef.current.get(currentNotice.tabId)

			if (handle === undefined) {
				setGlobalNotice({
					kind: "warning",
					message: translate(
						appSettings.locale,
						"projectRoute.undoUnavailable",
					),
				})
				return
			}

			if (activeTabIdRef.current !== currentNotice.tabId)
				await persistActiveTab(currentNotice.tabId)

			const undone = await handle.undoApplicationIfLatest(currentNotice.undoReference)

			if (!undone) {
				setGlobalNotice({
					kind: "warning",
					message: translate(
						appSettings.locale,
						"projectRoute.undoUnavailable",
					),
				})
				return
			}

			setRoutedApplyNotice({
				...currentNotice,
				kind: "undone",
				undoReference: null,
			})
		},
		[
			appSettings.locale,
			persistActiveTab,
			routedApplyNotice,
		],
	)

	const processExternalActions = useCallback(
		async (): Promise<void> => {
			if (!tabsReady)
				return

			externalActionsRequestedRef.current = true

			if (processingExternalActionsRef.current)
				return

			processingExternalActionsRef.current = true

			try {
				while (externalActionsRequestedRef.current) {
					externalActionsRequestedRef.current = false

					while (true) {
						const queued = await nextExternalAction()

						if (queued === null)
							break

						const action = queued.action

						try {
							if (action.type === "openRoot")
								await openExternalRoot(action.path)
							else {
								await routeExternalSelectionAction(
									action.paths,
									action.type === "addContextAndCopy" ?
										"addAndCopy" :
										action.type === "addContext" || action.type === "addIgnore" ?
											"add" :
											"remove",
								)
							}
						} catch (error) {
							setGlobalNotice({
								kind: "error",
								message: getErrorMessage(
									error,
									appSettings.locale,
								),
							})
						}

						await ackExternalAction(queued.id)
					}
				}
			} catch (error) {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			} finally {
				processingExternalActionsRef.current = false
			}
		},
		[
			appSettings.locale,
			openExternalRoot,
			routeExternalSelectionAction,
			tabsReady,
		],
	)

	useEffect(
		() => {
			if (!tabsReady || !appSettings.isReady)
				return

			const openProjectRoots = tabs.flatMap(tab =>
				tab.rootFolder === null ?
					[] :
					[tab.rootFolder])
			const contextProjectRoots = tabs.flatMap(tab =>
				tab.rootFolder !== null && workspaceContextModes[tab.id] === "create" ?
					[tab.rootFolder] :
					[])
			const ignoreProjectRoot = ignoreDialogTabId === null ?
				null :
				tabs.find(tab => tab.id === ignoreDialogTabId)?.rootFolder ?? null
			const write = externalIntegrationWriteQueueRef.current
				.catch(() => undefined)
				.then(() => setExternalIntegrationState(
					openProjectRoots,
					contextProjectRoots,
					ignoreProjectRoot,
					appSettings.hideOpenProjectSubfolders,
				))

			externalIntegrationWriteQueueRef.current = write.catch(() => undefined)
			void write.catch(error => {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			})
		},
		[
			appSettings,
			appSettings.hideOpenProjectSubfolders,
			appSettings.isReady,
			appSettings.locale,
			ignoreDialogTabId,
			tabs,
			tabsReady,
			workspaceContextModes,
		],
	)

	useEffect(
		() => {
			document.documentElement.lang = appSettings.locale
			document.title = translate(
				appSettings.locale,
				"app.name",
			)
		},
		[appSettings.locale],
	)

	useEffect(
		() => {
			if (
				!appSettings.isReady ||
				initializationStartedRef.current
			)
				return

			initializationStartedRef.current = true
			let cancelled = false

			async function initializeTabs(): Promise<void> {
				try {
					const [storedTabs, storedActiveTabId] = await Promise.all([
						getProjectTabs(),
						getActiveProjectTabId(),
					])
					let nextTabs = storedTabs.length > 0 ?
						storedTabs :
						[createProjectTab()]
					let foundMissingRoot = false
					let foundDuplicateRoot = false
					let duplicateActiveTabRedirect: string | null = null

					for (const [index, tab] of nextTabs.entries()) {
						if (
							tab.rootFolder === null ||
							await folderExists(tab.rootFolder)
						)
							continue

						foundMissingRoot = true
						nextTabs = nextTabs.map(current =>
							current.id === tab.id ?
								{
									...current,
									rootFolder: null,
								} :
								current)
						await upsertProjectTab(
							{
								...tab,
								rootFolder: null,
							},
							index,
						)
					}

					const uniqueRootTabs: Array<{ id: string; rootFolder: string }> = []

					for (const [index, tab] of nextTabs.entries()) {
						if (tab.rootFolder === null)
							continue

						const duplicateIndex = uniqueRootTabs.length === 0 ?
							null :
							await findProjectForRoot(
								uniqueRootTabs.map(item => item.rootFolder),
								tab.rootFolder,
							)

						if (duplicateIndex === null) {
							uniqueRootTabs.push({
								id: tab.id,
								rootFolder: tab.rootFolder,
							})
							continue
						}

						foundDuplicateRoot = true
						if (tab.id === storedActiveTabId)
							duplicateActiveTabRedirect = uniqueRootTabs[duplicateIndex]?.id ?? null
						nextTabs = nextTabs.map(current =>
							current.id === tab.id ?
								{
									...current,
									rootFolder: null,
								} :
								current)
						await upsertProjectTab(
							{
								...tab,
								rootFolder: null,
							},
							index,
						)
					}

					if (storedTabs.length === 0) {
						const firstTab = nextTabs[0]

						if (firstTab === undefined)
							throw new Error("No project tab could be initialized.")

						await upsertProjectTab(
							firstTab,
							0,
						)
					}

					if (cancelled)
						return

					const desiredActiveTabId = duplicateActiveTabRedirect ?? storedActiveTabId
					const nextActiveTab = nextTabs.find(tab => tab.id === desiredActiveTabId) ?? nextTabs[0]

					if (nextActiveTab === undefined)
						throw new Error("No project tab could be initialized.")

					updateTabsState(nextTabs)
					updateActiveTabState(nextActiveTab.id)
					await setActiveProjectTabId(nextActiveTab.id)

					if (foundMissingRoot) {
						setGlobalNotice({
							kind: "warning",
							message: translate(
								appSettings.locale,
								"workspace.savedRootMissing",
							),
						})
					}

					if (!foundMissingRoot && foundDuplicateRoot) {
						setGlobalNotice({
							kind: "info",
							message: translate(
								appSettings.locale,
								"workspace.projectAlreadyOpen",
							),
						})
					}

					if (
						appSettings.openExplorerOnAppStart &&
						nextActiveTab.rootFolder !== null
					) {
						await openFolderInExplorer(nextActiveTab.rootFolder)
							.catch(error => {
								if (!cancelled) {
									setGlobalNotice({
										kind: "error",
										message: getErrorMessage(
											error,
											appSettings.locale,
										),
									})
								}
							})
					}
				} catch (error) {
					if (!cancelled) {
						const fallbackTab = createProjectTab()

						updateTabsState([fallbackTab])
						updateActiveTabState(fallbackTab.id)
						setGlobalNotice({
							kind: "error",
							message: getErrorMessage(
								error,
								appSettings.locale,
							),
						})
					}
				} finally {
					if (!cancelled)
						setTabsReady(true)
				}
			}

			void initializeTabs()

			return () => {
				cancelled = true
			}
		},
		[
			appSettings.isReady,
			appSettings.locale,
			appSettings.openExplorerOnAppStart,
			updateActiveTabState,
			updateTabsState,
		],
	)

	useEffect(
		() => {
			if (!tabsReady)
				return

			let unlisten: (() => void) | undefined
			let cancelled = false

			async function subscribe(): Promise<void> {
				const disposer = await listen(
					EXTERNAL_ACTIONS_PENDING_EVENT,
					() => {
						void processExternalActions()
					},
				)

				if (cancelled) {
					disposer()
					return
				}

				unlisten = disposer
				void processExternalActions()
			}

			void subscribe().catch(error => {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			})

			return () => {
				cancelled = true
				unlisten?.()
			}
		},
		[
			appSettings.locale,
			processExternalActions,
			tabsReady,
		],
	)

	const closeExplorerOnAppExit = appSettings.closeExplorerOnAppExit
	const flushAppSettingsWrites = appSettings.flushPendingWrites
	const appLocale = appSettings.locale

	useEffect(
		() => {
			let unlisten: (() => void) | undefined
			let cancelled = false
			const appWindow = getCurrentWindow()

			async function subscribe(): Promise<void> {
				const disposer = await appWindow.onCloseRequested(async event => {
					event.preventDefault()

					if (isClosingAppRef.current)
						return

					isClosingAppRef.current = true

					try {
						for (const handle of workspaceHandlesRef.current.values()) {
							if (!await handle.prepareForTabClose()) {
								setGlobalNotice({
									kind: "info",
									message: translate(
										appLocale,
										"workspace.tabBusy",
									),
								})
								isClosingAppRef.current = false
								return
							}
						}

						await flushAppSettingsWrites()
						await flushProjectTabWrites()
						await Promise.allSettled([
							tabOrderSaveQueueRef.current,
							activeTabSaveQueueRef.current,
							externalIntegrationWriteQueueRef.current,
						])

						if (closeExplorerOnAppExit) {
							const roots = tabsRef.current.flatMap(tab =>
								tab.rootFolder === null ?
									[] :
									[tab.rootFolder])

							for (const root of new Set(roots))
								await closeFolderInExplorer(root).catch(() => undefined)
						}

						await destroyMainWindow()
					} catch (error) {
						isClosingAppRef.current = false
						setGlobalNotice({
							kind: "error",
							message: getErrorMessage(
								error,
								appLocale,
							),
						})
					}
				})

				if (cancelled) {
					disposer()
					return
				}

				unlisten = disposer
			}

			void subscribe().catch(error => {
				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appLocale,
					),
				})
			})

			return () => {
				cancelled = true
				unlisten?.()
			}
		},
		[
			appLocale,
			closeExplorerOnAppExit,
			flushAppSettingsWrites,
		],
	)

	const openSettings = useCallback(
		() => {
			const ignoreTabId = ignoreDialogTabIdRef.current

			if (ignoreTabId !== null) {
				updateIgnoreDialogState(
					ignoreTabId,
					false,
				)
			}

			setIsSettingsOpen(true)
		},
		[updateIgnoreDialogState],
	)

	const closeSettings = useCallback(
		() => {
			setIsSettingsOpen(false)
		},
		[],
	)

	const displayedNotice = globalNotice ?? appSettings.notice
	const appReady = appSettings.isReady && tabsReady

	return (
		<>
			<main
				inert={!appReady}
				aria-busy={!appReady}
				className={styles.page}
			>
				<OverlayScrollbarManager />
				<div className={styles.shell}>
					<header className={styles.header}>
						<h1 className={styles.title}>
							{translate(
								appSettings.locale,
								"app.name",
							)}
						</h1>

						<div className={styles.headerActions}>
							{appVersion && (
								<div className={styles.version}>
									v{appVersion}
								</div>
							)}

							<button
								type="button"
								aria-label={translate(
									appSettings.locale,
									"app.settings.open",
								)}
								title={translate(
									appSettings.locale,
									"settings.title",
								)}
								className={styles.settingsButton}
								disabled={!appReady || isRoutingApply || isSettingsOperationBusy}
								onClick={openSettings}
							>
								<Settings
									size={15}
									strokeWidth={2}
									aria-hidden="true"
								/>
							</button>
						</div>
					</header>

					{tabsReady && tabs.length > 0 && (
						<ProjectTabs
							tabs={tabs}
							activeTabId={activeTabId}
							locale={appSettings.locale}
							disabled={!appReady || ignoreDialogTabId !== null || pendingProjectApplySelection !== null}
							onSelect={id => void persistActiveTab(id)}
							onAdd={() => void addTab()}
							onClose={id => void closeTab(id)}
							onMove={(
								sourceId,
								insertionIndex,
							) => void moveTab(
								sourceId,
								insertionIndex,
							)}
						/>
					)}

					<div className={styles.workspaceStage}>
						{displayedNotice && (
							<Notice
								kind={displayedNotice.kind}
								message={displayedNotice.message}
								details={displayedNotice.details}
							/>
						)}

						{routedApplyNotice !== null && (
							<div
								className={styles.routedNotice({
									success: routedApplyNotice.kind === "applied" || routedApplyNotice.kind === "undone",
								})}
								role="status"
							>
								<span className={styles.routedNoticeText}>
									{translate(
										appSettings.locale,
										getRoutedApplyMessageKey(routedApplyNotice.kind),
										{ project: routedApplyNotice.projectName },
									)}
								</span>

								{routedApplyNotice.undoReference !== null && (
									<button
										type="button"
										className={styles.routedUndoButton}
										onClick={() => void undoRoutedApplication()}
									>
										{translate(
											appSettings.locale,
											"projectRoute.undo",
										)}
									</button>
								)}
							</div>
						)}

						{tabs.map(tab => (
							<ProjectWorkspacePane
								key={tab.id}
								tabId={tab.id}
								active={tab.id === activeTabId}
								interactionBlocked={isSettingsOpen || pendingProjectApplySelection !== null}
								routingBusy={routingApplyTabId === tab.id}
								routingDecisionPending={pendingProjectApplySelection !== null}
								vscodeAvailable={vscodeAvailable}
								initialRootFolder={tab.rootFolder}
								folderSectionExpanded={appSettings.folderSectionExpanded}
								folderAction={appSettings.folderAction}
								contextSectionExpanded={appSettings.contextSectionExpanded}
								applySectionExpanded={appSettings.applySectionExpanded}
								ignoreDialogOpen={ignoreDialogTabId === tab.id}
								folderPickerReferenceRoot={lastRootFolder}
								preferences={preferences}
								onRootFolderChange={rootFolder => handleRootFolderChange(
									tab.id,
									rootFolder,
								)}
								onFolderActionChange={action => void appSettings.updateFolderAction(action)}
								onSectionExpandedChange={(section, expanded) => void handleSectionExpandedChange(
									section,
									expanded,
								)}
								onContextModeChange={updateWorkspaceContextMode}
								onRegister={registerWorkspace}
								onIgnoreDialogOpenChange={open => updateIgnoreDialogState(
									tab.id,
									open,
								)}
								onApplyDrop={(
									sourceTabId,
									paths,
									temporaryRoot,
								) => void routeApplyDrop(
									sourceTabId,
									paths,
									temporaryRoot,
								)}
							/>
						))}
					</div>
				</div>

				{pendingProjectApplySelection !== null && (
					<ProjectApplyDialog
						mode={pendingProjectApplySelection.mode}
						locale={appSettings.locale}
						sourceLabel={pendingProjectApplySelection.sourceLabel}
						projects={pendingProjectApplySelection.projects}
						allowCurrentRoot={pendingProjectApplySelection.allowCurrentRoot}
						currentProjectName={pendingProjectApplySelection.currentProjectName}
						disabled={!appReady}
						onCancel={() => resolveProjectApplySelection({ type: "cancel" })}
						onSelectProject={tabId => resolveProjectApplySelection({
							type: "project",
							tabId,
						})}
						onSelectCurrentRoot={() => resolveProjectApplySelection({ type: "root" })}
					/>
				)}

				<SettingsDrawer
					open={isSettingsOpen}
					locale={appSettings.locale}
					theme={appSettings.theme}
					workMode={appSettings.workMode}
					autoCopyContextAfterAdd={appSettings.autoCopyContextAfterAdd}
					autoClearAfterExport={appSettings.autoClearAfterExport}
					contextFilterHistoryLimit={appSettings.contextFilterHistoryLimit}
					contextHistoryLimit={appSettings.contextHistoryLimit}
					overlayUndoHistoryLimit={appSettings.overlayUndoHistoryLimit}
					diagnosticFileLimit={appSettings.diagnosticFileLimit}
					openExplorerOnAppStart={appSettings.openExplorerOnAppStart}
					openExplorerOnProjectOpen={appSettings.openExplorerOnProjectOpen}
					closeExplorerOnFolderClose={appSettings.closeExplorerOnFolderClose}
					closeExplorerOnAppExit={appSettings.closeExplorerOnAppExit}
					hideOpenProjectSubfolders={appSettings.hideOpenProjectSubfolders}
					settingsGeneralExpanded={appSettings.settingsGeneralExpanded}
					settingsContextExpanded={appSettings.settingsContextExpanded}
					settingsHistoryExpanded={appSettings.settingsHistoryExpanded}
					settingsVscodeExpanded={appSettings.settingsVscodeExpanded}
					settingsExplorerExpanded={appSettings.settingsExplorerExpanded}
					vscodeAvailable={vscodeAvailable}
					disabled={!appSettings.isReady || isRoutingApply || isSettingsOperationBusy}
					onBusyChange={setIsSettingsOperationBusy}
					onClose={closeSettings}
					onLocaleChange={nextLocale => void appSettings.updateLocale(nextLocale)}
					onThemeChange={theme => void appSettings.updateTheme(theme)}
					onWorkModeChange={workMode => void appSettings.updateWorkMode(workMode)}
					onAutoCopyContextAfterAddChange={enabled => void appSettings.updateAutoCopyContextAfterAdd(enabled)}
					onAutoClearAfterExportChange={enabled => void appSettings.updateAutoClearAfterExport(enabled)}
					onContextFilterHistoryLimitChange={limit => void appSettings.updateContextFilterHistoryLimit(limit)}
					onContextHistoryLimitChange={limit => void appSettings.updateContextHistoryLimit(limit)}
					onOverlayUndoHistoryLimitChange={limit => void appSettings.updateOverlayUndoHistoryLimit(limit)}
					onDiagnosticFileLimitChange={limit => void appSettings.updateDiagnosticFileLimit(limit)}
					onOpenExplorerOnAppStartChange={enabled => void appSettings.updateOpenExplorerOnAppStart(enabled)}
					onOpenExplorerOnProjectOpenChange={enabled => void appSettings.updateOpenExplorerOnProjectOpen(enabled)}
					onCloseExplorerOnFolderCloseChange={enabled => void appSettings.updateCloseExplorerOnFolderClose(enabled)}
					onCloseExplorerOnAppExitChange={enabled => void appSettings.updateCloseExplorerOnAppExit(enabled)}
					onHideOpenProjectSubfoldersChange={enabled => void appSettings.updateHideOpenProjectSubfolders(enabled)}
					onSettingsGeneralExpandedChange={expanded => void appSettings.updateSettingsGeneralExpanded(expanded)}
					onSettingsContextExpandedChange={expanded => void appSettings.updateSettingsContextExpanded(expanded)}
					onSettingsHistoryExpandedChange={expanded => void appSettings.updateSettingsHistoryExpanded(expanded)}
					onSettingsVscodeExpandedChange={expanded => void appSettings.updateSettingsVscodeExpanded(expanded)}
					onSettingsExplorerExpandedChange={expanded => void appSettings.updateSettingsExplorerExpanded(expanded)}
				/>
			</main>

			<BootLoadingOverlayCleanup ready={appReady} />
		</>
	)
}
