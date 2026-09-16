import type {
	GitPatchChange,
	GitPatchChangeKind,
	PendingGitPatch,
} from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Dialog } from "@/shared/components/Dialog"
import { FileDiff } from "lucide-react"

interface GitPatchPreviewDialogProps {
	pendingPatch: PendingGitPatch
	disabled: boolean
	locale: Locale
	onCancel: () => void
	onConfirm: () => void
}

function getChangePath(change: GitPatchChange): string {
	if (change.kind === "rename" && change.previousPath !== null)
		return `${change.previousPath} → ${change.relativePath}`

	return change.relativePath
}

function getKindLabel(
	locale: Locale,
	kind: GitPatchChangeKind,
): string {
	return translate(
		locale,
		`gitPatch.kind.${kind}`,
	)
}

export function GitPatchPreviewDialog({
	pendingPatch,
	disabled,
	locale,
	onCancel,
	onConfirm,
}: GitPatchPreviewDialogProps) {
	const createdFiles = pendingPatch.changes.filter(change => change.kind === "create").length
	const modifiedFiles = pendingPatch.changes.filter(change => change.kind === "modify").length
	const deletedFiles = pendingPatch.changes.filter(change => change.kind === "delete").length
	const renamedFiles = pendingPatch.changes.filter(change => change.kind === "rename").length
	const fileSummary = translateCount(
		locale,
		pendingPatch.fileCount,
		"gitPatch.files.one",
		"gitPatch.files.other",
	)

	return (
		<Dialog
			backdropClassName={styles.backdrop}
			dialogClassName={styles.dialog}
			labelledBy="git-patch-preview-title"
			disabled={disabled}
			onCancel={onCancel}
		>
			<div className={styles.heading}>
				<div className={styles.headingIcon}>
					<FileDiff
						size={16}
						strokeWidth={2}
						aria-hidden="true"
					/>
				</div>

				<div className={styles.headingContent}>
					<h2
						id="git-patch-preview-title"
						className={styles.title}
					>
						{translate(
							locale,
							"gitPatch.title",
						)}
					</h2>

					<p className={styles.description}>
						{translate(
							locale,
							"gitPatch.description",
							{ patch: pendingPatch.patchName },
						)}
					</p>
				</div>
			</div>

			<div className={styles.summary}>
				<span>{fileSummary}</span>
				<span>+{pendingPatch.addedLines}</span>
				<span>−{pendingPatch.deletedLines}</span>
			</div>

			<p className={styles.breakdown}>
				{translate(
					locale,
					"gitPatch.breakdown",
					{
						created: createdFiles,
						modified: modifiedFiles,
						deleted: deletedFiles,
						renamed: renamedFiles,
					},
				)}
			</p>

			<div className={styles.changes}>
				{pendingPatch.changes.map((change, index) => (
					<div
						key={`${change.relativePath}:${change.previousPath ?? ""}:${index}`}
						className={styles.change}
					>
						<span className={styles.kind}>
							{getKindLabel(
								locale,
								change.kind,
							)}
						</span>

						<span className={styles.path}>
							{getChangePath(change)}
						</span>

						<span className={styles.lineStats}>
							+{change.addedLines} −{change.deletedLines}
						</span>
					</div>
				))}
			</div>

			<p className={styles.safetyNote}>
				{translate(
					locale,
					"gitPatch.safety",
				)}
			</p>

			<div className={styles.actions}>
				<Button
					variant="ghost"
					disabled={disabled}
					onClick={onCancel}
				>
					{translate(
						locale,
						"gitPatch.cancel",
					)}
				</Button>

				<Button
					disabled={disabled}
					onClick={onConfirm}
				>
					{translate(
						locale,
						"gitPatch.apply",
					)}
				</Button>
			</div>
		</Dialog>
	)
}
