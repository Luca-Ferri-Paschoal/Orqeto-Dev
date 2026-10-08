import {
	containsPhysicalPosition,
	type PhysicalPosition,
} from "@/shared/dom/physicalPosition"

export type DropTarget = | "contextAdd" |
	"contextRemove" |
	"apply" |
	"applyTab" |
	"ignoreAdd" |
	"ignoreRemove"

export interface NativeDropPayload {
	type: "enter" | "over" | "leave" | "drop"
	position?: PhysicalPosition
	paths?: string[]
	temporaryRoot?: string | null
}

const DRAG_AUTO_SCROLL_EDGE_PX = 72
const DRAG_AUTO_SCROLL_MAX_STEP_PX = 18
const PROJECT_TAB_APPLY_SELECTOR = "[data-project-tab-apply-target][data-project-tab-id]"

export function getProjectTabApplyTarget(position: PhysicalPosition): string | null {
	for (const element of document.querySelectorAll<HTMLElement>(PROJECT_TAB_APPLY_SELECTOR)) {
		if (!containsPhysicalPosition(
			element,
			position,
		))
			continue
		const tabId = element.dataset.projectTabId
		if (tabId !== undefined && tabId.length > 0)
			return tabId
	}
	return null
}

export function getDragAutoScrollStep(
	position: PhysicalPosition,
	scrollContainer: HTMLElement,
): number {
	const scaleFactor = window.devicePixelRatio || 1
	const clientY = position.y / scaleFactor
	const rect = scrollContainer.getBoundingClientRect()
	const visibleTop = Math.max(
		0,
		rect.top,
	)
	const visibleBottom = Math.min(
		window.innerHeight,
		rect.bottom,
	)
	const visibleHeight = Math.max(
		0,
		visibleBottom - visibleTop,
	)
	const edgeSize = Math.min(
		DRAG_AUTO_SCROLL_EDGE_PX,
		visibleHeight / 3,
	)
	if (edgeSize <= 0)
		return 0

	const topEdgeEnd = visibleTop + edgeSize
	if (clientY < topEdgeEnd) {
		const intensity = Math.min(
			1,
			Math.max(
				0,
				(topEdgeEnd - clientY) / edgeSize,
			),
		)
		return -Math.max(
			1,
			Math.round(DRAG_AUTO_SCROLL_MAX_STEP_PX * intensity * intensity),
		)
	}

	const bottomEdgeStart = visibleBottom - edgeSize
	if (clientY > bottomEdgeStart) {
		const intensity = Math.min(
			1,
			Math.max(
				0,
				(clientY - bottomEdgeStart) / edgeSize,
			),
		)
		return Math.max(
			1,
			Math.round(DRAG_AUTO_SCROLL_MAX_STEP_PX * intensity * intensity),
		)
	}
	return 0
}
