import { cn } from "@/shared/utils/cn"
import {
	useEffect,
	useRef,
	useState,
} from "react"

type LoadingOverlayScope = "viewport" | "container"

interface LoadingOverlayProps {
	active: boolean
	label: string
	cancelLabel?: string
	delayMs?: number
	minimumVisibleMs?: number
	onCancel?: () => void
	scope?: LoadingOverlayScope
}

export function LoadingOverlay({
	active,
	label,
	cancelLabel,
	delayMs = 200,
	minimumVisibleMs = 300,
	onCancel,
	scope = "viewport",
}: LoadingOverlayProps) {
	const [visible, setVisible] = useState(false)
	const shownAtRef = useRef(0)

	useEffect(
		() => {
			let timeout: number | null = null

			if (active) {
				if (!visible) {
					timeout = window.setTimeout(
						() => {
							shownAtRef.current = performance.now()
							setVisible(true)
						},
						Math.max(
							0,
							delayMs,
						),
					)
				}
			} else if (visible) {
				const elapsed = performance.now() - shownAtRef.current
				const remaining = Math.max(
					0,
					minimumVisibleMs - elapsed,
				)

				timeout = window.setTimeout(
					() => setVisible(false),
					remaining,
				)
			}

			return () => {
				if (timeout !== null)
					window.clearTimeout(timeout)
			}
		},
		[
			active,
			delayMs,
			minimumVisibleMs,
			visible,
		],
	)

	if (!visible)
		return null

	const canCancel = active && onCancel !== undefined && cancelLabel !== undefined

	return (
		<div
			className={cn(
				scope === "viewport" ?
					"fixed" :
					"absolute",
				"inset-0",
				scope === "viewport" ?
					"z-[120]" :
					"z-[80]",
				"flex",
				"items-center",
				"justify-center",
				"bg-[var(--overlay-background)]",
				"backdrop-blur-[1px]",
			)}
		>
			<div
				className={cn(
					"flex",
					"flex-col",
					"items-center",
				)}
			>
				<div
					className={cn(
						"h-10",
						"w-10",
						"animate-spin",
						"rounded-full",
						"border-[3px]",
						"border-white/30",
						"border-t-white",
						"shadow-sm",
						"motion-reduce:animate-none",
					)}
					aria-hidden="true"
				/>

				<span
					className="sr-only"
					role="status"
					aria-live="polite"
				>
					{label}
				</span>

				{canCancel && (
					<button
						type="button"
						className={cn(
							"mt-7",
							"rounded-md",
							"border",
							"border-white/25",
							"bg-black/20",
							"px-2.5",
							"py-1",
							"text-xs",
							"font-medium",
							"text-white/90",
							"transition-[background-color,border-color,color,transform]",
							"duration-150",
							"hover:scale-[1.02]",
							"hover:border-white/55",
							"hover:bg-white/10",
							"hover:text-white",
							"focus-visible:outline-none",
							"focus-visible:ring-2",
							"focus-visible:ring-white/70",
						)}
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
				)}
			</div>
		</div>
	)
}
