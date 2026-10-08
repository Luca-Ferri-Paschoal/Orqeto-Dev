export type Axis = "horizontal" | "vertical"

export interface DragState {
	axis: Axis
	pointerId: number
	startPointerPosition: number
	startScrollPosition: number
}

export interface OverlayController {
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
