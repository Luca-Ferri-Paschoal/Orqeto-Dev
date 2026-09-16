import { styles } from "./style"

export type NoticeKind = "info" | "success" | "warning" | "error"

export interface NoticeProps {
	kind: NoticeKind
	message: string
	details?: readonly string[]
}

export function Notice({
	kind,
	message,
	details = [],
}: NoticeProps) {
	return (
		<div
			role={kind === "error" ?
				"alert" :
				"status"}
			className={styles.notice({
				kind,
			})}
		>
			<div className={styles.message}>
				{message}
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
