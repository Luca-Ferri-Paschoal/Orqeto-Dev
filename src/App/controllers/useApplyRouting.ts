import { routeFilesApply } from "./routeFilesApply"
import { routeGitApply } from "./routeGitApply"
import type { AppState } from "./useAppState"
import type { ProjectTab } from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { getErrorMessage } from "@/features/context/utils"
import { cleanupNativeDrop } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { useCallback } from "react"

type AppSettings = ReturnType<typeof useAppSettings>

export function useApplyRouting(state: AppState, appSettings: AppSettings) {
	const { isRoutingApplyRef, setGlobalNotice, setIsRoutingApply, setRoutingApplyTabId, tabsRef } = state
	const routeApplyDrop = useCallback(async (
		sourceTabId: string,
		paths: string[],
		temporaryRoot: string | null,
	): Promise<void> => {
		if (isRoutingApplyRef.current) {
			if (temporaryRoot !== null)
				await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
			setGlobalNotice({
				kind: "info",
				message: translate(
					appSettings.locale,
					"workspace.applyBusy",
				),
			})
			return
		}
		const tab = tabsRef.current.find(entry => entry.id === sourceTabId)
		if (tab?.rootFolder === null || tab?.rootFolder === undefined) {
			if (temporaryRoot !== null)
				await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
			setGlobalNotice({
				kind: "warning",
				message: translate(
					appSettings.locale,
					"workspace.selectRootForApply",
				),
			})
			return
		}
		const sourceTab: ProjectTab & { rootFolder: string } = { ...tab, rootFolder: tab.rootFolder }
		const uniquePaths = [...new Set(paths)]
		if (uniquePaths.length === 0) {
			if (temporaryRoot !== null)
				await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
			return
		}
		isRoutingApplyRef.current = true
		setIsRoutingApply(true)
		setRoutingApplyTabId(sourceTabId)
		setGlobalNotice(null)
		try {
			if (appSettings.workMode === "git") {
				await routeGitApply(
					state,
					appSettings,
					sourceTab,
					uniquePaths,
				)
			} else {
				await routeFilesApply(
					state,
					appSettings,
					sourceTab,
					uniquePaths,
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
		} finally {
			isRoutingApplyRef.current = false
			setIsRoutingApply(false)
			setRoutingApplyTabId(null)
			if (temporaryRoot !== null)
				await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
		}
	}, [appSettings, isRoutingApplyRef, setGlobalNotice, setIsRoutingApply, setRoutingApplyTabId, state, tabsRef])
	return { routeApplyDrop }
}
