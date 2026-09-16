import type { ProjectTab } from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import {
	containsPhysicalPosition,
	type PhysicalPosition,
} from "@/shared/dom/physicalPosition"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
	Plus,
	X,
} from "lucide-react"
import {
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react"

interface ProjectTabsProps {
	tabs: readonly ProjectTab[]
	activeTabId: string
	locale: Locale
	disabled?: boolean
	onSelect: (id: string) => void
	onAdd: () => void
	onClose: (id: string) => void
	onMove: (
		sourceId: string,
		insertionIndex: number,
	) => void
}

interface PointerDragState {
	sourceId: string
	pointerId: number
	startX: number
	started: boolean
}

interface NativeDropPayload {
	type: "enter" | "over" | "leave" | "drop"
	position?: PhysicalPosition
}

const DRAG_START_DISTANCE = 8
const EXTERNAL_DRAG_TAB_SWITCH_DELAY_MS = 250

function getTabLabel(
	tab: ProjectTab,
	locale: Locale,
): string {
	if (tab.rootFolder === null) {
		return translate(
			locale,
			"tabs.empty",
		)
	}

	const normalized = tab.rootFolder
		.replaceAll("\\", "/")
		.replace(/\/+$/, "")
	const segments = normalized
		.split("/")
		.filter(segment => segment.length > 0)

	return segments.at(-1) ?? tab.rootFolder
}

function getInsertionIndex(
	tabs: readonly ProjectTab[],
	tabElements: ReadonlyMap<string, HTMLDivElement>,
	sourceId: string,
	clientX: number,
): number {
	let insertionIndex = 0

	for (const tab of tabs) {
		if (tab.id === sourceId)
			continue

		const element = tabElements.get(tab.id)

		if (element === undefined)
			continue

		const bounds = element.getBoundingClientRect()
		const midpoint = bounds.left + bounds.width / 2

		if (clientX < midpoint)
			return insertionIndex

		insertionIndex++
	}

	return insertionIndex
}

export function ProjectTabs({
	tabs,
	activeTabId,
	locale,
	disabled = false,
	onSelect,
	onAdd,
	onClose,
	onMove,
}: ProjectTabsProps) {
	const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
	const [insertionIndex, setInsertionIndex] = useState<number | null>(null)
	const insertionIndexRef = useRef<number | null>(null)
	const listRef = useRef<HTMLDivElement | null>(null)
	const tabRefs = useRef(new Map<string, HTMLDivElement>())
	const pointerDragRef = useRef<PointerDragState | null>(null)
	const suppressedClickRef = useRef<string | null>(null)
	const externalHoverTabRef = useRef<string | null>(null)
	const externalHoverTimerRef = useRef<number | null>(null)
	const activeTabIdRef = useRef(activeTabId)
	const disabledRef = useRef(disabled)
	const onSelectRef = useRef(onSelect)
	const canClose = tabs.length > 1

	useEffect(
		() => {
			activeTabIdRef.current = activeTabId
			disabledRef.current = disabled
			onSelectRef.current = onSelect
		},
		[
			activeTabId,
			disabled,
			onSelect,
		],
	)

	useEffect(
		() => {
			const list = listRef.current
			const tab = tabRefs.current.get(activeTabId)

			if (list === null || tab === undefined)
				return

			const listBounds = list.getBoundingClientRect()
			const tabBounds = tab.getBoundingClientRect()
			const hiddenOnLeft = tabBounds.left - listBounds.left
			const hiddenOnRight = tabBounds.right - listBounds.right

			if (hiddenOnLeft < 0)
				list.scrollLeft += hiddenOnLeft
			else if (hiddenOnRight > 0)
				list.scrollLeft += hiddenOnRight
		},
		[activeTabId],
	)

	useEffect(
		() => {
			const element = listRef.current

			if (element === null)
				return

			const scrollElement: HTMLDivElement = element

			function handleHorizontalWheel(event: globalThis.WheelEvent): void {
				const maximumScrollLeft = scrollElement.scrollWidth - scrollElement.clientWidth

				if (maximumScrollLeft <= 1)
					return

				// While the tab strip actually overflows, the wheel belongs to the
				// strip. Consume it even at either horizontal edge so the same
				// gesture never leaks into the page's vertical scroller.
				event.preventDefault()
				event.stopPropagation()

				const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ?
					event.deltaY :
					event.deltaX

				if (delta === 0)
					return

				scrollElement.scrollLeft = Math.max(
					0,
					Math.min(
						maximumScrollLeft,
						scrollElement.scrollLeft + delta,
					),
				)
			}

			scrollElement.addEventListener(
				"wheel",
				handleHorizontalWheel,
				{ passive: false },
			)

			return () => {
				scrollElement.removeEventListener(
					"wheel",
					handleHorizontalWheel,
				)
			}
		},
		[],
	)

	useEffect(
		() => {
			let cancelled = false
			let unlistenTauri: (() => void) | undefined
			let unlistenNative: (() => void) | undefined

			function cancelExternalHover(): void {
				if (externalHoverTimerRef.current !== null) {
					window.clearTimeout(externalHoverTimerRef.current)
					externalHoverTimerRef.current = null
				}

				externalHoverTabRef.current = null
			}

			function handlePhysicalPosition(position: PhysicalPosition): void {
				if (disabledRef.current) {
					cancelExternalHover()
					return
				}

				let hoveredTabId: string | null = null

				for (const [tabId, element] of tabRefs.current) {
					if (containsPhysicalPosition(
						element,
						position,
					)) {
						hoveredTabId = tabId
						break
					}
				}

				if (
					hoveredTabId === null ||
					hoveredTabId === activeTabIdRef.current
				) {
					cancelExternalHover()
					return
				}

				if (externalHoverTabRef.current === hoveredTabId)
					return

				cancelExternalHover()
				externalHoverTabRef.current = hoveredTabId
				externalHoverTimerRef.current = window.setTimeout(
					() => {
						if (externalHoverTabRef.current !== hoveredTabId)
							return

						externalHoverTimerRef.current = null
						externalHoverTabRef.current = null

						if (activeTabIdRef.current !== hoveredTabId)
							onSelectRef.current(hoveredTabId)
					},
					EXTERNAL_DRAG_TAB_SWITCH_DELAY_MS,
				)
			}

			function disposeListeners(): void {
				const tauriDisposer = unlistenTauri
				const nativeDisposer = unlistenNative
				unlistenTauri = undefined
				unlistenNative = undefined
				tauriDisposer?.()
				nativeDisposer?.()
			}

			async function subscribe(): Promise<void> {
				try {
					const tauriDisposer = await getCurrentWindow().onDragDropEvent(event => {
						if (
							event.payload.type === "leave" ||
							event.payload.type === "drop"
						) {
							cancelExternalHover()
							return
						}

						handlePhysicalPosition(event.payload.position)
					})

					if (cancelled) {
						tauriDisposer()
						return
					}

					unlistenTauri = tauriDisposer
					const nativeDisposer = await listen<NativeDropPayload>(
						"native-drag-drop",
						event => {
							const payload = event.payload

							if (
								payload.type === "leave" ||
								payload.type === "drop"
							) {
								cancelExternalHover()
								return
							}

							if (payload.position !== undefined)
								handlePhysicalPosition(payload.position)
						},
					)

					if (cancelled) {
						nativeDisposer()
						return
					}

					unlistenNative = nativeDisposer
				} catch {
					disposeListeners()
					cancelExternalHover()
				}
			}

			void subscribe()

			return () => {
				cancelled = true
				cancelExternalHover()
				disposeListeners()
			}
		},
		[],
	)

	function updateInsertionPosition(
		sourceId: string,
		clientX: number,
	): void {
		const nextInsertionIndex = getInsertionIndex(
			tabs,
			tabRefs.current,
			sourceId,
			clientX,
		)

		insertionIndexRef.current = nextInsertionIndex
		setInsertionIndex(nextInsertionIndex)
	}

	function handlePointerDown(
		event: PointerEvent<HTMLDivElement>,
		id: string,
	): void {
		if (
			disabled ||
			tabs.length < 2 ||
			event.button !== 0 ||
			event.pointerType === "touch"
		)
			return

		const target = event.target

		if (
			target instanceof Element &&
			target.closest("[data-project-tab-close]") !== null
		)
			return

		pointerDragRef.current = {
			sourceId: id,
			pointerId: event.pointerId,
			startX: event.clientX,
			started: false,
		}
	}

	function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
		const drag = pointerDragRef.current

		if (
			drag === null ||
			drag.pointerId !== event.pointerId
		)
			return

		if (!drag.started) {
			const horizontalDistance = Math.abs(event.clientX - drag.startX)

			if (horizontalDistance < DRAG_START_DISTANCE)
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

		if (
			drag === null ||
			drag.pointerId !== event.pointerId
		)
			return null

		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId)

		pointerDragRef.current = null
		insertionIndexRef.current = null
		setDraggedTabId(null)
		setInsertionIndex(null)

		return drag
	}

	function cancelPointerDrag(event: PointerEvent<HTMLDivElement>): void {
		resetPointerDrag(event)
	}

	function finishPointerDrag(event: PointerEvent<HTMLDivElement>): void {
		const currentInsertionIndex = insertionIndexRef.current
		const drag = resetPointerDrag(event)

		if (
			drag === null ||
			!drag.started
		)
			return

		suppressedClickRef.current = drag.sourceId
		window.setTimeout(
			() => {
				if (suppressedClickRef.current === drag.sourceId)
					suppressedClickRef.current = null
			},
			0,
		)

		const finalInsertionIndex = currentInsertionIndex ?? getInsertionIndex(
			tabs,
			tabRefs.current,
			drag.sourceId,
			event.clientX,
		)

		onMove(
			drag.sourceId,
			finalInsertionIndex,
		)
	}

	function handleSelect(id: string): void {
		if (suppressedClickRef.current === id) {
			suppressedClickRef.current = null
			return
		}

		onSelect(id)
	}

	let reorderableIndex = 0

	return (
		<div className={styles.root}>
			<div
				ref={listRef}
				role="tablist"
				aria-label={translate(
					locale,
					"tabs.aria",
				)}
				className={styles.list}
			>
				{tabs.map(tab => {
					const active = tab.id === activeTabId
					const dragging = draggedTabId === tab.id
					const label = getTabLabel(
						tab,
						locale,
					)
					const markerBefore = draggedTabId !== null &&
						!dragging &&
						insertionIndex === reorderableIndex

					if (!dragging)
						reorderableIndex++

					return (
						<div
							key={tab.id}
							className={styles.tabSlot}
						>
							{markerBefore && (
								<div
									aria-hidden="true"
									className={styles.dropMarker}
								/>
							)}

							<div
								ref={(element: HTMLDivElement | null) => {
									if (element === null)
										tabRefs.current.delete(tab.id)
									else {
										tabRefs.current.set(
											tab.id,
											element,
										)
									}
								}}
								className={styles.tab({
									active,
									dragging,
								})}
								onPointerDown={event => handlePointerDown(
									event,
									tab.id,
								)}
								onPointerMove={handlePointerMove}
								onPointerUp={finishPointerDrag}
								onPointerCancel={cancelPointerDrag}
							>
								<button
									type="button"
									role="tab"
									aria-selected={active}
									tabIndex={active ?
										0 :
										-1}
									title={tab.rootFolder ?? label}
									disabled={disabled}
									className={styles.selectButton}
									onClick={() => handleSelect(tab.id)}
								>
									<span className={styles.label}>
										{label}
									</span>
								</button>

								{canClose && (
									<button
										type="button"
										data-project-tab-close
										aria-label={translate(
											locale,
											"tabs.close",
											{ name: label },
										)}
										title={translate(
											locale,
											"tabs.closeTitle",
										)}
										disabled={disabled}
										className={styles.closeButton}
										onClick={() => onClose(tab.id)}
									>
										<X
											size={12}
											aria-hidden="true"
										/>
									</button>
								)}
							</div>
						</div>
					)
				})}

				{draggedTabId !== null &&
					insertionIndex === reorderableIndex && (
						<div
							aria-hidden="true"
							className={styles.dropMarker}
						/>
					)}
			</div>

			<button
				type="button"
				aria-label={translate(
					locale,
					"tabs.add",
				)}
				title={translate(
					locale,
					"tabs.add",
				)}
				disabled={disabled}
				className={styles.addButton}
				onClick={onAdd}
			>
				<Plus
					size={15}
					aria-hidden="true"
				/>
			</button>
		</div>
	)
}
