import {
	setSetting,
	settingKeys,
} from "./shared"
import type {
	ProjectSection,
	ProjectTab,
} from "@/domain/appSettings"
import { invoke } from "@tauri-apps/api/core"

interface ProjectTabRow {
	id: string
	rootFolder: string | null
	position: number
	folderSectionExpanded: number
	contextSectionExpanded: number
	applySectionExpanded: number
}

let projectTabWriteQueue: Promise<void> = Promise.resolve()
async function enqueueProjectTabWrite<T>(operation: () => Promise<T>): Promise<T> {
	const result = projectTabWriteQueue.catch(() => undefined).then(operation)
	projectTabWriteQueue = result.then(
		() => undefined,
		() => undefined,
	)
	return result
}

export async function flushProjectTabWrites(): Promise<void> {
	while (true) {
		const pending = projectTabWriteQueue
		await pending.catch(() => undefined)
		if (projectTabWriteQueue === pending)
			return
	}
}

export async function getProjectTabs(): Promise<ProjectTab[]> {
	const rows = await invoke<ProjectTabRow[]>("config_get_project_tabs")
	return rows.map(row => ({
		id: row.id,
		rootFolder: row.rootFolder,
		folderSectionExpanded: row.folderSectionExpanded !== 0,
		contextSectionExpanded: row.contextSectionExpanded !== 0,
		applySectionExpanded: row.applySectionExpanded !== 0,
	}))
}
export const getActiveProjectTabId = () => invoke<string | null>("config_get_active_project_tab_id")
export async function upsertProjectTab(tab: ProjectTab, position: number): Promise<void> {
	await enqueueProjectTabWrite(() => invoke(
		"config_upsert_project_tab",
		{ tab, position },
	))
}
export async function deleteProjectTab(id: string): Promise<void> {
	await enqueueProjectTabWrite(() => invoke(
		"config_delete_project_tab",
		{ id },
	))
}
export async function saveProjectTabOrder(ids: readonly string[]): Promise<void> {
	if (ids.length > 0) {
		await enqueueProjectTabWrite(() => invoke(
			"config_save_project_tab_order",
			{ ids: [...ids] },
		))
	}
}
export async function setProjectTabSectionExpanded(id: string, section: ProjectSection, expanded: boolean): Promise<void> {
	await enqueueProjectTabWrite(() => invoke(
		"config_set_project_tab_section_expanded",
		{ id, section, expanded },
	))
}
export async function setActiveProjectTabId(id: string): Promise<void> {
	await enqueueProjectTabWrite(() => setSetting(
		settingKeys.activeProjectTabId,
		id,
	))
}
