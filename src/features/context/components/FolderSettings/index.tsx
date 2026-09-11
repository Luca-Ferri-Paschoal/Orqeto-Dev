import { styles } from "./style"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Input } from "@/shared/components/Input"
import {
	ChevronDown,
	ChevronUp,
} from "lucide-react"
import { useId } from "react"

export interface FolderSettingsProps {
	rootFolder: string | null
	locale: Locale
	disabled?: boolean
	expanded: boolean
	onExpandedChange: (expanded: boolean) => void
	onSelectFolder: () => void
	onOpenFolder: () => void
	onCloseFolder: () => void
}

export function FolderSettings({
	rootFolder,
	locale,
	disabled = false,
	expanded,
	onExpandedChange,
	onSelectFolder,
	onOpenFolder,
	onCloseFolder,
}: FolderSettingsProps) {
	const detailsId = useId()
	const sectionName = translate(
		locale,
		"folder.title",
	)
	const toggleLabel = translate(
		locale,
		expanded ?
			"section.collapse" :
			"section.expand",
		{
			section: sectionName,
		},
	)

	return (
		<section className={styles.container}>
			<header className={styles.header}>
				<h2 className={styles.title}>
					{sectionName}
				</h2>

				<button
					type="button"
					aria-controls={detailsId}
					aria-expanded={expanded}
					aria-label={toggleLabel}
					title={toggleLabel}
					className={styles.toggleButton}
					onClick={() => onExpandedChange(!expanded)}
				>
					{expanded ?
						(
							<ChevronUp
								size={15}
								strokeWidth={2}
								aria-hidden="true"
							/>
						) :
						(
							<ChevronDown
								size={15}
								strokeWidth={2}
								aria-hidden="true"
							/>
						)}
				</button>
			</header>

			<div
				id={detailsId}
				aria-hidden={!expanded}
				inert={!expanded}
				className={styles.collapseRegion({
					expanded,
				})}
			>
				<div className={styles.collapseInner}>
					<Input
						id={`${detailsId}-root-folder`}
						label={translate(
							locale,
							"folder.path",
						)}
						value={rootFolder ?? ""}
						placeholder={translate(
							locale,
							"folder.none",
						)}
						readOnly
					/>

					<div className={styles.actions}>
						<Button
							disabled={disabled}
							onClick={onSelectFolder}
						>
							{translate(
								locale,
								rootFolder === null ?
									"folder.select" :
									"folder.change",
							)}
						</Button>

						{rootFolder !== null && (
							<>
								<Button
									variant="secondary"
									disabled={disabled}
									onClick={onOpenFolder}
								>
									{translate(
										locale,
										"folder.openExplorer",
									)}
								</Button>

								<Button
									variant="ghost"
									disabled={disabled}
									onClick={onCloseFolder}
								>
									{translate(
										locale,
										"folder.close",
									)}
								</Button>
							</>
						)}
					</div>
				</div>
			</div>
		</section>
	)
}
