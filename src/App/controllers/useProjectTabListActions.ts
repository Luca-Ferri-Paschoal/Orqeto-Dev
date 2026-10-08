import {
	createProjectTab,
	moveTabToInsertionPosition,
} from "../helpers"
import type { AppState } from "./useAppState"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import {
	deleteProjectTab,
	upsertProjectTab,
} from "@/infra/configDatabase"
import { closeFolderInExplorer } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

type PersistenceActions = {
	persistActiveTab: (id: string) => Promise<void>
	persistTabOrder: (ids: string[]) => Promise<void>
	updateIgnoreDialogState: (
		tabId: string,
		open: boolean,
	) => void
	updateTabsState: (tabs: AppState["tabs"]) => void
}

export function useProjectTabListActions(
	state: AppState,
	appSettings: AppSettings,
	actions: PersistenceActions,
) {
	const {
		activeTabIdRef,
		ignoreDialogTabIdRef,
		pendingExternalSelectionActionsRef,
		rootChangeRevisionsRef,
		setGlobalNotice,
		tabsRef,
		workspaceHandlesRef,
	} = state
	const {
		persistActiveTab,
		persistTabOrder,
		updateIgnoreDialogState,
		updateTabsState,
	} = actions

	const addTab = useCallback(async () => {
		const currentTabs = tabsRef.current
		const nextTab = createProjectTab()
		try {
			await upsertProjectTab(
				nextTab,
				currentTabs.length,
			)
			const latestTabs = tabsRef.current
			if (!latestTabs.some(tab => tab.id === nextTab.id)) {
				const nextTabs = [...latestTabs, nextTab]
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
	}, [appSettings.locale, persistActiveTab, persistTabOrder, setGlobalNotice, tabsRef, updateTabsState])

	const closeTab = useCallback(async (tabId: string) => {
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
			if (tab.rootFolder !== null && appSettings.closeExplorerOnFolderClose)
				await closeFolderInExplorer(tab.rootFolder).catch(() => undefined)
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
				if (nextActiveTab !== undefined && activeTabIdRef.current === tabId)
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
	}, [
		activeTabIdRef,
		appSettings.closeExplorerOnFolderClose,
		appSettings.locale,
		ignoreDialogTabIdRef,
		pendingExternalSelectionActionsRef,
		persistActiveTab,
		persistTabOrder,
		rootChangeRevisionsRef,
		setGlobalNotice,
		tabsRef,
		updateIgnoreDialogState,
		updateTabsState,
		workspaceHandlesRef,
	])

	const moveTab = useCallback(async (sourceId: string, insertionIndex: number) => {
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
	}, [appSettings.locale, persistTabOrder, setGlobalNotice, tabsRef, updateTabsState])

	return { addTab, closeTab, moveTab }
}
