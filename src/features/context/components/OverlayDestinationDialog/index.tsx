import type {
	OverlayDestinationCandidate,
	PendingProjectOverlay,
} from "../../types"
import { styles } from "./style"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { Dialog } from "@/shared/components/Dialog"
import {
	FolderTree,
	GitCompareArrows,
} from "lucide-react"
import { useState } from "react"

interface OverlayDestinationDialogProps {
	pendingOverlay: PendingProjectOverlay
	disabled: boolean
	locale: Locale
	onCancel: () => void
	onConfirm: (candidate: OverlayDestinationCandidate) => void
}

function getCandidateDetails(
	candidate: OverlayDestinationCandidate,
	locale: Locale,
): string {
	const details = [
		translateCount(
			locale,
			candidate.matchedFiles,
			"overlay.matchedFiles.one",
			"overlay.matchedFiles.other",
		),
		translateCount(
			locale,
			candidate.matchedDirectories,
			"overlay.matchedDirectories.one",
			"overlay.matchedDirectories.other",
		),
	]

	if (candidate.sourceContextMatches > 0) {
		details.push(translateCount(
			locale,
			candidate.sourceContextMatches,
			"overlay.sourceLevels.one",
			"overlay.sourceLevels.other",
		))
	}

	return details.join(" · ")
}

export function OverlayDestinationDialog({
	pendingOverlay,
	disabled,
	locale,
	onCancel,
	onConfirm,
}: OverlayDestinationDialogProps) {
	const [selectedIndex, setSelectedIndex] = useState(0)
	const selectedCandidate = pendingOverlay.candidates[selectedIndex] ?? null
	const description = translateCount(
		locale,
		pendingOverlay.fileCount,
		"overlay.description.one",
		"overlay.description.other",
		{
			source: pendingOverlay.sourceLabel,
		},
	)
	const progress = translate(
		locale,
		"overlay.progress",
		{
			current: pendingOverlay.queuePosition,
			total: pendingOverlay.queueTotal,
		},
	)

	return (
		<Dialog
			backdropClassName={styles.backdrop}
			dialogClassName={styles.dialog}
			labelledBy="overlay-destination-title"
			disabled={disabled}
			onCancel={onCancel}
		>
			<div className={styles.heading}>
				<div className={styles.headingIcon}>
					<GitCompareArrows
						size={16}
						strokeWidth={2}
						aria-hidden="true"
					/>
				</div>

				<div>
					<h2
						id="overlay-destination-title"
						className={styles.title}
					>
						{translate(
							locale,
							"overlay.title",
						)}
					</h2>

					<p className={styles.description}>
						{progress}
					</p>

					<p className={styles.description}>
						{description}
					</p>
				</div>
			</div>

			<div className={styles.candidates}>
				{pendingOverlay.candidates.map((
					candidate,
					index,
				) => (
					<button
						key={`${candidate.destinationRelativePath}:${candidate.sourcePrefix}`}
						type="button"
						className={styles.candidate({
							selected: index === selectedIndex,
						})}
						disabled={disabled}
						onClick={() => setSelectedIndex(index)}
					>
						<FolderTree
							size={14}
							strokeWidth={2}
							aria-hidden="true"
						/>

						<span className={styles.candidateContent}>
							<strong className={styles.candidatePath}>
								{candidate.destinationRelativePath}
							</strong>

							<span className={styles.candidateDetails}>
								{getCandidateDetails(
									candidate,
									locale,
								)}
							</span>
						</span>
					</button>
				))}
			</div>

			<div className={styles.actions}>
				<Button
					variant="ghost"
					disabled={disabled}
					onClick={onCancel}
				>
					{translate(
						locale,
						"overlay.skip",
					)}
				</Button>

				<Button
					disabled={disabled || selectedCandidate === null}
					onClick={() => {
						if (selectedCandidate !== null)
							onConfirm(selectedCandidate)
					}}
				>
					{translate(
						locale,
						"overlay.applyHere",
					)}
				</Button>
			</div>
		</Dialog>
	)
}
