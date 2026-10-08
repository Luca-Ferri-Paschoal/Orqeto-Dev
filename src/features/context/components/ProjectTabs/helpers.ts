import type { ProjectTab } from "../../types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function getTabLabel(tab: ProjectTab, locale: Locale): string {
	if (tab.rootFolder === null) {
		return translate(
			locale,
			"tabs.empty",
		)
	}
	const normalized = tab.rootFolder.replaceAll(
		"\\",
		"/",
	).replace(
		/\/+$/,
		"",
	)
	return normalized.split("/").filter(Boolean).at(-1) ?? tab.rootFolder
}

export function getInsertionIndex(
	tabs: readonly ProjectTab[],
	tabElements: ReadonlyMap<string, HTMLDivElement>,
	sourceId: string,
	clientX: number,
): number {
	let insertionIndex = 0
	for (const tab of tabs) {
		if (tab.id === sourceId)
			continue
		const element = tabElements.get(tab.id)
		if (element === undefined)
			continue
		const bounds = element.getBoundingClientRect()
		if (clientX < bounds.left + bounds.width / 2)
			return insertionIndex
		insertionIndex++
	}
	return insertionIndex
}
