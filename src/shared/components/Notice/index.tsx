import { styles } from "./style"

export type NoticeKind = "info" | "success" | "warning" | "error"

export interface NoticeProps {
	kind: NoticeKind
	message: string
}

export function Notice({
	kind,
	message,
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
			{message}
		</div>
	)
}
