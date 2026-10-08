import { useActiveTabVisibility } from "./hooks/useActiveTabVisibility"
import { useProjectTabNativeDrop } from "./hooks/useProjectTabNativeDrop"
import { useProjectTabReorder } from "./hooks/useProjectTabReorder"
import { ProjectTabItem } from "./ProjectTabItem"
import { styles } from "./style"
import type { ProjectTabsProps } from "./types"
import { translate } from "@/infra/i18n"
import { Plus } from "lucide-react"
import { useRef } from "react"

export type { ProjectTabsProps } from "./types"

export function ProjectTabs({
	tabs,
	activeTabId,
	locale,
	disabled = false,
	onSelect,
	onAdd,
	onClose,
	onApplyDrop,
	onMove,
}: ProjectTabsProps) {
	const listRef = useRef<HTMLDivElement | null>(null)
	const tabRefs = useRef(new Map<string, HTMLDivElement>())
	useActiveTabVisibility(
		activeTabId,
		listRef,
		tabRefs,
	)
	const externalDropTabId = useProjectTabNativeDrop({ activeTabId, disabled, tabRefs, onSelect, onApplyDrop })
	const reorder = useProjectTabReorder(
		tabs,
		disabled,
		tabRefs,
		onMove,
		onSelect,
	)
	const canClose = tabs.length > 1
	let reorderableIndex = 0

	return (
		<div className={styles.root}>
			<div ref={listRef} role="tablist" aria-label={translate(
				locale,
				"tabs.aria",
			)} className={styles.list}>
				{tabs.map(tab => {
					const dragging = reorder.draggedTabId === tab.id
					const markerBefore = reorder.draggedTabId !== null && !dragging && reorder.insertionIndex === reorderableIndex
					if (!dragging)
						reorderableIndex++
					return (
						<ProjectTabItem
							key={tab.id}
							tab={tab}
							locale={locale}
							active={tab.id === activeTabId}
							dragging={dragging}
							externalDrop={externalDropTabId === tab.id}
							markerBefore={markerBefore}
							canClose={canClose}
							disabled={disabled}
							onRef={element => {
								if (element === null)
									tabRefs.current.delete(tab.id)
								else {
									tabRefs.current.set(
										tab.id,
										element,
									)
								}
							}}
							onSelect={() => reorder.handleSelect(tab.id)}
							onClose={() => onClose(tab.id)}
							onPointerDown={event => reorder.handlePointerDown(
								event,
								tab.id,
							)}
							onPointerMove={reorder.handlePointerMove}
							onPointerUp={reorder.finishPointerDrag}
							onPointerCancel={event => { reorder.cancelPointerDrag(event) }}
						/>
					)
				})}
				{reorder.draggedTabId !== null && reorder.insertionIndex === reorderableIndex && <div aria-hidden="true" className={styles.dropMarker} />}
			</div>
			<button type="button" aria-label={translate(
				locale,
				"tabs.add",
			)} title={translate(
				locale,
				"tabs.add",
			)} disabled={disabled} className={styles.addButton} onClick={onAdd}>
				<Plus size={15} aria-hidden="true" />
			</button>
		</div>
	)
}
