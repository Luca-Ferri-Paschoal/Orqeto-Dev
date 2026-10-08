import { HIDE_DELAY_MS } from "./constants"
import { getThumb } from "./geometry"
import type {
	Axis,
	OverlayController,
} from "./types"

export function clearHideTimer(controller: OverlayController, axis: Axis): void {
	const key = axis === "vertical" ?
		"verticalHideTimer" :
		"horizontalHideTimer"
	const timer = controller[key]
	if (timer !== null) {
		clearTimeout(timer)
		controller[key] = null
	}
}

function isHovered(controller: OverlayController, axis: Axis): boolean {
	return axis === "vertical" ?
		controller.verticalHovered :
		controller.horizontalHovered
}

export function setHovered(controller: OverlayController, axis: Axis, value: boolean): void {
	if (axis === "vertical")
		controller.verticalHovered = value
	else
		controller.horizontalHovered = value
}

function hideAxis(controller: OverlayController, axis: Axis): void {
	if (isHovered(
		controller,
		axis,
	) || controller.dragState?.axis === axis)
		return
	getThumb(
		controller,
		axis,
	).classList.remove("is-visible")
}

export function scheduleHide(controller: OverlayController, axis: Axis): void {
	clearHideTimer(
		controller,
		axis,
	)
	const key = axis === "vertical" ?
		"verticalHideTimer" :
		"horizontalHideTimer"
	controller[key] = setTimeout(() => {
		controller[key] = null
		hideAxis(
			controller,
			axis,
		)
	}, HIDE_DELAY_MS)
}

export function revealAxis(controller: OverlayController, axis: Axis, keepVisible = false): void {
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
