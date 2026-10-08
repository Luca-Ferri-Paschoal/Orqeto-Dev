import type { PendingExternalSelectionAction } from "../types"
import type { AppState } from "./useAppState"
import type { ProjectWorkspaceHandle } from "@/features/context/components/ProjectWorkspacePane"
import type { ContextMode } from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import { findProjectForPaths } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

type Dependencies = {
	persistActiveTab: (id: string) => Promise<void>
}

async function runPendingAction(
	handle: ProjectWorkspaceHandle,
	action: PendingExternalSelectionAction,
): Promise<void> {
	if (action.target === "ignore") {
		if (action.type === "add")
			await handle.addExternalIgnore(action.paths)
		else
			await handle.removeExternalIgnore(action.paths)
		return
	}
	if (action.type === "add")
		await handle.addExternalContext(action.paths)
	else if (action.type === "addAndCopy")
		await handle.addExternalContextAndCopy(action.paths)
	else
		await handle.removeExternalContext(action.paths)
}

export function useWorkspaceRegistry(
	state: AppState,
	appSettings: AppSettings,
	deps: Dependencies,
) {
	const {
		ignoreDialogTabIdRef,
		pendingExternalSelectionActionsRef,
		setGlobalNotice,
		setWorkspaceBusyStates,
		setWorkspaceContextModes,
		tabsRef,
		workspaceHandlesRef,
	} = state
	const { persistActiveTab } = deps

	const registerWorkspace = useCallback((tabId: string, handle: ProjectWorkspaceHandle | null) => {
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
					await runPendingAction(
						handle,
						action,
					)
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
	}, [appSettings.locale, pendingExternalSelectionActionsRef, setGlobalNotice, workspaceHandlesRef])

	const updateWorkspaceContextMode = useCallback((tabId: string, mode: ContextMode): void => {
		setWorkspaceContextModes(current => current[tabId] === mode ?
			current :
			{ ...current, [tabId]: mode })
	}, [setWorkspaceContextModes])

	const updateWorkspaceBusyState = useCallback((tabId: string, busy: boolean): void => {
		setWorkspaceBusyStates(current => current[tabId] === busy ?
			current :
			{ ...current, [tabId]: busy })
	}, [setWorkspaceBusyStates])

	const routeExternalSelectionAction = useCallback(async (
		paths: string[],
		type: PendingExternalSelectionAction["type"],
	): Promise<void> => {
		const rootedTabs = tabsRef.current.filter(tab => tab.rootFolder !== null)
		const roots = rootedTabs.flatMap(tab => tab.rootFolder === null ?
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
		await persistActiveTab(matchingTab.id)
		setGlobalNotice(null)
		const handle = workspaceHandlesRef.current.get(matchingTab.id)
		const action: PendingExternalSelectionAction = { type, target, paths }
		if (handle !== undefined) {
			await runPendingAction(
				handle,
				action,
			)
			return
		}
		const pending = pendingExternalSelectionActionsRef.current.get(matchingTab.id) ?? []
		pending.push(action)
		pendingExternalSelectionActionsRef.current.set(
			matchingTab.id,
			pending,
		)
	}, [
		appSettings.locale,
		ignoreDialogTabIdRef,
		pendingExternalSelectionActionsRef,
		persistActiveTab,
		setGlobalNotice,
		tabsRef,
		workspaceHandlesRef,
	])

	return {
		registerWorkspace,
		updateWorkspaceContextMode,
		updateWorkspaceBusyState,
		routeExternalSelectionAction,
	}
}
