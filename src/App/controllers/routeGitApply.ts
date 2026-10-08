import type { AppState } from "./useAppState"
import type { ProjectTab } from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import {
	getErrorMessage,
	isGitPatchPath,
} from "@/features/context/utils"
import {
	getGitPatchSourceFingerprint,
	getProjectAppliedSourceHistoryMatch,
	prepareGitPatch,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"

type AppSettings = ReturnType<typeof useAppSettings>

/** Strict Git preparation is performed only for the initiating project. */
export async function routeGitApply(
	state: AppState,
	appSettings: AppSettings,
	sourceTab: ProjectTab & { rootFolder: string },
	uniquePaths: string[],
): Promise<void> {
	const { setGlobalNotice, tabsRef, workspaceHandlesRef } = state
	if (uniquePaths.length !== 1) {
		setGlobalNotice({
			kind: "warning",
			message: translate(
				appSettings.locale,
				"workspace.gitModeSinglePatch",
			),
		})
		return
	}
	const patchPath = uniquePaths[0]
	if (patchPath === undefined || !isGitPatchPath(patchPath)) {
		setGlobalNotice({
			kind: "warning",
			message: translate(
				appSettings.locale,
				"workspace.gitModePatchOnly",
			),
		})
		return
	}
	const handle = workspaceHandlesRef.current.get(sourceTab.id)
	if (handle?.canAcceptRoutedApply() !== true) {
		setGlobalNotice({
			kind: "warning",
			message: translate(
				appSettings.locale,
				"projectRoute.projectUnavailable",
			),
		})
		return
	}
	try {
		const fingerprint = await getGitPatchSourceFingerprint(patchPath)
		const history = await getProjectAppliedSourceHistoryMatch(
			sourceTab.rootFolder,
			fingerprint,
			appSettings.overlayUndoHistoryLimit,
		).catch(() => null)
		const alreadyApplied = history?.kind === "latest" && history.currentlyApplied
		// Unlike cross-project discovery, local validation must surface its real error.
		const preview = alreadyApplied ?
			null :
			await prepareGitPatch(
				sourceTab.rootFolder,
				patchPath,
			)
		if (tabsRef.current.find(tab => tab.id === sourceTab.id)?.rootFolder !== sourceTab.rootFolder ||
			workspaceHandlesRef.current.get(sourceTab.id) !== handle || !handle.canAcceptRoutedApply()) {
			setGlobalNotice({
				kind: "warning",
				message: translate(
					appSettings.locale,
					"projectRoute.projectUnavailable",
				),
			})
			return
		}
		if (alreadyApplied) {
			setGlobalNotice({
				kind: "info",
				message: translate(
					appSettings.locale,
					"workspace.applyAlreadyApplied",
				),
			})
			return
		}
		if (preview !== null) {
			await handle.beginPreparedGitPatch(
				patchPath,
				preview,
			)
		}
	} catch (error) {
		setGlobalNotice({
			kind: "warning",
			message: translate(appSettings.locale, "workspace.gitPatchValidationFailed", {
				error: getErrorMessage(
					error,
					appSettings.locale,
				),
			}),
		})
	}
}
