import {
	getSourceLabel,
	withOnlyOverlayCandidates,
} from "../helpers"
import { chooseLocalFileDestination } from "./localFileApplyDecision"
import type { AppState } from "./useAppState"
import type { ProjectTab } from "@/features/context/types"
import type { useAppSettings } from "@/features/context/useAppSettings"
import { isGitPatchPath } from "@/features/context/utils"
import { prepareProjectOverlay } from "@/infra/desktop"
import { translate } from "@/infra/i18n"

type AppSettings = ReturnType<typeof useAppSettings>

/** No project enumeration: each input is prepared only against its initiating tab. */
export async function routeFilesApply(
	state: AppState,
	appSettings: AppSettings,
	sourceTab: ProjectTab & { rootFolder: string },
	uniquePaths: string[],
): Promise<void> {
	const { setGlobalNotice, tabsRef, workspaceHandlesRef } = state
	if (uniquePaths.some(isGitPatchPath)) {
		setGlobalNotice({
			kind: "warning",
			message: translate(
				appSettings.locale,
				"workspace.filesModePatchRejected",
			),
		})
		return
	}
	let appendUndo = false
	for (const path of uniquePaths) {
		const currentTab = tabsRef.current.find(tab => tab.id === sourceTab.id)
		const handle = workspaceHandlesRef.current.get(sourceTab.id)
		if (currentTab?.rootFolder !== sourceTab.rootFolder || handle?.canAcceptRoutedApply() !== true) {
			setGlobalNotice({
				kind: "warning",
				message: translate(
					appSettings.locale,
					"projectRoute.projectUnavailable",
				),
			})
			return
		}
		// The only destination inspected is the source tab's root. Preparation errors
		// (including invalid delete manifests) are intentionally not swallowed.
		const plan = await prepareProjectOverlay(
			sourceTab.rootFolder,
			[path],
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
		const decision = chooseLocalFileDestination(plan)
		if (decision.kind === "tooAmbiguous") {
			setGlobalNotice({
				kind: "warning",
				message: translate(appSettings.locale, "workspace.applyTooAmbiguous", {
					source: getSourceLabel(path),
					count: plan.candidateCount,
					limit: plan.ambiguityLimit,
				}),
			})
			return
		}
		if (decision.kind === "unavailable") {
			setGlobalNotice({
				kind: "warning",
				message: translate(
					appSettings.locale,
					"projectRoute.noDestination",
				),
			})
			return
		}
		const outcome = decision.kind === "direct" ?
			await handle.applyPreparedOverlay(
				[path],
				decision.candidate,
				plan.sourceFingerprint,
				plan.routingFingerprint,
				appendUndo,
			) :
			await handle.beginPreparedOverlayResolution(
				[path],
				getSourceLabel(path),
				withOnlyOverlayCandidates(
					plan,
					decision.candidates,
				),
				appendUndo,
			)
		if (outcome.status === "success" && outcome.undoReference !== null)
			appendUndo = true
	}
}
