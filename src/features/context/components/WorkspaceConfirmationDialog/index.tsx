import type { WorkspaceConfirmationRequest } from "../../useContextWorkspace"
import { styles } from "./style"
import { Button } from "@/shared/components/Button"
import { Dialog } from "@/shared/components/Dialog"
import { CircleAlert } from "lucide-react"

interface WorkspaceConfirmationDialogProps {
	request: WorkspaceConfirmationRequest
	onCancel: () => void
	onConfirm: () => void
}

export function WorkspaceConfirmationDialog({
	request,
	onCancel,
	onConfirm,
}: WorkspaceConfirmationDialogProps) {
	return (
		<Dialog
			backdropClassName={styles.backdrop}
			dialogClassName={styles.dialog}
			labelledBy="workspace-confirmation-title"
			onCancel={onCancel}
		>
			<div className={styles.heading}>
				<div className={styles.headingIcon}>
					<CircleAlert
						size={17}
						strokeWidth={2}
						aria-hidden="true"
					/>
				</div>

				<div className={styles.headingContent}>
					<h2
						id="workspace-confirmation-title"
						className={styles.title}
					>
						{request.title}
					</h2>

					<p className={styles.message}>
						{request.message}
					</p>
				</div>
			</div>

			<div className={styles.actions}>
				<Button
					variant="ghost"
					onClick={onCancel}
				>
					{request.cancelLabel}
				</Button>

				<Button onClick={onConfirm}>
					{request.confirmLabel}
				</Button>
			</div>
		</Dialog>
	)
}
