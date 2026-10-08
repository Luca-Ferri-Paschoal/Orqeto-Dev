import type { Locale } from "@/infra/i18n"

export interface ProjectLogsOptions {
	rootFolder: string
	locale: Locale
	command: string
	clearAfterCopy: boolean
	active: boolean
	requestConfirmation: (request: {
		title: string
		message: string
		confirmLabel: string
		cancelLabel: string
	}) => Promise<boolean>
	onError: (message: string) => void
}
