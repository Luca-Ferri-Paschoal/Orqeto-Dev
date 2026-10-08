import {
	MIN_THUMB_SIZE,
	SCROLL_EPSILON,
	THUMB_CROSS_AXIS_OFFSET,
	TRACK_INSET,
} from "./constants"
import type {
	Axis,
	OverlayController,
} from "./types"

function getAxisOverflow(element: HTMLElement, axis: Axis): string {
	const computedStyle = window.getComputedStyle(element)
	return axis === "vertical" ?
		computedStyle.overflowY :
		computedStyle.overflowX
}

export function isAxisScrollable(element: HTMLElement, axis: Axis): boolean {
	const overflow = getAxisOverflow(
		element,
		axis,
	)
	if (overflow === "hidden" || overflow === "clip" || overflow === "visible")
		return false
	return axis === "vertical" ?
		element.scrollHeight - element.clientHeight > SCROLL_EPSILON :
		element.scrollWidth - element.clientWidth > SCROLL_EPSILON
}

export function isElementUnavailable(element: HTMLElement): boolean {
	return element.closest('[hidden], [inert], [aria-hidden="true"]') !== null
}

export function isOutsideViewport(rect: DOMRect): boolean {
	return rect.right <= 0 ||
		rect.left >= window.innerWidth ||
		rect.bottom <= 0 ||
		rect.top >= window.innerHeight
}

export function createThumb(axis: Axis): HTMLDivElement {
	const thumb = document.createElement("div")
	thumb.className = `orqeto-overlay-scrollbar-thumb orqeto-overlay-scrollbar-thumb--${axis}`
	thumb.setAttribute(
		"aria-hidden",
		"true",
	)
	document.body.appendChild(thumb)
	return thumb
}

export function getThumb(controller: OverlayController, axis: Axis): HTMLDivElement {
	return axis === "vertical" ?
		controller.verticalThumb :
		controller.horizontalThumb
}

export function getPointerPosition(event: PointerEvent, axis: Axis): number {
	return axis === "vertical" ?
		event.clientY :
		event.clientX
}

export function getScrollPosition(element: HTMLElement, axis: Axis): number {
	return axis === "vertical" ?
		element.scrollTop :
		element.scrollLeft
}

export function setScrollPosition(element: HTMLElement, axis: Axis, position: number): void {
	if (axis === "vertical")
		element.scrollTop = position
	else
		element.scrollLeft = position
}

export function getScrollRange(element: HTMLElement, axis: Axis): number {
	return axis === "vertical" ?
		element.scrollHeight - element.clientHeight :
		element.scrollWidth - element.clientWidth
}

export function getThumbTravel(controller: OverlayController, axis: Axis): number {
	const rect = controller.element.getBoundingClientRect()
	const trackLength = axis === "vertical" ?
		rect.height - TRACK_INSET * 2 :
		rect.width - TRACK_INSET * 2
	const thumbRect = getThumb(
		controller,
		axis,
	).getBoundingClientRect()
	const thumbLength = axis === "vertical" ?
		thumbRect.height :
		thumbRect.width
	return Math.max(
		0,
		trackLength - thumbLength,
	)
}

function hideUnavailableThumb(thumb: HTMLDivElement): void {
	thumb.hidden = true
	thumb.classList.remove(
		"is-visible",
		"is-hovered",
		"is-dragging",
	)
}

function positionThumb(controller: OverlayController, axis: Axis): void {
	const { element } = controller
	const thumb = getThumb(
		controller,
		axis,
	)
	if (isElementUnavailable(element) || !isAxisScrollable(
		element,
		axis,
	)) {
		hideUnavailableThumb(thumb)
		return
	}
	const rect = element.getBoundingClientRect()
	if (rect.width <= 0 || rect.height <= 0 || isOutsideViewport(rect)) {
		hideUnavailableThumb(thumb)
		return
	}
	const clientLength = axis === "vertical" ?
		element.clientHeight :
		element.clientWidth
	const scrollLength = axis === "vertical" ?
		element.scrollHeight :
		element.scrollWidth
	const trackLength = Math.max(
		0,
		(axis === "vertical" ?
			rect.height :
			rect.width) - TRACK_INSET * 2,
	)
	const scrollRange = scrollLength - clientLength
	const thumbLength = Math.min(
		trackLength,
		Math.max(
			MIN_THUMB_SIZE,
			trackLength * (clientLength / scrollLength),
		),
	)
	const thumbTravel = Math.max(
		0,
		trackLength - thumbLength,
	)
	const scrollPosition = axis === "vertical" ?
		element.scrollTop :
		element.scrollLeft
	const progress = scrollRange > 0 ?
		scrollPosition / scrollRange :
		0
	thumb.hidden = false
	if (axis === "vertical") {
		thumb.style.top = `${rect.top + TRACK_INSET + thumbTravel * progress}px`
		thumb.style.left = `${rect.right - TRACK_INSET - THUMB_CROSS_AXIS_OFFSET}px`
		thumb.style.height = `${thumbLength}px`
	} else {
		thumb.style.left = `${rect.left + TRACK_INSET + thumbTravel * progress}px`
		thumb.style.top = `${rect.bottom - TRACK_INSET - THUMB_CROSS_AXIS_OFFSET}px`
		thumb.style.width = `${thumbLength}px`
	}
}

export function updateController(controller: OverlayController): void {
	positionThumb(
		controller,
		"vertical",
	)
	positionThumb(
		controller,
		"horizontal",
	)
}
