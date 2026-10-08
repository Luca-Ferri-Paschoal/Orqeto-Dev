import type { ProjectTab } from "../../../types"
import { getInsertionIndex } from "../helpers"
import {
	type MutableRefObject,
	type PointerEvent,
	useRef,
	useState,
} from "react"

interface PointerDragState {
	sourceId: string
	pointerId: number
	startX: number
	started: boolean
}
const DRAG_START_DISTANCE = 8

export function useProjectTabReorder(
	tabs: readonly ProjectTab[],
	disabled: boolean,
	tabRefs: MutableRefObject<Map<string, HTMLDivElement>>,
	onMove: (
		sourceId: string,
		insertionIndex: number,
	) => void,
	onSelect: (id: string) => void,
) {
	const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
	const [insertionIndex, setInsertionIndex] = useState<number | null>(null)
	const insertionIndexRef = useRef<number | null>(null)
	const pointerDragRef = useRef<PointerDragState | null>(null)
	const suppressedClickRef = useRef<string | null>(null)

	function updateInsertionPosition(sourceId: string, clientX: number): void {
		const next = getInsertionIndex(
			tabs,
			tabRefs.current,
			sourceId,
			clientX,
		)
		insertionIndexRef.current = next
		setInsertionIndex(next)
	}
	function handlePointerDown(event: PointerEvent<HTMLDivElement>, id: string): void {
		if (disabled || tabs.length < 2 || event.button !== 0 || event.pointerType === "touch")
			return
		if (event.target instanceof Element && event.target.closest("[data-project-tab-close]") !== null)
			return
		pointerDragRef.current = { sourceId: id, pointerId: event.pointerId, startX: event.clientX, started: false }
	}
	function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
		const drag = pointerDragRef.current
		if (drag === null || drag.pointerId !== event.pointerId)
			return
		if (!drag.started) {
			if (Math.abs(event.clientX - drag.startX) < DRAG_START_DISTANCE)
				return
			drag.started = true
			event.currentTarget.setPointerCapture(event.pointerId)
			setDraggedTabId(drag.sourceId)
		}
		event.preventDefault()
		updateInsertionPosition(
			drag.sourceId,
			event.clientX,
		)
	}
	function resetPointerDrag(event: PointerEvent<HTMLDivElement>): PointerDragState | null {
		const drag = pointerDragRef.current
		if (drag === null || drag.pointerId !== event.pointerId)
			return null
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId)
		pointerDragRef.current = null
		insertionIndexRef.current = null
		setDraggedTabId(null)
		setInsertionIndex(null)
		return drag
	}
	function finishPointerDrag(event: PointerEvent<HTMLDivElement>): void {
		const currentInsertionIndex = insertionIndexRef.current
		const drag = resetPointerDrag(event)
		if (drag === null || !drag.started)
			return
		suppressedClickRef.current = drag.sourceId
		window.setTimeout(() => {
			if (suppressedClickRef.current === drag.sourceId)
				suppressedClickRef.current = null
		}, 0)
		const finalIndex = currentInsertionIndex ?? getInsertionIndex(
			tabs,
			tabRefs.current,
			drag.sourceId,
			event.clientX,
		)
		onMove(
			drag.sourceId,
			finalIndex,
		)
	}
	function handleSelect(id: string): void {
		if (suppressedClickRef.current === id) {
			suppressedClickRef.current = null
			return
		}
		onSelect(id)
	}

	return {
		draggedTabId,
		insertionIndex,
		handlePointerDown,
		handlePointerMove,
		finishPointerDrag,
		cancelPointerDrag: resetPointerDrag,
		handleSelect,
	}
}
