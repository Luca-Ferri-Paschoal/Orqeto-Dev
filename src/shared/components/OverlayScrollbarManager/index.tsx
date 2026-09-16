import { useEffect } from "react"

const SCROLL_AREA_SELECTOR = ".orqeto-scroll-area"
const MIN_THUMB_SIZE = 28
const TRACK_INSET = 3
const THUMB_CROSS_AXIS_OFFSET = 3
const EDGE_REVEAL_DISTANCE = 16
const HIDE_DELAY_MS = 900
const SCROLL_EPSILON = 1

type Axis = "horizontal" | "vertical"

interface DragState {
	axis: Axis
	pointerId: number
	startPointerPosition: number
	startScrollPosition: number
}

interface OverlayController {
	element: HTMLElement
	verticalThumb: HTMLDivElement
	horizontalThumb: HTMLDivElement
	verticalHideTimer: ReturnType<typeof setTimeout> | null
	horizontalHideTimer: ReturnType<typeof setTimeout> | null
	verticalHovered: boolean
	horizontalHovered: boolean
	dragState: DragState | null
	lastScrollTop: number
	lastScrollLeft: number
	resizeObserver: ResizeObserver
	cleanup: () => void
}

function getAxisOverflow(
	element: HTMLElement,
	axis: Axis,
): string {
	const computedStyle = window.getComputedStyle(element)
	return axis === "vertical" ?
		computedStyle.overflowY :
		computedStyle.overflowX
}

function isAxisScrollable(
	element: HTMLElement,
	axis: Axis,
): boolean {
	const overflow = getAxisOverflow(
		element,
		axis,
	)
	if (
		overflow === "hidden" ||
		overflow === "clip" ||
		overflow === "visible"
	)
		return false

	return axis === "vertical" ?
		element.scrollHeight - element.clientHeight > SCROLL_EPSILON :
		element.scrollWidth - element.clientWidth > SCROLL_EPSILON
}

function isElementUnavailable(element: HTMLElement): boolean {
	return element.closest('[hidden], [inert], [aria-hidden="true"]') !== null
}

function isOutsideViewport(rect: DOMRect): boolean {
	return rect.right <= 0 ||
		rect.left >= window.innerWidth ||
		rect.bottom <= 0 ||
		rect.top >= window.innerHeight
}

function createThumb(axis: Axis): HTMLDivElement {
	const thumb = document.createElement("div")
	thumb.className = `orqeto-overlay-scrollbar-thumb orqeto-overlay-scrollbar-thumb--${axis}`
	thumb.setAttribute(
		"aria-hidden",
		"true",
	)
	document.body.appendChild(thumb)
	return thumb
}

function clearHideTimer(
	controller: OverlayController,
	axis: Axis,
): void {
	const key = axis === "vertical" ?
		"verticalHideTimer" :
		"horizontalHideTimer"
	const timer = controller[key]
	if (timer !== null) {
		clearTimeout(timer)
		controller[key] = null
	}
}

function getThumb(
	controller: OverlayController,
	axis: Axis,
): HTMLDivElement {
	return axis === "vertical" ?
		controller.verticalThumb :
		controller.horizontalThumb
}

function isHovered(
	controller: OverlayController,
	axis: Axis,
): boolean {
	return axis === "vertical" ?
		controller.verticalHovered :
		controller.horizontalHovered
}

function setHovered(
	controller: OverlayController,
	axis: Axis,
	value: boolean,
): void {
	if (axis === "vertical")
		controller.verticalHovered = value
	else
		controller.horizontalHovered = value
}

function hideAxis(
	controller: OverlayController,
	axis: Axis,
): void {
	if (
		isHovered(
			controller,
			axis,
		) ||
		controller.dragState?.axis === axis
	)
		return

	getThumb(
		controller,
		axis,
	).classList.remove("is-visible")
}

function scheduleHide(
	controller: OverlayController,
	axis: Axis,
): void {
	clearHideTimer(
		controller,
		axis,
	)

	const key = axis === "vertical" ?
		"verticalHideTimer" :
		"horizontalHideTimer"
	controller[key] = setTimeout(
		() => {
			controller[key] = null
			hideAxis(
				controller,
				axis,
			)
		},
		HIDE_DELAY_MS,
	)
}

