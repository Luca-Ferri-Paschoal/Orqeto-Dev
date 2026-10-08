import { styles } from "./style"
import type { DropZoneProps } from "./types"
import { translate } from "@/infra/i18n"

type Props = Pick<
	DropZoneProps,
	| "addEnabled" |
	"removeEnabled" |
	"isAddDragging" |
	"isRemoveDragging" |
	"isProcessing" |
	"locale" |
	"addElementRef" |
	"removeElementRef"
>

export function DropTargets({
	addEnabled,
	removeEnabled,
	isAddDragging,
	isRemoveDragging,
	isProcessing,
	locale,
	addElementRef,
	removeElementRef,
}: Props) {
	return (
		<div className={styles.zones}>
			<section
				ref={addElementRef}
				aria-label={translate(
					locale,
					"context.drop.aria",
				)}
				className={styles.zone({
					enabled: addEnabled,
					isDragging: isAddDragging,
					variant: "add",
				})}
			>
				<div className={styles.icon({ variant: "add" })}>
					{isProcessing ?
						"…" :
						"+"}
				</div>
				<h3 className={styles.title}>
					{translate(
						locale,
						"context.drop.compact",
					)}
				</h3>
			</section>

			<section
				ref={removeElementRef}
				aria-label={translate(
					locale,
					"context.remove.aria",
				)}
				className={styles.zone({
					enabled: removeEnabled,
					isDragging: isRemoveDragging,
					variant: "remove",
				})}
			>
				<div className={styles.icon({ variant: "remove" })}>
					−
				</div>
				<h3 className={styles.title}>
					{translate(
						locale,
						"context.remove.compact",
					)}
				</h3>
			</section>
		</div>
	)
}
