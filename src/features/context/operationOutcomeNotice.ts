import type {
	OperationCounter,
	OperationOutcome,
} from "./operationOutcome"
import type { AppNotice } from "./types"
import {
	type Locale,
	translate,
	translateCount,
	type TranslationKey,
	type TranslationVariables,
} from "@/infra/i18n"

function formatEntityCounts(
	locale: Locale,
	files: number,
	directories: number,
	affectedDirectories: boolean,
): string {
	return [
		translateCount(
			locale,
			files,
			"status.files.one",
			"status.files.other",
		),
		translateCount(
			locale,
			directories,
			affectedDirectories ?
				"status.affectedDirectories.one" :
				"status.directories.one",
			affectedDirectories ?
				"status.affectedDirectories.other" :
				"status.directories.other",
		),
	].join(" · ")
}

function counterLabelKey(outcome: OperationOutcome, counter: OperationCounter): TranslationKey | null {
	if (counter.kind === "added")
		return "status.context.added"
	if (counter.kind === "already_present")
		return "status.context.present"
	if (counter.kind === "removed")
		return "status.context.removed"
	if (counter.kind === "not_present")
		return "status.context.notPresent"
	if (counter.kind === "filtered")
		return "status.context.filtered"
	if (counter.kind === "skipped") {
		return outcome.operationType === "files_apply" ?
			"status.apply.skippedLabel" :
			"status.context.skipped"
	}
	if (counter.kind === "materialized")
		return "status.context.exported"
	if (counter.kind === "unavailable")
		return "status.context.unavailableAtExport"
	if (counter.kind === "created")
		return "status.apply.created"
	if (counter.kind === "edited")
		return "status.apply.edited"
	if (counter.kind === "deleted")
		return "status.apply.deleted"
	if (counter.kind === "unchanged")
		return "status.apply.unchanged"
	if (counter.kind === "rejected")
		return "status.apply.rejectedLabel"
	if (counter.kind === "changed") {
		return outcome.operationType === "dev_ignore_add" ?
			"status.ignore.added" :
			"status.ignore.removed"
	}
	if (counter.kind === "already_in_state")
		return "status.ignore.unchanged"
	if (counter.kind === "restored")
		return "status.undo.restored"
	if (counter.kind === "removed_by_undo")
		return "status.undo.removed"

	return null
}

function formatCounter(
	locale: Locale,
	outcome: OperationOutcome,
	counter: OperationCounter,
): string | null {
	if (counter.kind === "lines") {
		return translate(
			locale,
			"status.apply.lines",
			{
				added: counter.addedLines ?? 0,
				deleted: counter.deletedLines ?? 0,
			},
		)
	}

	const labelKey = counterLabelKey(
		outcome,
		counter,
	)

	if (labelKey === null)
		return null

	const affectedDirectories = outcome.operationType === "files_apply" ||
		outcome.operationType === "git_apply"

	return `${translate(
		locale,
		labelKey,
	)}: ${formatEntityCounts(
		locale,
		counter.files,
		counter.directories,
		affectedDirectories,
	)}`
}

export function operationOutcomeNoticeKind(outcome: OperationOutcome): AppNotice["kind"] {
	if (outcome.status === "success")
		return "success"
	if (outcome.status === "partial" || outcome.status === "blocked")
		return "warning"
	if (outcome.status === "failed")
		return "error"

	return "info"
}

export function createOperationOutcomeNotice(
	locale: Locale,
	outcome: OperationOutcome,
	messageKey: TranslationKey,
	messageVariables: TranslationVariables = {},
	extraDetails: readonly string[] = [],
): AppNotice {
	const counterDetails = outcome.counters
		.map(counter => formatCounter(
			locale,
			outcome,
			counter,
		))
		.filter((detail): detail is string => detail !== null)

	return {
		kind: operationOutcomeNoticeKind(outcome),
		message: translate(
			locale,
			messageKey,
			messageVariables,
		),
		details: [
			...counterDetails,
			...extraDetails,
			...outcome.warnings,
			...outcome.failures,
		],
		outcome,
	}
}
