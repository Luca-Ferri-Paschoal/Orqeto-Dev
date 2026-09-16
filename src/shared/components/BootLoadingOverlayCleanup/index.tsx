import { useEffect } from "react"

interface BootLoadingOverlayCleanupProps {
	ready: boolean
}

export function BootLoadingOverlayCleanup({
	ready,
}: BootLoadingOverlayCleanupProps) {
	useEffect(
		() => {
			if (!ready)
				return

			const overlay = document.getElementById("orqeto-boot-loading")

			if (overlay === null)
				return

			const frame = window.requestAnimationFrame(() => {
				overlay.classList.add("is-ready")
			})
			const timeout = window.setTimeout(
				() => overlay.remove(),
				180,
			)

			return () => {
				window.cancelAnimationFrame(frame)
				window.clearTimeout(timeout)
			}
		},
		[ready],
	)

	return null
}
