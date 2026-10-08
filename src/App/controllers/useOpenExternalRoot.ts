import { createProjectTab } from "../helpers"
import type { AppState } from "./useAppState"
import type { ProjectTab } from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { upsertProjectTab } from "@/infra/configDatabase"
import {
	findProjectForPaths,
	findProjectForRoot,
	folderExists,
	openFolderInExplorer,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

type Dependencies = {
	handleRootFolderChange: (
		tabId: string,
		rootFolder: string | null,
	) => Promise<boolean>
	persistActiveTab: (id: string) => Promise<void>
	persistTabOrder: (ids: string[]) => Promise<void>
	updateTabsState: (tabs: ProjectTab[]) => void
}

export function useOpenExternalRoot(
	state: AppState,
	appSettings: AppSettings,
	deps: Dependencies,
) {
	const { activeTabIdRef, setGlobalNotice, tabsRef, workspaceHandlesRef } = state
	const { handleRootFolderChange, persistActiveTab, persistTabOrder, updateTabsState } = deps

	return useCallback(async (path: string): Promise<void> => {
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
		const roots = rootedTabs.map(tab => tab.rootFolder)
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
			if (appSettings.openExplorerOnProjectOpen)
				await openFolderInExplorer(matchingTab.rootFolder)
			return
		}
		if (appSettings.hideOpenProjectSubfolders && roots.length > 0) {
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
			[...latestTabs, nextTab]
		updateTabsState(nextTabs)
		await persistTabOrder(nextTabs.map(tab => tab.id))
		await persistActiveTab(nextTab.id)
		setGlobalNotice(null)
		if (appSettings.openExplorerOnProjectOpen)
			await openFolderInExplorer(path)
	}, [
		activeTabIdRef,
		appSettings.hideOpenProjectSubfolders,
		appSettings.locale,
		appSettings.openExplorerOnProjectOpen,
		handleRootFolderChange,
		persistActiveTab,
		persistTabOrder,
		setGlobalNotice,
		tabsRef,
		updateTabsState,
		workspaceHandlesRef,
	])
}
