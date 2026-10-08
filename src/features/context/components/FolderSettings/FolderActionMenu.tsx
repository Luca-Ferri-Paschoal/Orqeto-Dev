import { styles } from "./style"
import type { FolderAction } from "@/features/context/types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { ChevronDown } from "lucide-react"

interface Props {
	locale: Locale
	disabled: boolean
	open: boolean
	currentAction: { value: FolderAction; label: string }
	actions: Array<{ value: FolderAction; label: string }>
	onOpenChange: (open: boolean) => void
	onExecute: (action: FolderAction) => void
	onSelect: (action: FolderAction) => void
}

export function FolderActionMenu(props: Props) {
	return (
		<div
			className={styles.actionsField}
			onBlur={event => {
				const nextTarget = event.relatedTarget
				if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget))
					props.onOpenChange(false)
			}}
		>
			<span className={styles.actionsLabel}>{translate(
				props.locale,
				"folder.actions.label",
			)}</span>
			<div className={styles.actionControl}>
				<button type="button" className={styles.actionExecuteButton} disabled={props.disabled} onClick={() => props.onExecute(props.currentAction.value)}>
					{props.currentAction.label}
				</button>
				<button
					type="button"
					aria-haspopup="menu"
					aria-expanded={props.open}
					aria-label={translate(
						props.locale,
						"folder.actions.label",
					)}
					className={styles.actionMenuButton}
					disabled={props.disabled}
					onClick={() => props.onOpenChange(!props.open)}
				>
					<ChevronDown size={14} aria-hidden="true" />
				</button>
				{props.open && (
					<div role="menu" className={styles.actionMenu}>
						{props.actions.map(action => (
							<button
								key={action.value}
								type="button"
								role="menuitem"
								className={styles.actionMenuItem({ selected: action.value === props.currentAction.value })}
								onClick={() => props.onSelect(action.value)}
							>
								{action.label}
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
