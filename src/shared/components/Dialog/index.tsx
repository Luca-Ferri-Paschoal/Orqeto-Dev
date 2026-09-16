import {
	type ReactNode,
	useEffect,
	useRef,
} from "react"

const FOCUSABLE_SELECTOR = [
	"button:not([disabled])",
	"[href]",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
].join(",")

interface DialogProps {
	backdropClassName: string
	dialogClassName: string
	labelledBy: string
	disabled?: boolean
	onCancel: () => void
	children: ReactNode
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
		.filter(element => !element.hasAttribute("inert"))
}

export function Dialog({
	backdropClassName,
	dialogClassName,
	labelledBy,
	disabled = false,
	onCancel,
	children,
}: DialogProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const disabledRef = useRef(disabled)
	const onCancelRef = useRef(onCancel)

	useEffect(
		() => {
			disabledRef.current = disabled
			onCancelRef.current = onCancel
		},
		[
			disabled,
			onCancel,
		],
	)

	useEffect(
		() => {
			const dialog = dialogRef.current

			if (dialog === null)
				return

			const previouslyFocused = document.activeElement instanceof HTMLElement ?
				document.activeElement :
				null
			const focusable = getFocusableElements(dialog)
			focusable[0]?.focus()

			if (focusable.length === 0)
				dialog.focus()

			function handleKeyDown(event: KeyboardEvent): void {
				if (event.key === "Escape") {
					if (disabledRef.current)
						return

					event.preventDefault()
					onCancelRef.current()
					return
				}

				if (event.key !== "Tab")
					return

				const currentDialog = dialogRef.current

				if (currentDialog === null)
					return

				const currentFocusable = getFocusableElements(currentDialog)

				if (currentFocusable.length === 0) {
					event.preventDefault()
					currentDialog.focus()
					return
				}

				const first = currentFocusable[0]
				const last = currentFocusable.at(-1)

				if (first === undefined || last === undefined)
					return

				if (!currentDialog.contains(document.activeElement)) {
					event.preventDefault()

					if (event.shiftKey)
						last.focus()
					else
						first.focus()

					return
				}

				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault()
					last.focus()
					return
				}

				if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault()
					first.focus()
				}
			}

			document.addEventListener(
				"keydown",
				handleKeyDown,
			)

			return () => {
				document.removeEventListener(
					"keydown",
					handleKeyDown,
				)

				if (previouslyFocused?.isConnected)
					previouslyFocused.focus()
			}
		},
		[],
	)

	return (
		<div
			className={backdropClassName}
			role="presentation"
		>
			<section
				ref={dialogRef}
				className={dialogClassName}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
				tabIndex={-1}
			>
				{children}
			</section>
		</div>
	)
}
