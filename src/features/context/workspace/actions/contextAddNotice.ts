import {
	createOperationOutcome,
	deriveOperationOutcomeStatus,
} from "../../operationOutcome"
import { createOperationOutcomeNotice } from "../../operationOutcomeNotice"
import type { AppNotice } from "../../types"
import type { ContextSelectionActionStats } from "../types"
import { getErrorMessage } from "@/features/context/utils"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

interface ContextAddNoticeInput {
	locale: Locale
	projectRoot: string
	actionStats: ContextSelectionActionStats
	exportSkippedFiles: number
	exportSkippedDirectories: number
	copyAfterAdd: boolean
	contextCopiedAfterAdd: boolean
	autoCopyError: unknown
	filterHistoryError: unknown
}

export function createContextAddNotice(input: ContextAddNoticeInput): AppNotice {
	const warnings: string[] = []
	const extraDetails: string[] = []
	if (input.copyAfterAdd && input.contextCopiedAfterAdd) {
		extraDetails.push(translate(
			input.locale,
			"workspace.contextCopiedAfterAdd",
		))
	}
	if (input.autoCopyError !== null) {
		warnings.push(translate(
			input.locale,
			input.copyAfterAdd ?
				"workspace.contextCopyAfterAddFailed" :
				"workspace.autoCopyFailed",
			{
				error: getErrorMessage(
					input.autoCopyError,
					input.locale,
				),
			},
		))
	}
	if (input.filterHistoryError !== null) {
		warnings.push(translate(
			input.locale,
			"workspace.filterHistoryFailed",
		))
	}

	const skippedFiles = input.actionStats.skippedFiles + input.exportSkippedFiles
	const skippedDirectories = input.actionStats.skippedDirectories + input.exportSkippedDirectories
	const outcome = createOperationOutcome({
		operationType: "context_add",
		projectRoot: input.projectRoot,
		status: deriveOperationOutcomeStatus({
			changed: input.actionStats.addedFiles,
			unchanged: input.actionStats.unchangedFiles,
			skipped: skippedFiles + skippedDirectories,
			warnings: warnings.length,
		}),
		counters: [
			{ kind: "added", files: input.actionStats.addedFiles, directories: input.actionStats.addedDirectories },
			{ kind: "already_present", files: input.actionStats.unchangedFiles, directories: input.actionStats.unchangedDirectories },
			{ kind: "skipped", files: input.actionStats.skippedFiles, directories: input.actionStats.skippedDirectories },
			{ kind: "unavailable", files: input.exportSkippedFiles, directories: input.exportSkippedDirectories },
		],
		warnings,
	})
	return createOperationOutcomeNotice(
		input.locale,
		outcome,
		"workspace.contextSelectionUpdated",
		{},
		extraDetails,
	)
}
