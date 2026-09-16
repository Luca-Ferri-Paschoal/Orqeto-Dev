import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Dialog } from "@/shared/components/Dialog"
import {
	ShieldMinus,
	ShieldPlus,
	X,
} from "lucide-react"
import {
	type RefObject,
	useId,
} from "react"

interface DevIgnoreDialogProps {
	addElementRef: RefObject<HTMLElement | null>
	removeElementRef: RefObject<HTMLElement | null>
	isAddDragging: boolean
	isRemoveDragging: boolean
	disabled: boolean
	locale: Locale
	onClose: () => void
}

export function DevIgnoreDialog({
	addElementRef,
	removeElementRef,
	isAddDragging,
	isRemoveDragging,
	disabled,
	locale,
	onClose,
}: DevIgnoreDialogProps) {
	const titleId = useId()

	return (
		<Dialog
			backdropClassName={styles.backdrop}
			dialogClassName={styles.dialog}
			labelledBy={titleId}
			disabled={disabled}
			onCancel={onClose}
		>
			<header className={styles.header}>
				<div className={styles.headerText}>
					<h2
						id={titleId}
						className={styles.title}
					>
						{translate(
							locale,
							"devIgnore.title",
						)}
					</h2>

					<p className={styles.description}>
						{translate(
							locale,
							"devIgnore.description",
						)}
					</p>
				</div>

				<button
					type="button"
					className={styles.closeButton}
					aria-label={translate(
						locale,
						"devIgnore.close",
					)}
					disabled={disabled}
					onClick={onClose}
				>
					<X
						size={17}
						strokeWidth={2}
						aria-hidden="true"
					/>
				</button>
			</header>

			<div className={styles.zones}>
				<section
					ref={addElementRef}
					className={styles.zone({
						isDragging: isAddDragging,
						variant: "add",
					})}
					aria-label={translate(
						locale,
						"devIgnore.add.title",
					)}
				>
					<div className={styles.icon({ variant: "add" })}>
						<ShieldPlus
							size={24}
							strokeWidth={1.8}
							aria-hidden="true"
						/>
					</div>
					<strong className={styles.zoneTitle}>
						{isAddDragging ?
							translate(
								locale,
								"devIgnore.add.drop",
							) :
							translate(
								locale,
								"devIgnore.add.title",
							)}
					</strong>
					<span className={styles.zoneDescription}>
						{translate(
							locale,
							"devIgnore.add.description",
						)}
					</span>
				</section>

				<section
					ref={removeElementRef}
					className={styles.zone({
						isDragging: isRemoveDragging,
						variant: "remove",
					})}
					aria-label={translate(
						locale,
						"devIgnore.remove.title",
					)}
				>
					<div className={styles.icon({ variant: "remove" })}>
						<ShieldMinus
							size={24}
							strokeWidth={1.8}
							aria-hidden="true"
						/>
					</div>
					<strong className={styles.zoneTitle}>
						{isRemoveDragging ?
							translate(
								locale,
								"devIgnore.remove.drop",
							) :
							translate(
								locale,
								"devIgnore.remove.title",
							)}
					</strong>
					<span className={styles.zoneDescription}>
						{translate(
							locale,
							"devIgnore.remove.description",
						)}
					</span>
				</section>
			</div>
		</Dialog>
	)
}
