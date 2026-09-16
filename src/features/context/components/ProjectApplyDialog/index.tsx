import type { WorkMode } from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Dialog } from "@/shared/components/Dialog"
import { FolderGit2 } from "lucide-react"
import {
	type ChangeEvent,
	useMemo,
	useState,
} from "react"

export interface ProjectApplyChoice {
	tabId: string
	projectName: string
	destinationPath: string | null
	destinationCount: number
	available: boolean
	unavailableReason?: "busy" | "tooAmbiguous"
}

interface ProjectApplyDialogProps {
	mode: WorkMode
	locale: Locale
	sourceLabel: string
	projects: ProjectApplyChoice[]
	allowCurrentRoot: boolean
	currentProjectName: string
	disabled: boolean
	onCancel: () => void
	onSelectProject: (tabId: string) => void
	onSelectCurrentRoot: () => void
}

const ROOT_VALUE = "__current-root__"

function getProjectOptionLabel(
	project: ProjectApplyChoice,
	locale: Locale,
	mode: WorkMode,
): string {
	if (!project.available) {
		return translate(
			locale,
			project.unavailableReason === "tooAmbiguous" ?
				"projectRoute.projectTooAmbiguous" :
				"projectRoute.projectBusy",
			{ project: project.projectName },
		)
	}

	if (mode === "git") {
		return translate(
			locale,
			"projectRoute.gitProjectOption",
			{ project: project.projectName },
		)
	}

	if (project.destinationCount === 1 && project.destinationPath !== null) {
		return translate(
			locale,
			"projectRoute.projectPathOption",
			{
				project: project.projectName,
				path: project.destinationPath,
			},
		)
	}

	return translateCount(
		locale,
		project.destinationCount,
		"projectRoute.projectDestinations.one",
		"projectRoute.projectDestinations.other",
		{ project: project.projectName },
	)
}

export function ProjectApplyDialog({
	mode,
	locale,
	sourceLabel,
	projects,
	allowCurrentRoot,
	currentProjectName,
	disabled,
	onCancel,
	onSelectProject,
	onSelectCurrentRoot,
}: ProjectApplyDialogProps) {
	const firstAvailableProject = projects.find(project => project.available)
	const initialValue = firstAvailableProject?.tabId ?? (allowCurrentRoot ?
		ROOT_VALUE :
		"")
	const selectionKey = JSON.stringify({
		mode,
		sourceLabel,
		allowCurrentRoot,
		projects: projects.map(project => ({
			tabId: project.tabId,
			available: project.available,
			destinationPath: project.destinationPath,
			destinationCount: project.destinationCount,
		})),
	})
	const [selection, setSelection] = useState({
		key: selectionKey,
		value: initialValue,
	})
	const selectedValue = selection.key === selectionKey ?
		selection.value :
		initialValue

	const selectedProject = useMemo(
		() => projects.find(project => project.tabId === selectedValue) ?? null,
		[
			projects,
			selectedValue,
		],
	)
	const selectedIsRoot = selectedValue === ROOT_VALUE
	const canContinue = selectedIsRoot ?
		allowCurrentRoot :
		selectedProject?.available === true

	function handleContinue(): void {
		if (!canContinue)
			return

		if (selectedIsRoot) {
			onSelectCurrentRoot()
			return
		}

		if (selectedProject !== null)
			onSelectProject(selectedProject.tabId)
	}

	return (
		<Dialog
			backdropClassName={styles.backdrop}
			dialogClassName={styles.dialog}
			labelledBy="project-apply-title"
			disabled={disabled}
			onCancel={onCancel}
		>
			<div className={styles.heading}>
				<div className={styles.headingIcon}>
					<FolderGit2
						size={16}
						strokeWidth={2}
						aria-hidden="true"
					/>
				</div>

				<div>
					<h2
						id="project-apply-title"
						className={styles.title}
					>
						{translate(
							locale,
							mode === "git" ?
								"projectRoute.gitTitle" :
								"projectRoute.filesTitle",
						)}
					</h2>

					<p className={styles.description}>
						{translate(
							locale,
							mode === "git" ?
								"projectRoute.gitDescription" :
								"projectRoute.filesDescription",
							{ source: sourceLabel },
						)}
					</p>
				</div>
			</div>

			<label className={styles.field}>
				<span className={styles.label}>
					{translate(
						locale,
						"projectRoute.selectLabel",
					)}
				</span>

				<select
					className={styles.select}
					value={selectedValue}
					disabled={disabled}
					onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelection({
						key: selectionKey,
						value: event.currentTarget.value,
					})}
				>
					{projects.map(project => (
						<option
							key={project.tabId}
							value={project.tabId}
							disabled={!project.available}
						>
							{getProjectOptionLabel(
								project,
								locale,
								mode,
							)}
						</option>
					))}

					{allowCurrentRoot && (
						<option value={ROOT_VALUE}>
							{translate(
								locale,
								"projectRoute.currentRootOption",
								{ project: currentProjectName },
							)}
						</option>
					)}
				</select>
			</label>

			<div className={styles.selectionDetails}>
				{selectedIsRoot ?
					translate(
						locale,
						"projectRoute.currentRootDetails",
						{ project: currentProjectName },
					) :
					selectedProject !== null && (
						mode === "git" ?
							translate(
								locale,
								"projectRoute.gitProjectDetails",
								{ project: selectedProject.projectName },
							) :
							selectedProject.destinationCount === 1 && selectedProject.destinationPath !== null ?
								translate(
									locale,
									"projectRoute.exactDestinationDetails",
									{ path: selectedProject.destinationPath },
								) :
								translateCount(
									locale,
									selectedProject.destinationCount,
									"projectRoute.internalResolver.one",
									"projectRoute.internalResolver.other",
								)
					)}
			</div>

			<div className={styles.actions}>
				<Button
					variant="ghost"
					disabled={disabled}
					onClick={onCancel}
				>
					{translate(
						locale,
						"projectRoute.cancel",
					)}
				</Button>

				<Button
					disabled={disabled || !canContinue}
					onClick={handleContinue}
				>
					{translate(
						locale,
						"projectRoute.continue",
					)}
				</Button>
			</div>
		</Dialog>
	)
}
