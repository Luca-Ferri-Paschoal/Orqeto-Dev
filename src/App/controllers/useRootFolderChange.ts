import type { AppState } from "./useAppState"
import type { ProjectTab } from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import { upsertProjectTab } from "@/infra/configDatabase"
import { findProjectForRoot } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

type Dependencies = {
	persistActiveTab: (id: string) => Promise<void>
	updateIgnoreDialogState: (
		tabId: string,
		open: boolean,
	) => void
	updateTabsState: (tabs: ProjectTab[]) => void
}

export function useRootFolderChange(
	state: AppState,
	appSettings: AppSettings,
	deps: Dependencies,
) {
	const {
		ignoreDialogTabIdRef,
		rootChangeRevisionsRef,
		setGlobalNotice,
		setLastRootFolder,
		tabsRef,
	} = state
	const { persistActiveTab, updateIgnoreDialogState, updateTabsState } = deps

	return useCallback(async (
		tabId: string,
		rootFolder: string | null,
	): Promise<boolean> => {
		const revision = (rootChangeRevisionsRef.current.get(tabId) ?? 0) + 1
		rootChangeRevisionsRef.current.set(
			tabId,
			revision,
		)
		const isCurrentRevision = (): boolean => rootChangeRevisionsRef.current.get(tabId) === revision
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
				const otherTabs = currentTabs.filter(tab => tab.id !== tabId && tab.rootFolder !== null)
				const otherRoots = otherTabs.flatMap(tab => tab.rootFolder === null ?
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
			const nextTab: ProjectTab = { ...currentTab, rootFolder }
			if (!isCurrentRevision())
				return false
			await upsertProjectTab(
				nextTab,
				tabIndex,
			)
			if (!isCurrentRevision())
				return false
			const nextTabs = tabsRef.current.map(tab => tab.id === tabId ?
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
	}, [
		appSettings.locale,
		ignoreDialogTabIdRef,
		persistActiveTab,
		rootChangeRevisionsRef,
		setGlobalNotice,
		setLastRootFolder,
		tabsRef,
		updateIgnoreDialogState,
		updateTabsState,
	])
}
