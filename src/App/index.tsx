import { styles } from "./style"
import { ProjectTabs } from "@/features/context/components/ProjectTabs"
import {
	type ProjectWorkspaceHandle,
	ProjectWorkspacePane,
} from "@/features/context/components/ProjectWorkspacePane"
import { SettingsDrawer } from "@/features/context/components/SettingsDrawer"
import type {
	AppNotice,
	ProjectSection,
	ProjectTab,
} from "@/features/context/types"
import { useAppSettings } from "@/features/context/useAppSettings"
import type { ContextWorkspacePreferences } from "@/features/context/useContextWorkspace"
import {
	deleteProjectTab,
	getActiveProjectTabId,
	getProjectTabs,
	saveProjectTabOrder,
	setActiveProjectTabId,
	setProjectTabSectionExpanded,
	upsertProjectTab,
} from "@/infra/configDatabase"
import {
	closeFolderInExplorer,
	discardProjectOverlayUndo,
	findProjectForPaths,
	findProjectForRoot,
	folderExists,
	openFolderInExplorer,
	takeExternalActions,
} from "@/infra/desktop"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Notice } from "@/shared/components/Notice"
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

type PendingExternalContextAction = | {
	type: "add"
	paths: string[]
} |
{
	type: "remove"
	paths: string[]
}

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

function createProjectTab(rootFolder: string | null = null): ProjectTab {
	return {
		id: `tab-${crypto.randomUUID()}`,
		rootFolder,
		folderSectionExpanded: true,
		contextSectionExpanded: true,
		applySectionExpanded: true,
	}
}

function getProjectSectionExpanded(
	tab: ProjectTab,
	section: ProjectSection,
): boolean {
	if (section === "folder")
		return tab.folderSectionExpanded

	if (section === "context")
		return tab.contextSectionExpanded

	return tab.applySectionExpanded
}

