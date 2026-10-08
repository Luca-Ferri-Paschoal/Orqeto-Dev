import { SecretReviewDialog } from "./SecretReviewDialog"
import type { SecretReviewResult } from "@/domain/contextContracts"
import type { Locale } from "@/infra/i18n"
import { createRoot } from "react-dom/client"

/** A review creates no project changes; even 'None' still applies safe siblings. */
export function requestSecretReview(review: SecretReviewResult, locale: Locale): Promise<string[] | null> {
	return new Promise(resolve => {
		const host = document.createElement("div")
		document.body.append(host)
		const root = createRoot(host)
		let settled = false
		const settle = (selection: string[] | null) => {
			if (settled)
				return
			settled = true
			resolve(selection)
			queueMicrotask(() => { root.unmount(); host.remove() })
		}
		root.render(<SecretReviewDialog review={review} locale={locale} onSettle={settle} />)
	})
}