function revealAxis(
	controller: OverlayController,
	axis: Axis,
	keepVisible = false,
): void {
	const thumb = getThumb(
		controller,
		axis,
	)
	if (thumb.hidden)
		return

	thumb.classList.add("is-visible")
	clearHideTimer(
		controller,
		axis,
	)
	if (!keepVisible) {
		scheduleHide(
			controller,
			axis,
		)
	}
}

function hideUnavailableThumb(thumb: HTMLDivElement): void {
	thumb.hidden = true
	thumb.classList.remove(
		"is-visible",
		"is-hovered",
		"is-dragging",
	)
}

function positionVerticalThumb(controller: OverlayController): void {
	const {
		element,
		verticalThumb: thumb,
	} = controller
	if (isElementUnavailable(element)) {
		hideUnavailableThumb(thumb)
		return
	}

	if (!isAxisScrollable(
		element,
		"vertical",
	)) {
		hideUnavailableThumb(thumb)
		return
	}

	const rect = element.getBoundingClientRect()
	if (
		rect.width <= 0 ||
		rect.height <= 0 ||
		isOutsideViewport(rect)
	) {
		hideUnavailableThumb(thumb)
		return
	}

	const trackLength = Math.max(
		0,
		rect.height - TRACK_INSET * 2,
	)
	const scrollRange = element.scrollHeight - element.clientHeight
	const thumbLength = Math.min(
		trackLength,
		Math.max(
			MIN_THUMB_SIZE,
			trackLength * (element.clientHeight / element.scrollHeight),
		),
	)
	const thumbTravel = Math.max(
		0,
		trackLength - thumbLength,
	)
	const progress = scrollRange > 0 ?
		element.scrollTop / scrollRange :
		0
	const top = rect.top + TRACK_INSET + thumbTravel * progress

	thumb.hidden = false
	thumb.style.top = `${top}px`
	thumb.style.left = `${rect.right - TRACK_INSET - THUMB_CROSS_AXIS_OFFSET}px`
	thumb.style.height = `${thumbLength}px`
}

function positionHorizontalThumb(controller: OverlayController): void {
	const {
		element,
		horizontalThumb: thumb,
	} = controller
	if (isElementUnavailable(element)) {
		hideUnavailableThumb(thumb)
		return
	}

	if (!isAxisScrollable(
		element,
		"horizontal",
	)) {
		hideUnavailableThumb(thumb)
		return
	}

	const rect = element.getBoundingClientRect()
	if (
		rect.width <= 0 ||
		rect.height <= 0 ||
		isOutsideViewport(rect)
	) {
		hideUnavailableThumb(thumb)
		return
	}

	const trackLength = Math.max(
		0,
		rect.width - TRACK_INSET * 2,
	)
	const scrollRange = element.scrollWidth - element.clientWidth
	const thumbLength = Math.min(
		trackLength,
		Math.max(
			MIN_THUMB_SIZE,
			trackLength * (element.clientWidth / element.scrollWidth),
		),
	)
	const thumbTravel = Math.max(
		0,
		trackLength - thumbLength,
	)
	const progress = scrollRange > 0 ?
		element.scrollLeft / scrollRange :
		0
	const left = rect.left + TRACK_INSET + thumbTravel * progress

	thumb.hidden = false
	thumb.style.left = `${left}px`
	thumb.style.top = `${rect.bottom - TRACK_INSET - THUMB_CROSS_AXIS_OFFSET}px`
	thumb.style.width = `${thumbLength}px`
}

function updateController(controller: OverlayController): void {
	positionVerticalThumb(controller)
	positionHorizontalThumb(controller)
}

function getPointerPosition(
	event: PointerEvent,
	axis: Axis,
): number {
	return axis === "vertical" ?
		event.clientY :
		event.clientX
}

function getScrollPosition(
	element: HTMLElement,
	axis: Axis,
): number {
	return axis === "vertical" ?
		element.scrollTop :
		element.scrollLeft
}

