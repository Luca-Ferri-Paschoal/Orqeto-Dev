import {
	type DropTarget,
	getDragAutoScrollStep,
	getProjectTabApplyTarget,
	type NativeDropPayload,
} from "../nativeDrop"
import { cleanupNativeDrop } from "@/infra/desktop"
import {
	containsPhysicalPosition,
	type PhysicalPosition,
} from "@/shared/dom/physicalPosition"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import type { RefObject } from "react"
import {
	useEffect,
	useState,
} from "react"

interface UseNativeWorkspaceDropOptions {
	active: boolean
	interactionBlocked: boolean
	routingBusy: boolean
	ignoreDialogOpen: boolean
	isUpdatingProjectIgnore: boolean
	pendingDecision: boolean
	contextAddEnabled: boolean
	contextRemoveEnabled: boolean
	applyEnabled: boolean
	contextAddRef: RefObject<HTMLElement | null>
	contextRemoveRef: RefObject<HTMLElement | null>
	applyRef: RefObject<HTMLElement | null>
	ignoreAddRef: RefObject<HTMLElement | null>
	ignoreRemoveRef: RefObject<HTMLElement | null>
	onContextAdd: (paths: string[]) => Promise<unknown>
	onContextRemove: (paths: string[]) => Promise<unknown>
	onIgnoreUpdate: (
		paths: string[],
		ignore: boolean,
	) => Promise<unknown>
	onApply: (
		paths: string[],
		temporaryRoot: string | null,
	) => void
}

async function cleanupTemporaryRoot(temporaryRoot: string | null): Promise<void> {
	if (temporaryRoot !== null)
		await cleanupNativeDrop(temporaryRoot).catch(() => undefined)
}

