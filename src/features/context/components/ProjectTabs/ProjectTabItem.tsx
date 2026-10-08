import type { ProjectTab } from "../../types"
import { getTabLabel } from "./helpers"
import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import {
	FolderInput,
	X,
} from "lucide-react"
import type { PointerEvent } from "react"

interface Props {
	tab: ProjectTab
	locale: Locale
	active: boolean
	dragging: boolean
	externalDrop: boolean
	markerBefore: boolean
	canClose: boolean
	disabled: boolean
	onRef: (element: HTMLDivElement | null) => void
	onSelect: () => void
	onClose: () => void
	onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
	onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
	onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
	onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
}

export function ProjectTabItem({
	tab,
	locale,
	active,
	dragging,
	externalDrop,
	markerBefore,
	canClose,
	disabled,
	onRef,
	onSelect,
	onClose,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
}: Props) {
	const label = getTabLabel(
		tab,
		locale,
	)

	return (
		<div className={styles.tabSlot}>
			{markerBefore && (
				<div
					aria-hidden="true"
					className={styles.dropMarker}
				/>
			)}

			<div
				ref={onRef}
				data-project-tab-apply-target={tab.rootFolder === null ?
					undefined :
					"true"}
				data-project-tab-id={tab.id}
				className={styles.tab({
					active,
					dragging,
					externalDrop,
				})}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
			>
				<button
					type="button"
					role="tab"
					aria-selected={active}
					tabIndex={active ?
						0 :
						-1}
					title={tab.rootFolder ?? label}
					disabled={disabled}
					className={styles.selectButton}
					onClick={onSelect}
				>
					{externalDrop && (
						<FolderInput
							size={13}
							strokeWidth={2}
							aria-hidden="true"
						/>
					)}
					<span className={styles.label}>
						{label}
					</span>
				</button>

				{canClose && (
					<button
						type="button"
						data-project-tab-close
						aria-label={translate(
							locale,
							"tabs.close",
							{ name: label },
						)}
						title={translate(
							locale,
							"tabs.closeTitle",
						)}
						disabled={disabled}
						className={styles.closeButton}
						onClick={onClose}
					>
						<X
							size={12}
							aria-hidden="true"
						/>
					</button>
				)}
			</div>
		</div>
	)
}
