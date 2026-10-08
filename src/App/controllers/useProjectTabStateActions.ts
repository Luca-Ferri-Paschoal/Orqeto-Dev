import type { AppState } from "./useAppState"
import type {
	ProjectSection,
	ProjectTab,
} from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import {
	saveProjectTabOrder,
	setActiveProjectTabId,
} from "@/infra/configDatabase"
import { useCallback } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

export function useProjectTabStateActions(
	state: AppState,
	appSettings: AppSettings,
) {
	const {
		activeTabSaveQueueRef,
		ignoreDialogTabIdRef,
		setActiveTabId,
		setGlobalNotice,
		setIgnoreDialogTabId,
		setLastRootFolder,
		setTabs,
		tabOrderSaveQueueRef,
		tabsRef,
		activeTabIdRef,
	} = state

	const updateTabsState = useCallback((nextTabs: ProjectTab[]) => {
		tabsRef.current = nextTabs
		setTabs(nextTabs)
	}, [setTabs, tabsRef])

	const updateActiveTabState = useCallback((id: string) => {
		activeTabIdRef.current = id
		setActiveTabId(id)
		const rootFolder = tabsRef.current.find(tab => tab.id === id)?.rootFolder
		if (rootFolder)
			setLastRootFolder(rootFolder)
	}, [activeTabIdRef, setActiveTabId, setLastRootFolder, tabsRef])

	const updateIgnoreDialogState = useCallback((tabId: string, open: boolean) => {
		const nextTabId = open ?
			tabId :
			ignoreDialogTabIdRef.current === tabId ?
				null :
				ignoreDialogTabIdRef.current
		ignoreDialogTabIdRef.current = nextTabId
		setIgnoreDialogTabId(nextTabId)
	}, [ignoreDialogTabIdRef, setIgnoreDialogTabId])

	const persistActiveTab = useCallback(async (id: string): Promise<void> => {
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
	}, [activeTabSaveQueueRef, appSettings.locale, setGlobalNotice, updateActiveTabState])

	const persistTabOrder = useCallback(async (ids: string[]): Promise<void> => {
		const operation = tabOrderSaveQueueRef.current
			.catch(() => undefined)
			.then(() => saveProjectTabOrder(ids))
		tabOrderSaveQueueRef.current = operation.catch(() => undefined)
		await operation
	}, [tabOrderSaveQueueRef])

	const handleSectionExpandedChange = useCallback(async (
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
	}, [appSettings])

	return {
		updateTabsState,
		updateActiveTabState,
		updateIgnoreDialogState,
		persistActiveTab,
		persistTabOrder,
		handleSectionExpandedChange,
	}
}
