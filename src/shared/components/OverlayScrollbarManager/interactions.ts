import {
	getPointerPosition,
	getScrollPosition,
	getScrollRange,
	getThumb,
	getThumbTravel,
	setScrollPosition,
} from "./geometry"
import type {
	Axis,
	OverlayController,
} from "./types"
import {
	clearHideTimer,
	revealAxis,
	scheduleHide,
	setHovered,
} from "./visibility"

export function attachThumbInteractions(controller: OverlayController, axis: Axis): () => void {
	const thumb = getThumb(
		controller,
		axis,
	)
	function handlePointerEnter(): void {
		setHovered(
			controller,
			axis,
			true,
		)
		thumb.classList.add("is-hovered")
		revealAxis(
			controller,
			axis,
			true,
		)
	}
	function handlePointerLeave(): void {
		setHovered(
			controller,
			axis,
			false,
		)
		thumb.classList.remove("is-hovered")
		scheduleHide(
			controller,
			axis,
		)
	}
	function handlePointerDown(event: PointerEvent): void {
		if (event.button !== 0)
			return
		event.preventDefault()
		event.stopPropagation()
		controller.dragState = {
			axis,
			pointerId: event.pointerId,
			startPointerPosition: getPointerPosition(
				event,
				axis,
			),
			startScrollPosition: getScrollPosition(
				controller.element,
				axis,
			),
		}
		thumb.classList.add("is-dragging")
		document.body.classList.add("orqeto-overlay-scrollbar-dragging")
		clearHideTimer(
			controller,
			axis,
		)
		try { thumb.setPointerCapture(event.pointerId) } catch { /* detached mid-interaction */ }
	}
	function handlePointerMove(event: PointerEvent): void {
		const dragState = controller.dragState
		if (dragState === null || dragState.axis !== axis || dragState.pointerId !== event.pointerId)
			return
		event.preventDefault()
		const scrollRange = getScrollRange(
			controller.element,
			axis,
		)
		const thumbTravel = getThumbTravel(
			controller,
			axis,
		)
		if (scrollRange <= 0 || thumbTravel <= 0)
			return
		const pointerDelta = getPointerPosition(
			event,
			axis,
		) - dragState.startPointerPosition
		setScrollPosition(
			controller.element,
			axis,
			dragState.startScrollPosition + pointerDelta * (scrollRange / thumbTravel),
		)
	}
	function finishDrag(event: PointerEvent): void {
		const dragState = controller.dragState
		if (dragState === null || dragState.axis !== axis || dragState.pointerId !== event.pointerId)
			return
		controller.dragState = null
		thumb.classList.remove("is-dragging")
		document.body.classList.remove("orqeto-overlay-scrollbar-dragging")
		try { thumb.releasePointerCapture(event.pointerId) } catch { /* already released */ }
		scheduleHide(
			controller,
			axis,
		)
	}
	thumb.addEventListener(
		"pointerenter",
		handlePointerEnter,
	)
	thumb.addEventListener(
		"pointerleave",
		handlePointerLeave,
	)
	thumb.addEventListener(
		"pointerdown",
		handlePointerDown,
	)
	thumb.addEventListener(
		"pointermove",
		handlePointerMove,
	)
	thumb.addEventListener(
		"pointerup",
		finishDrag,
	)
	thumb.addEventListener(
		"pointercancel",
		finishDrag,
	)
	return () => {
		thumb.removeEventListener(
			"pointerenter",
			handlePointerEnter,
		)
		thumb.removeEventListener(
			"pointerleave",
			handlePointerLeave,
		)
		thumb.removeEventListener(
			"pointerdown",
			handlePointerDown,
		)
		thumb.removeEventListener(
			"pointermove",
			handlePointerMove,
		)
		thumb.removeEventListener(
			"pointerup",
			finishDrag,
		)
		thumb.removeEventListener(
			"pointercancel",
			finishDrag,
		)
	}
}