function setScrollPosition(
	element: HTMLElement,
	axis: Axis,
	position: number,
): void {
	if (axis === "vertical")
		element.scrollTop = position
	else
		element.scrollLeft = position
}

function getScrollRange(
	element: HTMLElement,
	axis: Axis,
): number {
	return axis === "vertical" ?
		element.scrollHeight - element.clientHeight :
		element.scrollWidth - element.clientWidth
}

function getThumbTravel(
	controller: OverlayController,
	axis: Axis,
): number {
	const rect = controller.element.getBoundingClientRect()
	const trackLength = axis === "vertical" ?
		rect.height - TRACK_INSET * 2 :
		rect.width - TRACK_INSET * 2
	const thumb = getThumb(
		controller,
		axis,
	)
	const thumbLength = axis === "vertical" ?
		thumb.getBoundingClientRect().height :
		thumb.getBoundingClientRect().width
	return Math.max(
		0,
		trackLength - thumbLength,
	)
}

function attachThumbInteractions(
	controller: OverlayController,
	axis: Axis,
): () => void {
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
		try {
			thumb.setPointerCapture(event.pointerId)
		} catch {
			// Pointer capture can fail if the element is detached mid-interaction.
		}
	}

	function handlePointerMove(event: PointerEvent): void {
		const dragState = controller.dragState
		if (
			dragState === null ||
			dragState.axis !== axis ||
			dragState.pointerId !== event.pointerId
		)
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
		if (
			scrollRange <= 0 ||
			thumbTravel <= 0
		)
			return

		const pointerDelta = getPointerPosition(
			event,
			axis,
		) - dragState.startPointerPosition
		const scrollDelta = pointerDelta * (scrollRange / thumbTravel)
		setScrollPosition(
			controller.element,
			axis,
			dragState.startScrollPosition + scrollDelta,
		)
	}

	function finishDrag(event: PointerEvent): void {
		const dragState = controller.dragState
		if (
			dragState === null ||
			dragState.axis !== axis ||
			dragState.pointerId !== event.pointerId
		)
			return

		controller.dragState = null
		thumb.classList.remove("is-dragging")
		document.body.classList.remove("orqeto-overlay-scrollbar-dragging")
		try {
			thumb.releasePointerCapture(event.pointerId)
		} catch {
			// The pointer may already have been released by the webview.
		}
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

function createController(
	element: HTMLElement,
	onGeometryChanged: () => void,
): OverlayController {
	const controller = {} as OverlayController
	controller.element = element
	controller.verticalThumb = createThumb("vertical")
	controller.horizontalThumb = createThumb("horizontal")
	controller.verticalHideTimer = null
	controller.horizontalHideTimer = null
	controller.verticalHovered = false
	controller.horizontalHovered = false
	controller.dragState = null
	controller.lastScrollTop = element.scrollTop
	controller.lastScrollLeft = element.scrollLeft
	controller.resizeObserver = new ResizeObserver(onGeometryChanged)

	function handleScroll(): void {
		const nextScrollTop = element.scrollTop
		const nextScrollLeft = element.scrollLeft
		if (Math.abs(nextScrollTop - controller.lastScrollTop) > SCROLL_EPSILON) {
			controller.lastScrollTop = nextScrollTop
			revealAxis(
				controller,
				"vertical",
			)
		}
		if (Math.abs(nextScrollLeft - controller.lastScrollLeft) > SCROLL_EPSILON) {
			controller.lastScrollLeft = nextScrollLeft
			revealAxis(
				controller,
				"horizontal",
			)
		}
		updateController(controller)
	}

	function handleWheel(): void {
		window.requestAnimationFrame(() => {
			updateController(controller)
		})
	}

	function handlePointerMove(event: PointerEvent): void {
		const rect = element.getBoundingClientRect()
		if (
			isAxisScrollable(
				element,
				"vertical",
			) &&
			event.clientX >= rect.right - EDGE_REVEAL_DISTANCE &&
			event.clientX <= rect.right + 2
		) {
			revealAxis(
				controller,
				"vertical",
			)
		}
		if (
			isAxisScrollable(
				element,
				"horizontal",
			) &&
			event.clientY >= rect.bottom - EDGE_REVEAL_DISTANCE &&
			event.clientY <= rect.bottom + 2
		) {
			revealAxis(
				controller,
				"horizontal",
			)
		}
	}

	const cleanupVerticalInteractions = attachThumbInteractions(
		controller,
		"vertical",
	)
	const cleanupHorizontalInteractions = attachThumbInteractions(
		controller,
		"horizontal",
	)

	element.addEventListener(
		"scroll",
		handleScroll,
		{ passive: true },
	)
	element.addEventListener(
		"wheel",
		handleWheel,
		{ passive: true },
	)
	element.addEventListener(
		"pointermove",
		handlePointerMove,
		{ passive: true },
	)
	controller.resizeObserver.observe(element)

	controller.cleanup = () => {
		clearHideTimer(
			controller,
			"vertical",
		)
		clearHideTimer(
			controller,
			"horizontal",
		)
		cleanupVerticalInteractions()
		cleanupHorizontalInteractions()
		element.removeEventListener(
			"scroll",
			handleScroll,
		)
		element.removeEventListener(
			"wheel",
			handleWheel,
		)
		element.removeEventListener(
			"pointermove",
			handlePointerMove,
		)
		controller.resizeObserver.disconnect()
		controller.verticalThumb.remove()
		controller.horizontalThumb.remove()
		if (controller.dragState !== null)
			document.body.classList.remove("orqeto-overlay-scrollbar-dragging")
	}

	updateController(controller)
	return controller
}

export default function OverlayScrollbarManager() {
	useEffect(() => {
		const controllers = new Map<HTMLElement, OverlayController>()
		let animationFrame: number | null = null
		let synchronizationFrame: number | null = null

		function updateAll(): void {
			animationFrame = null
			controllers.forEach(controller => {
				updateController(controller)
			})
		}

		function scheduleUpdateAll(): void {
			if (animationFrame !== null)
				return
			animationFrame = window.requestAnimationFrame(updateAll)
		}

		function synchronizeControllers(): void {
			synchronizationFrame = null
			const currentElements = new Set(document.querySelectorAll<HTMLElement>(SCROLL_AREA_SELECTOR))

			currentElements.forEach(element => {
				if (!controllers.has(element)) {
					controllers.set(
						element,
						createController(
							element,
							scheduleUpdateAll,
						),
					)
				}
			})

			controllers.forEach((controller, element) => {
				if (
					!element.isConnected ||
					!currentElements.has(element)
				) {
					controller.cleanup()
					controllers.delete(element)
				}
			})

			scheduleUpdateAll()
		}

		function scheduleSynchronization(): void {
			if (synchronizationFrame !== null)
				return

			synchronizationFrame = window.requestAnimationFrame(synchronizeControllers)
		}

		const mutationObserver = new MutationObserver(scheduleSynchronization)
		mutationObserver.observe(
			document.body,
			{
				attributes: true,
				attributeFilter: [
					"aria-hidden",
					"hidden",
					"inert",
				],
				childList: true,
				subtree: true,
			},
		)

		function handleDocumentScroll(): void {
			// A scrollable area can move another scrollable area's viewport.
			// Reposition every overlay thumb so nested horizontal scrollbars
			// never remain floating over unrelated content.
			scheduleUpdateAll()
		}

		synchronizeControllers()
		window.addEventListener(
			"resize",
			scheduleUpdateAll,
			{ passive: true },
		)
		document.addEventListener(
			"scroll",
			handleDocumentScroll,
			true,
		)

		return () => {
			mutationObserver.disconnect()
			window.removeEventListener(
				"resize",
				scheduleUpdateAll,
			)
			document.removeEventListener(
				"scroll",
				handleDocumentScroll,
				true,
			)
			if (animationFrame !== null)
				window.cancelAnimationFrame(animationFrame)
			if (synchronizationFrame !== null)
				window.cancelAnimationFrame(synchronizationFrame)
			controllers.forEach(controller => {
				controller.cleanup()
			})
			controllers.clear()
		}
	}, [])

	return null
}
