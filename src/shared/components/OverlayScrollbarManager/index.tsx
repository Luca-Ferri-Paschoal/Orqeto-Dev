import { SCROLL_AREA_SELECTOR } from "./constants"
import { createController } from "./controller"
import { updateController } from "./geometry"
import type { OverlayController } from "./types"
import { useEffect } from "react"

export default function OverlayScrollbarManager() {
	useEffect(() => {
		const controllers = new Map<HTMLElement, OverlayController>()
		let animationFrame: number | null = null
		let synchronizationFrame: number | null = null
		function updateAll(): void {
			animationFrame = null
			controllers.forEach(updateController)
		}
		function scheduleUpdateAll(): void {
			if (animationFrame === null)
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
				if (!element.isConnected || !currentElements.has(element)) {
					controller.cleanup()
					controllers.delete(element)
				}
			})
			scheduleUpdateAll()
		}
		function scheduleSynchronization(): void {
			if (synchronizationFrame === null)
				synchronizationFrame = window.requestAnimationFrame(synchronizeControllers)
		}
		const mutationObserver = new MutationObserver(scheduleSynchronization)
		mutationObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["aria-hidden", "hidden", "inert"],
			childList: true,
			subtree: true,
		})
		function handleDocumentScroll(): void {
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
			controllers.forEach(controller => controller.cleanup())
			controllers.clear()
		}
	}, [])
	return null
}
