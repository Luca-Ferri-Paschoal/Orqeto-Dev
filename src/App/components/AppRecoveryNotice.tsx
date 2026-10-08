import { recoveryNoticeStyles as styles } from "./AppRecoveryNotice.style"
import type { Locale } from "@/infra/i18n"
import { translate } from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Dialog } from "@/shared/components/Dialog"
import { Notice } from "@/shared/components/Notice"
import { CircleAlert } from "lucide-react"
import { useState } from "react"

interface AppRecoveryNoticeProps {
	locale: Locale
	busy: boolean
	onDiscard: () => Promise<boolean>
}

export function AppRecoveryNotice({
	locale,
	busy,
	onDiscard,
}: AppRecoveryNoticeProps) {
	const [confirming, setConfirming] = useState(false)

	async function confirmDiscard(): Promise<void> {
		if (busy)
			return
		if (await onDiscard())
			setConfirming(false)
	}

	return (
		<>
			<Notice
				kind="error"
				message={translate(
					locale,
					"app.recoveryBlocked",
				)}
				actionLabel={translate(
					locale,
					"app.recoveryDiscard",
				)}
				actionDisabled={busy}
				onAction={() => setConfirming(true)}
			/>

			{confirming && (
				<Dialog
					backdropClassName={styles.backdrop}
					dialogClassName={styles.dialog}
					labelledBy="recovery-discard-title"
					disabled={busy}
					onCancel={() => setConfirming(false)}
				>
					<div className={styles.heading}>
						<div className={styles.icon}>
							<CircleAlert size={17} strokeWidth={2} aria-hidden="true" />
						</div>
						<div className={styles.headingContent}>
							<h2 id="recovery-discard-title" className={styles.title}>
								{translate(
									locale,
									"app.recoveryDiscardTitle",
								)}
							</h2>
							<p className={styles.message}>
								{translate(
									locale,
									"app.recoveryDiscardMessage",
								)}
							</p>
						</div>
					</div>
					<div className={styles.actions}>
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => setConfirming(false)}
						>
							{translate(
								locale,
								"app.loading.cancel",
							)}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() => void confirmDiscard()}
						>
							{translate(
								locale,
								busy ?
									"app.recoveryDiscarding" :
									"app.recoveryDiscardConfirm",
							)}
						</Button>
					</div>
				</Dialog>
			)}
		</>
	)
}
