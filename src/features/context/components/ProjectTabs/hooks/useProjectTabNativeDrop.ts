import type { PhysicalPosition } from "@/shared/dom/physicalPosition"
import { containsPhysicalPosition } from "@/shared/dom/physicalPosition"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
	type MutableRefObject,
	useEffect,
	useRef,
	useState,
} from "react"

interface NativeDropPayload {
	type: "enter" | "over" | "leave" | "drop"
	position?: PhysicalPosition
	paths?: string[]
	temporaryRoot?: string | null
}
const EXTERNAL_DRAG_TAB_SWITCH_DELAY_MS = 250

interface Args {
	activeTabId: string
	disabled: boolean
	tabRefs: MutableRefObject<Map<string, HTMLDivElement>>
	onSelect: (id: string) => void
	onApplyDrop: (
		tabId: string,
		paths: string[],
		temporaryRoot: string | null,
	) => void
}

export function useProjectTabNativeDrop({ activeTabId, disabled, tabRefs, onSelect, onApplyDrop }: Args) {
	const [externalDropTabId, setExternalDropTabId] = useState<string | null>(null)
	const externalHoverTabRef = useRef<string | null>(null)
	const externalHoverTimerRef = useRef<number | null>(null)
	const activeTabIdRef = useRef(activeTabId)
	const disabledRef = useRef(disabled)
	const onSelectRef = useRef(onSelect)
	const onApplyDropRef = useRef(onApplyDrop)

	useEffect(() => {
		activeTabIdRef.current = activeTabId
		disabledRef.current = disabled
		onSelectRef.current = onSelect
		onApplyDropRef.current = onApplyDrop
	}, [activeTabId, disabled, onApplyDrop, onSelect])

	useEffect(() => {
		let cancelled = false
		let unlistenTauri: (() => void) | undefined
		let unlistenNative: (() => void) | undefined
		function clearTimer(): void {
			if (externalHoverTimerRef.current !== null)
				window.clearTimeout(externalHoverTimerRef.current)
			externalHoverTimerRef.current = null
			externalHoverTabRef.current = null
		}
		function cancelHover(): void { clearTimer(); setExternalDropTabId(null) }
		function hoveredTab(position: PhysicalPosition): string | null {
			if (disabledRef.current)
				return null
			for (const [tabId, element] of tabRefs.current) {
				if (element.dataset.projectTabApplyTarget !== undefined && containsPhysicalPosition(
					element,
					position,
				))
					return tabId
			}

			return null
		}
		function handlePosition(position: PhysicalPosition): void {
			const id = hoveredTab(position)
			if (id === null) { cancelHover(); return }
			setExternalDropTabId(id)
			if (id === activeTabIdRef.current) { clearTimer(); return }
			if (externalHoverTabRef.current === id)
				return
			clearTimer()
			externalHoverTabRef.current = id
			externalHoverTimerRef.current = window.setTimeout(() => {
				if (externalHoverTabRef.current !== id)
					return
				externalHoverTimerRef.current = null
				externalHoverTabRef.current = null
				if (activeTabIdRef.current !== id)
					onSelectRef.current(id)
			}, EXTERNAL_DRAG_TAB_SWITCH_DELAY_MS)
		}
		function dispose(): void { unlistenTauri?.(); unlistenNative?.(); unlistenTauri = undefined; unlistenNative = undefined }
		async function subscribe(): Promise<void> {
			try {
				const tauriDisposer = await getCurrentWindow().onDragDropEvent(event => {
					if (event.payload.type === "leave") { cancelHover(); return }
					if (event.payload.type === "drop") {
						const id = hoveredTab(event.payload.position)
						cancelHover()
						if (id !== null) {
							onApplyDropRef.current(
								id,
								event.payload.paths,
								null,
							)
						}
						return
					}
					handlePosition(event.payload.position)
				})
				if (cancelled) { tauriDisposer(); return }
				unlistenTauri = tauriDisposer
				const nativeDisposer = await listen<NativeDropPayload>("native-drag-drop", event => {
					const payload = event.payload
					if (payload.type === "leave") { cancelHover(); return }
					if (payload.type === "drop") {
						const id = payload.position === undefined ?
							null :
							hoveredTab(payload.position)
						cancelHover()
						if (id !== null) {
							onApplyDropRef.current(
								id,
								payload.paths ?? [],
								payload.temporaryRoot ?? null,
							)
						}
						return
					}
					if (payload.position !== undefined)
						handlePosition(payload.position)
				})
				if (cancelled) { nativeDisposer(); return }
				unlistenNative = nativeDisposer
			} catch { dispose(); cancelHover() }
		}
		void subscribe()
		return () => { cancelled = true; cancelHover(); dispose() }
	}, [tabRefs])
	return externalDropTabId
}
