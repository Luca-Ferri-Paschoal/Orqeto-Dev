import {
	EDGE_REVEAL_DISTANCE,
	SCROLL_EPSILON,
} from "./constants"
import {
	createThumb,
	isAxisScrollable,
	updateController,
} from "./geometry"
import { attachThumbInteractions } from "./interactions"
import type { OverlayController } from "./types"
import {
	clearHideTimer,
	revealAxis,
} from "./visibility"

export function createController(element: HTMLElement, onGeometryChanged: () => void): OverlayController {
	const controller: OverlayController = {
		element,
		verticalThumb: createThumb("vertical"),
		horizontalThumb: createThumb("horizontal"),
		verticalHideTimer: null,
		horizontalHideTimer: null,
		verticalHovered: false,
		horizontalHovered: false,
		dragState: null,
		lastScrollTop: element.scrollTop,
		lastScrollLeft: element.scrollLeft,
		resizeObserver: new ResizeObserver(onGeometryChanged),
		cleanup: () => undefined,
	}
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
		window.requestAnimationFrame(() => updateController(controller))
	}
	function handlePointerMove(event: PointerEvent): void {
		const rect = element.getBoundingClientRect()
		if (isAxisScrollable(
			element,
			"vertical",
		) && event.clientX >= rect.right - EDGE_REVEAL_DISTANCE && event.clientX <= rect.right + 2) {
			revealAxis(
				controller,
				"vertical",
			)
		}
		if (isAxisScrollable(
			element,
			"horizontal",
		) && event.clientY >= rect.bottom - EDGE_REVEAL_DISTANCE && event.clientY <= rect.bottom + 2) {
			revealAxis(
				controller,
				"horizontal",
			)
		}
	}
	const cleanupVertical = attachThumbInteractions(
		controller,
		"vertical",
	)
	const cleanupHorizontal = attachThumbInteractions(
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
		cleanupVertical()
		cleanupHorizontal()
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
