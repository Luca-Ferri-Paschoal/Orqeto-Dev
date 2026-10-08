import type { AppController } from "../controllers/useAppController"
import { ProjectTabs } from "@/features/context/components/ProjectTabs"

type Props = { controller: AppController; appReady: boolean }

export function AppProjectTabs({ controller, appReady }: Props) {
	const { appSettings, state } = controller
	if (!state.tabsReady || state.tabs.length === 0)
		return null
	return (
		<ProjectTabs
			tabs={state.tabs}
			activeTabId={state.activeTabId}
			locale={appSettings.locale}
			disabled={!appReady || state.ignoreDialogTabId !== null || state.isRoutingApply}
			onSelect={id => void controller.persistActiveTab(id)}
			onAdd={() => void controller.addTab()}
			onClose={id => void controller.closeTab(id)}
			onApplyDrop={(tabId, paths, temporaryRoot) => void controller.routeApplyDrop(
				tabId,
				paths,
				temporaryRoot,
			)}
			onMove={(
				sourceId,
				insertionIndex,
			) => void controller.moveTab(
				sourceId,
				insertionIndex,
			)}
		/>
	)
}
