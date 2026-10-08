import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "@/features/context/contextPathFilter"
import type { Locale } from "@/infra/i18n"
import type { Ref } from "react"

export interface DropZoneProps {
	addEnabled: boolean
	removeEnabled: boolean
	isAddDragging: boolean
	isRemoveDragging: boolean
	isProcessing: boolean
	locale: Locale
	filterPattern: string
	filterTarget: ContextFilterTarget
	filterMode: ContextFilterMode
	filterError: string | null
	filterHistory: readonly ContextFilterHistoryEntry[]
	pathsOnly: boolean
	detailsExpanded: boolean
	embedded?: boolean
	showDropTargets?: boolean
	showFilters?: boolean
	addElementRef?: Ref<HTMLElement>
	removeElementRef?: Ref<HTMLElement>
	onFilterPatternChange: (value: string) => void
	onFilterTargetChange: (value: ContextFilterTarget) => void
	onFilterModeChange: (value: ContextFilterMode) => void
	onFilterClear: () => void
	onFilterHistorySelect: (entry: ContextFilterHistoryEntry) => void
	onFilterHistoryDelete: (entry: ContextFilterHistoryEntry) => void
	onPathsOnlyChange: (value: boolean) => void
	onDetailsExpandedChange: (expanded: boolean) => void
}
