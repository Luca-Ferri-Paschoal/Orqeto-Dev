import { ContextModeBar } from "./ContextModeBar"
import { FolderActionMenu } from "./FolderActionMenu"
import {
	getContextModes,
	getFolderActions,
	getSectionMode,
} from "./options"
import { RootFolderField } from "./RootFolderField"
import { styles } from "./style"
import type { FolderSettingsProps } from "./types"
import type { FolderAction } from "@/features/context/types"
import { translate } from "@/infra/i18n"
import { CollapseToggle } from "@/shared/components/CollapseToggle"
import { CollapsibleRegion } from "@/shared/components/CollapsibleRegion"
import {
	useId,
	useState,
} from "react"

export type { ContextSectionMode } from "./types"

export function FolderSettings(props: FolderSettingsProps) {
	const {
		rootFolder,
		locale,
		disabled = false,
		expanded,
		children,
		headerAccessory,
	} = props
	const detailsId = useId()
	const [actionMenuOpen, setActionMenuOpen] = useState(false)
	const sectionName = translate(
		locale,
		"folder.title",
	)
	const selectedMode = getSectionMode(props.contextMode)
	const contextModes = getContextModes(locale, {
		isGitRepository: props.isGitRepository,
		hasValidation: props.hasTypecheckContext || props.hasLintFixAction || props.hasEslintContext || props.hasTestAction,
		hasLogs: props.hasProjectLogs,
	})
	const actions = getFolderActions(
		rootFolder,
		props.vscodeAvailable,
		locale,
	)
	const currentAction = actions.find(action => action.value === props.selectedAction) ?? {
		value: "select",
		label: translate(
			locale,
			"folder.select",
		),
	}

	function executeAction(action: FolderAction): void {
		if (action === "select")
			props.onSelectFolder()
		else if (action === "explorer")
			props.onOpenFolder()
		else if (action === "vscode")
			props.onOpenVscode()
		else {
			props.onSelectedActionChange("select")
			props.onCloseFolder()
		}
	}

	return (
		<section className={styles.container}>
			<header className={styles.header}>
				<div className={styles.titleGroup}>
					<h2 className={styles.title}>{sectionName}</h2>
					{headerAccessory}
				</div>
				<CollapseToggle
					controlsId={detailsId}
					expanded={expanded}
					label={translate(
						locale,
						expanded ?
							"section.collapse" :
							"section.expand",
						{ section: sectionName },
					)}
					className={styles.toggleButton}
					onToggle={() => props.onExpandedChange(!expanded)}
				/>
			</header>
			{rootFolder !== null && (
				<ContextModeBar
					locale={locale}
					disabled={disabled}
					selectedMode={selectedMode}
					modes={contextModes}
					onChange={props.onContextModeChange}
				/>
			)}
			<CollapsibleRegion id={detailsId} expanded={expanded} innerClassName={styles.collapseInner}>
				<div className={styles.projectControls}>
					<RootFolderField
						id={`${detailsId}-root-folder`}
						rootFolder={rootFolder}
						locale={locale}
						disabled={disabled}
						projectIgnoreExists={props.projectIgnoreExists}
						onDevIgnore={props.onDevIgnore}
					/>
					<FolderActionMenu
						locale={locale}
						disabled={disabled}
						open={actionMenuOpen}
						currentAction={currentAction}
						actions={actions}
						onOpenChange={setActionMenuOpen}
						onExecute={executeAction}
						onSelect={action => {
							props.onSelectedActionChange(action)
							setActionMenuOpen(false)
						}}
					/>
				</div>
			</CollapsibleRegion>
			{children}
		</section>
	)
}
