import { styles } from "./style"
import type {
	ContextMode,
	FolderAction,
} from "@/features/context/types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { CollapseToggle } from "@/shared/components/CollapseToggle"
import { CollapsibleRegion } from "@/shared/components/CollapsibleRegion"
import { Input } from "@/shared/components/Input"
import {
	ChevronDown,
	ShieldCheck,
} from "lucide-react"
import {
	type ReactNode,
	useId,
	useState,
} from "react"

export type ContextSectionMode = "project" | "commit" | "validation"

export interface FolderSettingsProps {
	rootFolder: string | null
	locale: Locale
	disabled?: boolean
	isGitRepository: boolean
	hasTypecheckContext: boolean
	hasEslintContext: boolean
	contextMode: ContextMode
	projectIgnoreExists: boolean | null
	vscodeAvailable: boolean
	expanded: boolean
	selectedAction: FolderAction
	children?: ReactNode
	onExpandedChange: (expanded: boolean) => void
	onSelectedActionChange: (action: FolderAction) => void
	onContextModeChange: (mode: ContextSectionMode) => void
	onSelectFolder: () => void
	onOpenFolder: () => void
	onOpenVscode: () => void
	onCloseFolder: () => void
	onDevIgnore: () => void
}

function getSectionMode(contextMode: ContextMode): ContextSectionMode {
	if (contextMode === "commit")
		return "commit"

	if (contextMode === "typecheck" || contextMode === "eslint")
		return "validation"

	return "project"
}

export function FolderSettings({
	rootFolder,
	locale,
	disabled = false,
	isGitRepository,
	hasTypecheckContext,
	hasEslintContext,
	contextMode,
	projectIgnoreExists,
	vscodeAvailable,
	expanded,
	selectedAction,
	children,
	onExpandedChange,
	onSelectedActionChange,
	onContextModeChange,
	onSelectFolder,
	onOpenFolder,
	onOpenVscode,
	onCloseFolder,
	onDevIgnore,
}: FolderSettingsProps) {
	const detailsId = useId()
	const [actionMenuOpen, setActionMenuOpen] = useState(false)
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
	const selectedMode = getSectionMode(contextMode)
	const contextModes: Array<{
		mode: ContextSectionMode
		label: string
	}> = [
			{
				mode: "project",
				label: translate(
					locale,
					"folder.contextMode.project",
				),
			},
			...(isGitRepository ?
				[{
					mode: "commit" as const,
					label: translate(
						locale,
						"folder.contextMode.commit",
					),
				}] :
				[]),
			...(hasTypecheckContext || hasEslintContext ?
				[{
					mode: "validation" as const,
					label: translate(
						locale,
						"folder.contextMode.validation",
					),
				}] :
				[]),
		]
	const defaultAction = {
		value: "select" as const,
		label: translate(
			locale,
			rootFolder === null ?
				"folder.select" :
				"folder.change",
		),
	}
	const actions: Array<{
		value: FolderAction
		label: string
	}> = [
			defaultAction,
			...(rootFolder === null ?
				[] :
				[
					{
						value: "explorer" as const,
						label: translate(
							locale,
							"folder.openExplorer",
						),
					},
					...(vscodeAvailable ?
						[{
							value: "vscode" as const,
							label: translate(
								locale,
								"folder.openVscode",
							),
						}] :
						[]),
					{
						value: "close" as const,
						label: translate(
							locale,
							"folder.close",
						),
					},
				]),
		]
	const currentAction = actions.find(action => action.value === selectedAction) ?? defaultAction

	function executeAction(action: FolderAction): void {
		if (action === "select")
			onSelectFolder()
		else if (action === "explorer")
			onOpenFolder()
		else if (action === "vscode")
			onOpenVscode()
		else {
			onSelectedActionChange("select")
			onCloseFolder()
		}
	}

	return (
		<section className={styles.container}>
			<header className={styles.header}>
				<h2 className={styles.title}>
					{sectionName}
				</h2>

				<CollapseToggle
					controlsId={detailsId}
					expanded={expanded}
					label={toggleLabel}
					className={styles.toggleButton}
					onToggle={() => onExpandedChange(!expanded)}
				/>
			</header>

			{rootFolder !== null && (
				<div
					className={styles.contextModeBar}
					role="group"
					aria-label={translate(
						locale,
						"folder.contextMode.label",
					)}
				>
					{contextModes.map(option => (
						<button
							key={option.mode}
							type="button"
							aria-pressed={selectedMode === option.mode}
							className={styles.contextModeButton({
								selected: selectedMode === option.mode,
							})}
							disabled={disabled}
							onClick={() => onContextModeChange(option.mode)}
						>
							{option.label}
						</button>
					))}
				</div>
			)}

			<CollapsibleRegion
				id={detailsId}
				expanded={expanded}
				innerClassName={styles.collapseInner}
			>
				<div className={styles.projectControls}>
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
						className={styles.pathInput}
						suffix={rootFolder === null ?
							undefined :
							<button
								type="button"
								className={styles.devIgnoreButton}
								disabled={disabled || projectIgnoreExists === null}
								title={translate(
									locale,
									projectIgnoreExists === null ?
										"folder.devIgnore.loading" :
										projectIgnoreExists ?
											"folder.devIgnore.open" :
											"folder.devIgnore.create",
								)}
								onClick={onDevIgnore}
							>
								<ShieldCheck
									size={14}
									strokeWidth={2}
									aria-hidden="true"
								/>
								<span>
									{translate(
										locale,
										"folder.devIgnore.label",
									)}
								</span>
							</button>}
						readOnly
					/>

					<div
						className={styles.actionsField}
						onBlur={event => {
							const nextTarget = event.relatedTarget

							if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget))
								setActionMenuOpen(false)
						}}
					>
						<span className={styles.actionsLabel}>
							{translate(
								locale,
								"folder.actions.label",
							)}
						</span>

						<div className={styles.actionControl}>
							<button
								type="button"
								className={styles.actionExecuteButton}
								disabled={disabled}
								onClick={() => executeAction(currentAction.value)}
							>
								{currentAction.label}
							</button>

							<button
								type="button"
								aria-haspopup="menu"
								aria-expanded={actionMenuOpen}
								aria-label={translate(
									locale,
									"folder.actions.label",
								)}
								className={styles.actionMenuButton}
								disabled={disabled}
								onClick={() => setActionMenuOpen(open => !open)}
							>
								<ChevronDown
									size={14}
									aria-hidden="true"
								/>
							</button>

							{actionMenuOpen && (
								<div
									role="menu"
									className={styles.actionMenu}
								>
									{actions.map(action => (
										<button
											key={action.value}
											type="button"
											role="menuitem"
											className={styles.actionMenuItem({
												selected: action.value === currentAction.value,
											})}
											onClick={() => {
												onSelectedActionChange(action.value)
												setActionMenuOpen(false)
											}}
										>
											{action.label}
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</CollapsibleRegion>

			{children}
		</section>
	)
}
