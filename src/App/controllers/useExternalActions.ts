import { EXTERNAL_ACTIONS_PENDING_EVENT } from "../types"
import type { AppState } from "./useAppState"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import {
	ackExternalAction,
	nextExternalAction,
	setExternalIntegrationState,
} from "@/infra/desktop"
import { listen } from "@tauri-apps/api/event"
import {
	useCallback,
	useEffect,
} from "react"

type AppSettings = ReturnType<typeof useAppSettings>

type Dependencies = {
	openExternalRoot: (path: string) => Promise<void>
	routeExternalSelectionAction: (
		paths: string[],
		type: "add" | "addAndCopy" | "remove",
	) => Promise<void>
}

export function useExternalActions(
	state: AppState,
	appSettings: AppSettings,
	deps: Dependencies,
): void {
	const {
		externalActionsRequestedRef,
		externalIntegrationWriteQueueRef,
		ignoreDialogTabId,
		processingExternalActionsRef,
		setGlobalNotice,
		tabs,
		tabsReady,
		workspaceBusyStates,
		workspaceContextModes,
	} = state
	const { openExternalRoot, routeExternalSelectionAction } = deps

	const processExternalActions = useCallback(async (): Promise<void> => {
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
					try {
						const action = queued.action
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
	}, [
		appSettings.locale,
		externalActionsRequestedRef,
		openExternalRoot,
		processingExternalActionsRef,
		routeExternalSelectionAction,
		setGlobalNotice,
		tabsReady,
	])

	useEffect(() => {
		if (!tabsReady)
			return
		let unlisten: (() => void) | undefined
		let cancelled = false
		async function subscribe(): Promise<void> {
			const disposer = await listen(
				EXTERNAL_ACTIONS_PENDING_EVENT,
				() => { void processExternalActions() },
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
	}, [appSettings.locale, processExternalActions, setGlobalNotice, tabsReady])

	useEffect(() => {
		if (!tabsReady || !appSettings.isReady)
			return
		const openProjectRoots = tabs.flatMap(tab => tab.rootFolder === null ?
			[] :
			[tab.rootFolder])
		const contextProjectRoots = openProjectRoots
		const busyProjectRoots = tabs.flatMap(tab =>
			tab.rootFolder !== null && workspaceBusyStates[tab.id] === true ?
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
				busyProjectRoots,
				ignoreProjectRoot,
				appSettings.hideOpenProjectSubfolders,
				appSettings.locale,
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
	}, [
		appSettings.hideOpenProjectSubfolders,
		appSettings.isReady,
		appSettings.locale,
		externalIntegrationWriteQueueRef,
		ignoreDialogTabId,
		setGlobalNotice,
		tabs,
		tabsReady,
		workspaceBusyStates,
		workspaceContextModes,
	])
}
