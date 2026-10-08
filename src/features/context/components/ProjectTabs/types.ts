import type { ProjectTab } from "../../types"
import type { Locale } from "@/infra/i18n"

export interface ProjectTabsProps {
	tabs: readonly ProjectTab[]
	activeTabId: string
	locale: Locale
	disabled?: boolean
	onSelect: (id: string) => void
	onAdd: () => void
	onClose: (id: string) => void
	onApplyDrop: (
		tabId: string,
		paths: string[],
		temporaryRoot: string | null,
	) => void
	onMove: (
		sourceId: string,
		insertionIndex: number,
	) => void
}
