import type { AppState } from "./useAppState"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import { flushProjectTabWrites } from "@/infra/configDatabase"
import {
	closeFolderInExplorer,
	destroyMainWindow,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

export function useAppClose(
	state: AppState,
	appSettings: AppSettings,
): void {
	const {
		activeTabSaveQueueRef,
		externalIntegrationWriteQueueRef,
		isClosingAppRef,
		setGlobalNotice,
		tabOrderSaveQueueRef,
		tabsRef,
		workspaceHandlesRef,
	} = state
	const closeExplorerOnAppExit = appSettings.closeExplorerOnAppExit
	const flushAppSettingsWrites = appSettings.flushPendingWrites
	const appLocale = appSettings.locale

	useEffect(() => {
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
						const roots: string[] = tabsRef.current.flatMap(tab =>
							tab.rootFolder === null ?
								[] :
								[tab.rootFolder])
						for (const root of new Set<string>(roots))
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
	}, [
		activeTabSaveQueueRef,
		appLocale,
		closeExplorerOnAppExit,
		externalIntegrationWriteQueueRef,
		flushAppSettingsWrites,
		isClosingAppRef,
		setGlobalNotice,
		tabOrderSaveQueueRef,
		tabsRef,
		workspaceHandlesRef,
	])
}
