import { useAppClose } from "./useAppClose"
import { useAppEnvironment } from "./useAppEnvironment"
import { useApplyRouting } from "./useApplyRouting"
import { useAppRecovery } from "./useAppRecovery"
import { useAppState } from "./useAppState"
import { useExternalActions } from "./useExternalActions"
import { useOpenExternalRoot } from "./useOpenExternalRoot"
import { useProjectTabListActions } from "./useProjectTabListActions"
import { useProjectTabsInitialization } from "./useProjectTabsInitialization"
import { useProjectTabStateActions } from "./useProjectTabStateActions"
import { useRootFolderChange } from "./useRootFolderChange"
import { useWorkspaceRegistry } from "./useWorkspaceRegistry"
import { useAppSettings } from "@/features/context/useAppSettings"
import { useCallback } from "react"

export function useAppController() {
	const appSettings = useAppSettings()
	const state = useAppState()
	const preferences = useAppEnvironment(
		state,
		appSettings,
	)
	const recovery = useAppRecovery(
		state,
		appSettings,
	)
	const { ignoreDialogTabIdRef, setIsSettingsOpen } = state
	const tabStateActions = useProjectTabStateActions(
		state,
		appSettings,
	)
	const handleRootFolderChange = useRootFolderChange(
		state,
		appSettings,
		tabStateActions,
	)
	const tabListActions = useProjectTabListActions(
		state,
		appSettings,
		tabStateActions,
	)
	const openExternalRoot = useOpenExternalRoot(state, appSettings, {
		handleRootFolderChange,
		...tabStateActions,
	})
	const workspaceRegistry = useWorkspaceRegistry(
		state,
		appSettings,
		tabStateActions,
	)
	const applyRouting = useApplyRouting(
		state,
		appSettings,
	)

	useProjectTabsInitialization(
		state,
		appSettings,
		tabStateActions,
	)
	useExternalActions(state, appSettings, {
		openExternalRoot,
		routeExternalSelectionAction: workspaceRegistry.routeExternalSelectionAction,
	})
	useAppClose(
		state,
		appSettings,
	)

	const openSettings = useCallback(() => {
		const ignoreTabId = ignoreDialogTabIdRef.current
		if (ignoreTabId !== null) {
			tabStateActions.updateIgnoreDialogState(
				ignoreTabId,
				false,
			)
		}
		setIsSettingsOpen(true)
	}, [ignoreDialogTabIdRef, setIsSettingsOpen, tabStateActions])

	const closeSettings = useCallback(() => {
		setIsSettingsOpen(false)
	}, [setIsSettingsOpen])

	return {
		appSettings,
		state,
		preferences,
		handleRootFolderChange,
		openSettings,
		closeSettings,
		...recovery,
		...tabStateActions,
		...tabListActions,
		...workspaceRegistry,
		...applyRouting,
	}
}

export type AppController = ReturnType<typeof useAppController>
