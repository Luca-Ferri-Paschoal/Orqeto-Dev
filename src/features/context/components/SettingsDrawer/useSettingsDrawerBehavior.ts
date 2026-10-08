import { formatAiWorkflowPrompt } from "../../formatAiWorkflowPrompt"
import type {
	VscodeExtensionInstallStatus,
	WorkflowPromptCopyStatus,
} from "./types"
import type { WorkMode } from "@/features/context/types"
import { installVscodeExtension } from "@/infra/desktop"
import type { Locale } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

export function useSettingsDrawerBehavior(
	open: boolean,
	locale: Locale,
	workMode: WorkMode,
	onBusyChange: (busy: boolean) => void,
	onClose: () => void,
) {
	const [vscodeExtensionInstallStatus, setVscodeExtensionInstallStatus] = useState<VscodeExtensionInstallStatus>("idle")
	const [workflowPromptCopyStatus, setWorkflowPromptCopyStatus] = useState<WorkflowPromptCopyStatus>("idle")
	const dialogRef = useRef<HTMLElement>(null)
	const previouslyFocusedRef = useRef<HTMLElement | null>(null)
	const handleClose = useCallback(() => {
		setWorkflowPromptCopyStatus("idle")
		onClose()
	}, [onClose])

	async function copyWorkflowPrompt(): Promise<void> {
		try {
			await writeText(formatAiWorkflowPrompt(
				locale,
				workMode,
			))
			setWorkflowPromptCopyStatus("success")
		} catch {
			setWorkflowPromptCopyStatus("error")
		}
	}
	async function installExtension(): Promise<void> {
		setVscodeExtensionInstallStatus("installing")
		onBusyChange(true)
		try {
			await installVscodeExtension()
			setVscodeExtensionInstallStatus("success")
		} catch {
			setVscodeExtensionInstallStatus("error")
		} finally {
			onBusyChange(false)
		}
	}

	useEffect(() => {
		if (workflowPromptCopyStatus !== "success")
			return
		const timeout = window.setTimeout(
			() => setWorkflowPromptCopyStatus("idle"),
			2_000,
		)
		return () => window.clearTimeout(timeout)
	}, [workflowPromptCopyStatus])

	useEffect(() => {
		if (!open)
			return
		previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ?
			document.activeElement :
			null
		const dialog = dialogRef.current
		const frame = window.requestAnimationFrame(() => (dialog?.querySelector<HTMLElement>("[data-settings-initial-focus]") ?? dialog)?.focus())
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				event.preventDefault()
				handleClose()
				return
			}
			if (event.key !== "Tab" || dialog === null)
				return
			const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
				.filter(element => !element.hidden && element.getClientRects().length > 0)
			if (focusable.length === 0) {
				event.preventDefault()
				dialog.focus()
				return
			}
			const first = focusable[0]
			const last = focusable.at(-1)
			if (first === undefined || last === undefined)
				return
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault(); last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault(); first.focus()
			} else if (!dialog.contains(document.activeElement)) {
				event.preventDefault(); first.focus()
			}
		}
		document.addEventListener(
			"keydown",
			onKeyDown,
		)
		return () => {
			window.cancelAnimationFrame(frame)
			document.removeEventListener(
				"keydown",
				onKeyDown,
			)
			const previous = previouslyFocusedRef.current
			previouslyFocusedRef.current = null
			if (previous?.isConnected)
				window.requestAnimationFrame(() => previous.focus())
		}
	}, [handleClose, open])

	return {
		copyWorkflowPrompt,
		dialogRef,
		handleClose,
		installExtension,
		resetWorkflowPromptCopyStatus: () => setWorkflowPromptCopyStatus("idle"),
		vscodeExtensionInstallStatus,
		workflowPromptCopyStatus,
	}
}