export function useNativeWorkspaceDrop({
	active,
	interactionBlocked,
	routingBusy,
	ignoreDialogOpen,
	isUpdatingProjectIgnore,
	pendingDecision,
	contextAddEnabled,
	contextRemoveEnabled,
	applyEnabled,
	contextAddRef,
	contextRemoveRef,
	applyRef,
	ignoreAddRef,
	ignoreRemoveRef,
	onContextAdd,
	onContextRemove,
	onIgnoreUpdate,
	onApply,
}: UseNativeWorkspaceDropOptions): DropTarget | null {
	const [dragTarget, setDragTarget] = useState<DropTarget | null>(null)

	useEffect(() => {
		if (!active)
			return
		let unlistenTauri: (() => void) | undefined
		let unlistenNative: (() => void) | undefined
		let cancelled = false
		let dragPosition: PhysicalPosition | null = null
		let autoScrollFrame: number | null = null

		function getDropTarget(position: PhysicalPosition): DropTarget | null {
			if (interactionBlocked || routingBusy || pendingDecision)
				return null
			if (ignoreDialogOpen) {
				if (isUpdatingProjectIgnore)
					return null
				if (containsPhysicalPosition(
					ignoreAddRef.current,
					position,
				))
					return "ignoreAdd"
				if (containsPhysicalPosition(
					ignoreRemoveRef.current,
					position,
				))
					return "ignoreRemove"
				return null
			}
			if (contextAddEnabled && containsPhysicalPosition(
				contextAddRef.current,
				position,
			))
				return "contextAdd"
			if (contextRemoveEnabled && containsPhysicalPosition(
				contextRemoveRef.current,
				position,
			))
				return "contextRemove"
			if (applyEnabled && containsPhysicalPosition(
				applyRef.current,
				position,
			))
				return "apply"
			return getProjectTabApplyTarget(position) === null ?
				null :
				"applyTab"
		}

		function stopAutoScroll(): void {
			dragPosition = null
			if (autoScrollFrame !== null) {
				window.cancelAnimationFrame(autoScrollFrame)
				autoScrollFrame = null
			}
		}

		function runAutoScroll(): void {
			autoScrollFrame = null
			if (dragPosition === null)
				return
			const scrollContainer = applyRef.current?.closest<HTMLElement>(".orqeto-scroll-area") ?? null
			if (scrollContainer === null)
				return
			const scrollStep = getDragAutoScrollStep(
				dragPosition,
				scrollContainer,
			)
			if (scrollStep === 0)
				return
			const previousScrollTop = scrollContainer.scrollTop
			scrollContainer.scrollTop += scrollStep
			setDragTarget(getDropTarget(dragPosition))
			if (scrollContainer.scrollTop !== previousScrollTop)
				autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
		}

		function updateAutoScroll(position: PhysicalPosition): void {
			if (
				interactionBlocked ||
				routingBusy ||
				pendingDecision ||
				(!ignoreDialogOpen && !contextAddEnabled && !contextRemoveEnabled && !applyEnabled)
			) {
				stopAutoScroll()
				return
			}
			dragPosition = position
			if (autoScrollFrame === null)
				autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
		}

		function handleDrop(target: DropTarget | null, paths: string[], temporaryRoot: string | null): void {
			if (target === "contextAdd") {
				void onContextAdd(paths).finally(() => cleanupTemporaryRoot(temporaryRoot))
				return
			}
			if (target === "contextRemove") {
				void onContextRemove(paths).finally(() => cleanupTemporaryRoot(temporaryRoot))
				return
			}
			if (target === "ignoreAdd" || target === "ignoreRemove") {
				void onIgnoreUpdate(
					paths,
					target === "ignoreAdd",
				).finally(() => cleanupTemporaryRoot(temporaryRoot))
				return
			}
			if (target === "apply") {
				onApply(
					paths,
					temporaryRoot,
				)
				return
			}
			if (target !== "applyTab")
				void cleanupTemporaryRoot(temporaryRoot)
		}

		function disposeListeners(): void {
			unlistenTauri?.()
			unlistenNative?.()
			unlistenTauri = undefined
			unlistenNative = undefined
		}

		function handlePositionEvent(type: string, position: PhysicalPosition, paths: string[], temporaryRoot: string | null): void {
			const target = getDropTarget(position)
			if (type === "enter" || type === "over") {
				updateAutoScroll(position)
				setDragTarget(target)
				return
			}
			stopAutoScroll()
			setDragTarget(null)
			handleDrop(
				target,
				paths,
				temporaryRoot,
			)
		}

		async function subscribe(): Promise<void> {
			try {
				const tauriDisposer = await getCurrentWindow().onDragDropEvent(event => {
					const payload = event.payload

					if (payload.type === "leave") {
						stopAutoScroll()
						setDragTarget(null)
						return
					}

					const paths = payload.type === "over" ?
						[] :
						payload.paths

					handlePositionEvent(
						payload.type,
						payload.position,
						paths,
						null,
					)
				})
				if (cancelled) {
					tauriDisposer()
					return
				}
				unlistenTauri = tauriDisposer
				const nativeDisposer = await listen<NativeDropPayload>("native-drag-drop", event => {
					const payload = event.payload
					if (payload.type === "leave") {
						stopAutoScroll()
						setDragTarget(null)
						return
					}
					if (payload.position !== undefined) {
						handlePositionEvent(
							payload.type,
							payload.position,
							payload.paths ?? [],
							payload.temporaryRoot ?? null,
						)
					}
				})
				if (cancelled) {
					nativeDisposer()
					return
				}
				unlistenNative = nativeDisposer
			} catch {
				disposeListeners()
				stopAutoScroll()
				setDragTarget(null)
			}
		}

		void subscribe()
		return () => {
			cancelled = true
			stopAutoScroll()
			disposeListeners()
		}
	}, [
		active,
		applyEnabled,
		applyRef,
		contextAddEnabled,
		contextAddRef,
		contextRemoveEnabled,
		contextRemoveRef,
		ignoreAddRef,
		ignoreDialogOpen,
		ignoreRemoveRef,
		interactionBlocked,
		isUpdatingProjectIgnore,
		onApply,
		onContextAdd,
		onContextRemove,
		onIgnoreUpdate,
		pendingDecision,
		routingBusy,
	])

	return active ?
		dragTarget :
		null
}
