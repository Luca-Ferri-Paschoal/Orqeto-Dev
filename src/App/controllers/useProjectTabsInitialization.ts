import { createProjectTab } from "../helpers"
import type { AppState } from "./useAppState"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import {
	getActiveProjectTabId,
	getProjectTabs,
	setActiveProjectTabId,
	upsertProjectTab,
} from "@/infra/configDatabase"
import {
	findProjectForRoot,
	folderExists,
	openFolderInExplorer,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useEffect } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

type Dependencies = {
	updateActiveTabState: (id: string) => void
	updateTabsState: (tabs: AppState["tabs"]) => void
}

export function useProjectTabsInitialization(
	state: AppState,
	appSettings: AppSettings,
	deps: Dependencies,
): void {
	const {
		initializationStartedRef,
		setGlobalNotice,
		setTabsReady,
	} = state
	const { updateActiveTabState, updateTabsState } = deps

	useEffect(() => {
		if (!appSettings.isReady || initializationStartedRef.current)
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
					if (tab.rootFolder === null || await folderExists(tab.rootFolder))
						continue
					foundMissingRoot = true
					nextTabs = nextTabs.map(current => current.id === tab.id ?
						{ ...current, rootFolder: null } :
						current)
					await upsertProjectTab(
						{ ...tab, rootFolder: null },
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
						uniqueRootTabs.push({ id: tab.id, rootFolder: tab.rootFolder })
						continue
					}
					foundDuplicateRoot = true
					if (tab.id === storedActiveTabId)
						duplicateActiveTabRedirect = uniqueRootTabs[duplicateIndex]?.id ?? null
					nextTabs = nextTabs.map(current => current.id === tab.id ?
						{ ...current, rootFolder: null } :
						current)
					await upsertProjectTab(
						{ ...tab, rootFolder: null },
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
				} else if (foundDuplicateRoot) {
					setGlobalNotice({
						kind: "info",
						message: translate(
							appSettings.locale,
							"workspace.projectAlreadyOpen",
						),
					})
				}

				if (appSettings.openExplorerOnAppStart && nextActiveTab.rootFolder !== null) {
					await openFolderInExplorer(nextActiveTab.rootFolder).catch(error => {
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
		return () => { cancelled = true }
	}, [
		appSettings.isReady,
		appSettings.locale,
		appSettings.openExplorerOnAppStart,
		initializationStartedRef,
		setGlobalNotice,
		setTabsReady,
		updateActiveTabState,
		updateTabsState,
	])
}
