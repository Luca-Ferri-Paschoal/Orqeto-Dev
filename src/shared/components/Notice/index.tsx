import { styles } from "./style"
import { Button } from "@/shared/components/Button"

export type NoticeKind = "info" | "success" | "warning" | "error"

export interface NoticeProps {
	kind: NoticeKind
	message: string
	details?: readonly string[]
	actionLabel?: string
	actionDisabled?: boolean
	onAction?: () => void
}

export function Notice({
	kind,
	message,
	details = [],
	actionLabel,
	actionDisabled = false,
	onAction,
}: NoticeProps) {
	const hasAction = actionLabel !== undefined && onAction !== undefined
	return (
		<div
			role={kind === "error" ?
				"alert" :
				"status"}
			className={styles.notice({ kind })}
		>
			<div className={styles.summary}>
				<div className={styles.message}>
					{message}
				</div>
				{hasAction && (
					<Button
						variant="secondary"
						className={styles.action}
						disabled={actionDisabled}
						onClick={onAction}
					>
						{actionLabel}
					</Button>
				)}
			</div>
			{details.length > 0 && (
				<ul className={styles.details}>
					{details.map((detail, index) => (
						<li
							key={`${index}:${detail}`}
							className={styles.detail}
						>
							{detail}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