function withProjectSectionExpanded(
	tab: ProjectTab,
	section: ProjectSection,
	expanded: boolean,
): ProjectTab {
	if (section === "folder") {
		return {
			...tab,
			folderSectionExpanded: expanded,
		}
	}

	if (section === "context") {
		return {
			...tab,
			contextSectionExpanded: expanded,
		}
	}

	return {
		...tab,
		applySectionExpanded: expanded,
	}
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
	const tabsRef = useRef<ProjectTab[]>([])
	const activeTabIdRef = useRef("")
	const workspaceHandlesRef = useRef(new Map<string, ProjectWorkspaceHandle>())
	const pendingExternalContextActionsRef = useRef(new Map<string, PendingExternalContextAction[]>())
	const initializationStartedRef = useRef(false)
	const processingExternalActionsRef = useRef(false)
	const externalActionsRequestedRef = useRef(false)
	const isClosingAppRef = useRef(false)
	const sectionSaveQueuesRef = useRef(new Map<string, Promise<void>>())

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

	const preferences = useMemo<ContextWorkspacePreferences>(
		() => ({
			locale: appSettings.locale,
			theme: appSettings.theme,
			autoCopyContextAfterAdd: appSettings.autoCopyContextAfterAdd,
			autoClearAfterExport: appSettings.autoClearAfterExport,
			contextFilterHistoryLimit: appSettings.contextFilterHistoryLimit,
			contextHistoryLimit: appSettings.contextHistoryLimit,
			overlayUndoHistoryLimit: appSettings.overlayUndoHistoryLimit,
			openExplorerOnAppStart: appSettings.openExplorerOnAppStart,
			openExplorerOnProjectOpen: appSettings.openExplorerOnProjectOpen,
			closeExplorerOnFolderClose: appSettings.closeExplorerOnFolderClose,
			closeExplorerOnAppExit: appSettings.closeExplorerOnAppExit,
		}),
		[
			appSettings.autoClearAfterExport,
			appSettings.autoCopyContextAfterAdd,
			appSettings.closeExplorerOnAppExit,
			appSettings.closeExplorerOnFolderClose,
			appSettings.contextFilterHistoryLimit,
			appSettings.contextHistoryLimit,
			appSettings.locale,
			appSettings.theme,
			appSettings.openExplorerOnAppStart,
			appSettings.openExplorerOnProjectOpen,
			appSettings.overlayUndoHistoryLimit,
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

	const persistActiveTab = useCallback(
		async (id: string): Promise<void> => {
			updateActiveTabState(id)

			try {
				await setActiveProjectTabId(id)
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

	const handleSectionExpandedChange = useCallback(
		async (
			tabId: string,
			section: ProjectSection,
			expanded: boolean,
		): Promise<void> => {
			const currentTabs = tabsRef.current
			const tabIndex = currentTabs.findIndex(tab => tab.id === tabId)
			const currentTab = currentTabs[tabIndex]

			if (
				currentTab === undefined ||
				getProjectSectionExpanded(
					currentTab,
					section,
				) === expanded
			)
				return

			const previousValue = getProjectSectionExpanded(
				currentTab,
				section,
			)
			const nextTab = withProjectSectionExpanded(
				currentTab,
				section,
				expanded,
			)
			const nextTabs = currentTabs.map(tab =>
				tab.id === tabId ?
					nextTab :
					tab)

			updateTabsState(nextTabs)

			const queueKey = `${tabId}:${section}`
			const previousSave = sectionSaveQueuesRef.current.get(queueKey) ?? Promise.resolve()
			const save = previousSave
				.catch(() => undefined)
				.then(() => setProjectTabSectionExpanded(
					tabId,
					section,
					expanded,
				))

			sectionSaveQueuesRef.current.set(
				queueKey,
				save,
			)

			try {
				await save
			} catch (error) {
				if (sectionSaveQueuesRef.current.get(queueKey) !== save)
					return

				const latestTabs = tabsRef.current
				const latestTab = latestTabs.find(tab => tab.id === tabId)

				if (
					latestTab !== undefined &&
					getProjectSectionExpanded(
						latestTab,
						section,
					) === expanded
				) {
					updateTabsState(latestTabs.map(tab =>
						tab.id === tabId ?
							withProjectSectionExpanded(
								tab,
								section,
								previousValue,
							) :
							tab))
				}

				setGlobalNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						appSettings.locale,
					),
				})
			} finally {
				if (sectionSaveQueuesRef.current.get(queueKey) === save)
					sectionSaveQueuesRef.current.delete(queueKey)
			}
		},
		[
			appSettings.locale,
			updateTabsState,
		],
	)

	const handleRootFolderChange = useCallback(
		async (
			tabId: string,
			rootFolder: string | null,
		): Promise<boolean> => {
			const currentTabs = tabsRef.current
			const tabIndex = currentTabs.findIndex(tab => tab.id === tabId)
			const currentTab = currentTabs[tabIndex]

			if (currentTab === undefined)
				return false

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

				await upsertProjectTab(
					nextTab,
					tabIndex,
				)

				const nextTabs = currentTabs.map(tab =>
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

			const pending = pendingExternalContextActionsRef.current.get(tabId)

			if (pending === undefined)
				return

			pendingExternalContextActionsRef.current.delete(tabId)
			void (async () => {
				for (const action of pending) {
					if (action.type === "add") {
						await handle.addExternalContext(action.paths)
						continue
					}

					await handle.removeExternalContext(action.paths)
				}
			})()
		},
		[],
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
				updateTabsState([
					...currentTabs,
					nextTab,
				])
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

			if (handle !== undefined) {
				if (!await handle.prepareForTabClose()) {
					setGlobalNotice({
						kind: "info",
						message: translate(
							appSettings.locale,
							"workspace.tabBusy",
						),
					})
					return
				}
			} else if (tab.rootFolder !== null) {
				if (appSettings.closeExplorerOnFolderClose) {
					await closeFolderInExplorer(tab.rootFolder)
						.catch(() => undefined)
				}

				await discardProjectOverlayUndo(tab.rootFolder)
					.catch(() => undefined)
			}

			try {
				await deleteProjectTab(tabId)
				workspaceHandlesRef.current.delete(tabId)
				pendingExternalContextActionsRef.current.delete(tabId)

				const nextTabs = currentTabs.filter(current => current.id !== tabId)
				updateTabsState(nextTabs)
				await saveProjectTabOrder(nextTabs.map(current => current.id))

				if (activeTabIdRef.current === tabId) {
					const nextActiveTab = nextTabs[Math.min(
						tabIndex,
						nextTabs.length - 1,
					)]

					if (nextActiveTab !== undefined)
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
				await saveProjectTabOrder(nextTabs.map(tab => tab.id))
			} catch (error) {
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
			const rootedTabs = currentTabs.filter(tab => tab.rootFolder !== null)
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
			updateTabsState([
				...currentTabs,
				nextTab,
			])
			await persistActiveTab(nextTab.id)
			setGlobalNotice(null)

			if (appSettings.openExplorerOnProjectOpen)
				await openFolderInExplorer(path)
		},
		[
			appSettings.locale,
			appSettings.openExplorerOnProjectOpen,
			handleRootFolderChange,
			persistActiveTab,
			updateTabsState,
		],
	)

	const routeExternalContextAction = useCallback(
		async (
			paths: string[],
			type: PendingExternalContextAction["type"],
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

			await persistActiveTab(matchingTab.id)
			setGlobalNotice(null)
			const handle = workspaceHandlesRef.current.get(matchingTab.id)

			if (handle !== undefined) {
				if (type === "add") {
					await handle.addExternalContext(paths)
					return
				}

				await handle.removeExternalContext(paths)
				return
			}

			const pending = pendingExternalContextActionsRef.current.get(matchingTab.id) ?? []

			pending.push({
				type,
				paths,
			})
			pendingExternalContextActionsRef.current.set(
				matchingTab.id,
				pending,
			)
		},
		[
			appSettings.locale,
			persistActiveTab,
		],
	)

	const addExternalContext = useCallback(
		(paths: string[]) => routeExternalContextAction(
			paths,
			"add",
		),
		[routeExternalContextAction],
	)

	const removeExternalContext = useCallback(
		(paths: string[]) => routeExternalContextAction(
			paths,
			"remove",
		),
		[routeExternalContextAction],
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
						const actions = await takeExternalActions()

						if (actions.length === 0)
							break

						for (const action of actions) {
							if (action.type === "openRoot") {
								await openExternalRoot(action.path)
								continue
							}

							if (action.type === "addContext") {
								await addExternalContext(action.paths)
								continue
							}

							await removeExternalContext(action.paths)
						}
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
			addExternalContext,
			appSettings.locale,
			openExternalRoot,
			removeExternalContext,
			tabsReady,
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

					const nextActiveTab = nextTabs.find(tab => tab.id === storedActiveTabId) ?? nextTabs[0]

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

	useEffect(
		() => {
			let unlisten: (() => void) | undefined
			let cancelled = false
			const appWindow = getCurrentWindow()

			async function subscribe(): Promise<void> {
				const disposer = await appWindow.onCloseRequested(async event => {
					const pendingSectionSaves = [...sectionSaveQueuesRef.current.values()]

					if (
						!appSettings.closeExplorerOnAppExit &&
						pendingSectionSaves.length === 0
					)
						return

					event.preventDefault()

					if (isClosingAppRef.current)
						return

					isClosingAppRef.current = true

					await Promise.allSettled(pendingSectionSaves)

					if (appSettings.closeExplorerOnAppExit) {
						const roots = tabsRef.current.flatMap(tab =>
							tab.rootFolder === null ?
								[] :
								[tab.rootFolder])

						for (const root of new Set(roots))
							await closeFolderInExplorer(root).catch(() => undefined)
					}

					try {
						await appWindow.destroy()
					} catch (error) {
						isClosingAppRef.current = false
						setGlobalNotice({
							kind: "error",
							message: getErrorMessage(
								error,
								appSettings.locale,
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
			appSettings.closeExplorerOnAppExit,
			appSettings.locale,
		],
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
		<main className={styles.page}>
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
							onClick={() => setIsSettingsOpen(true)}
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
						disabled={!appReady}
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

				{displayedNotice && (
					<Notice
						kind={displayedNotice.kind}
						message={displayedNotice.message}
					/>
				)}

				{tabs.map(tab => (
					<ProjectWorkspacePane
						key={tab.id}
						tabId={tab.id}
						active={tab.id === activeTabId}
						interactionBlocked={isSettingsOpen}
						initialRootFolder={tab.rootFolder}
						folderSectionExpanded={tab.folderSectionExpanded}
						contextSectionExpanded={tab.contextSectionExpanded}
						applySectionExpanded={tab.applySectionExpanded}
						folderPickerReferenceRoot={lastRootFolder}
						preferences={preferences}
						onRootFolderChange={rootFolder => handleRootFolderChange(
							tab.id,
							rootFolder,
						)}
						onSectionExpandedChange={(section, expanded) => void handleSectionExpandedChange(
							tab.id,
							section,
							expanded,
						)}
						onRegister={registerWorkspace}
					/>
				))}
			</div>

			<SettingsDrawer
				open={isSettingsOpen}
				locale={appSettings.locale}
				theme={appSettings.theme}
				autoCopyContextAfterAdd={appSettings.autoCopyContextAfterAdd}
				autoClearAfterExport={appSettings.autoClearAfterExport}
				contextFilterHistoryLimit={appSettings.contextFilterHistoryLimit}
				contextHistoryLimit={appSettings.contextHistoryLimit}
				overlayUndoHistoryLimit={appSettings.overlayUndoHistoryLimit}
				openExplorerOnAppStart={appSettings.openExplorerOnAppStart}
				openExplorerOnProjectOpen={appSettings.openExplorerOnProjectOpen}
				closeExplorerOnFolderClose={appSettings.closeExplorerOnFolderClose}
				closeExplorerOnAppExit={appSettings.closeExplorerOnAppExit}
				disabled={!appSettings.isReady}
				onClose={closeSettings}
				onLocaleChange={nextLocale => void appSettings.updateLocale(nextLocale)}
				onThemeChange={theme => void appSettings.updateTheme(theme)}
				onAutoCopyContextAfterAddChange={enabled => void appSettings.updateAutoCopyContextAfterAdd(enabled)}
				onAutoClearAfterExportChange={enabled => void appSettings.updateAutoClearAfterExport(enabled)}
				onContextFilterHistoryLimitChange={limit => void appSettings.updateContextFilterHistoryLimit(limit)}
				onContextHistoryLimitChange={limit => void appSettings.updateContextHistoryLimit(limit)}
				onOverlayUndoHistoryLimitChange={limit => void appSettings.updateOverlayUndoHistoryLimit(limit)}
				onOpenExplorerOnAppStartChange={enabled => void appSettings.updateOpenExplorerOnAppStart(enabled)}
				onOpenExplorerOnProjectOpenChange={enabled => void appSettings.updateOpenExplorerOnProjectOpen(enabled)}
				onCloseExplorerOnFolderCloseChange={enabled => void appSettings.updateCloseExplorerOnFolderClose(enabled)}
				onCloseExplorerOnAppExitChange={enabled => void appSettings.updateCloseExplorerOnAppExit(enabled)}
			/>
		</main>
	)
}
