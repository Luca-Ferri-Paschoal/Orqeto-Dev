export type OperationOutcomeStatus = "success" |
	"partial" |
	"no_op" |
	"cancelled" |
	"failed" |
	"blocked"

export type OperationOutcomeType = "context_add" |
	"context_remove" |
	"context_materialize" |
	"dev_ignore_add" |
	"dev_ignore_remove" |
	"files_apply" |
	"git_apply" |
	"undo"

export type OperationCounterKind = "added" |
	"already_present" |
	"removed" |
	"not_present" |
	"filtered" |
	"skipped" |
	"materialized" |
	"unavailable" |
	"created" |
	"edited" |
	"deleted" |
	"unchanged" |
	"rejected" |
	"changed" |
	"already_in_state" |
	"restored" |
	"removed_by_undo" |
	"lines"

export interface OperationCounter {
	kind: OperationCounterKind
	files: number
	directories: number
	addedLines?: number
	deletedLines?: number
}

export interface OperationUndoReference {
	operationId: string
	projectRoot: string
	appliedAtUnixMs: number
}

export interface OperationOutcome {
	operationId: string
	operationType: OperationOutcomeType
	projectRoot: string | null
	status: OperationOutcomeStatus
	counters: OperationCounter[]
	warnings: string[]
	failures: string[]
	undoReference: OperationUndoReference | null
}

export interface ApplyBackendResultLike {
	operationId: string
	appliedAtUnixMs: number | null
	addedFiles: number
	replacedFiles: number
	deletedFiles: number
	unchangedFiles?: number
	addedDirectories: number
	replacedDirectories: number
	deletedDirectories: number
	unchangedDirectories?: number
}

export interface GitApplyBackendResultLike extends ApplyBackendResultLike {
	addedLines: number
	deletedLines: number
}

export interface UndoBackendResultLike {
	operationId: string
	restoredFiles: number
	removedFiles: number
}

export interface ProjectIgnoreBackendResultLike {
	operationId: string
	changedFiles: number
	changedDirectories: number
	unchangedFiles: number
	unchangedDirectories: number
}

export interface OutcomeStatusInput {
	changed: number
	unchanged?: number
	rejected?: number
	skipped?: number
	warnings?: number
	failures?: number
	cancelled?: boolean
	blocked?: boolean
}

let clientOperationSequence = 0

export function createClientOperationId(operationType: OperationOutcomeType): string {
	clientOperationSequence += 1

	return `${operationType}:${Date.now()}:${clientOperationSequence}`
}

export function deriveOperationOutcomeStatus({
	changed,
	unchanged = 0,
	rejected = 0,
	skipped = 0,
	warnings = 0,
	failures = 0,
	cancelled = false,
	blocked = false,
}: OutcomeStatusInput): OperationOutcomeStatus {
	if (blocked)
		return "blocked"

	if (cancelled)
		return "cancelled"

	if (failures > 0) {
		return changed > 0 || unchanged > 0 ?
			"partial" :
			"failed"
	}

	if (rejected > 0 || skipped > 0 || warnings > 0)
		return "partial"

	if (changed > 0)
		return "success"

	return "no_op"
}

export function createOperationOutcome({
	operationId,
	operationType,
	projectRoot,
	status,
	counters,
	warnings = [],
	failures = [],
	undoReference = null,
}: {
	operationId?: string
	operationType: OperationOutcomeType
	projectRoot: string | null
	status: OperationOutcomeStatus
	counters: OperationCounter[]
	warnings?: string[]
	failures?: string[]
	undoReference?: OperationUndoReference | null
}): OperationOutcome {
	const resolvedOperationId = operationId ?? createClientOperationId(operationType)
	const allowsUndo = status === "success" || status === "partial"

	return {
		operationId: resolvedOperationId,
		operationType,
		projectRoot,
		status,
		counters,
		warnings,
		failures,
		undoReference: allowsUndo ?
			undoReference :
			null,
	}
}

export function filesApplyOutcomeFromResult(
	projectRoot: string | null,
	result: ApplyBackendResultLike,
	options: {
		rejectedFiles?: number
		skippedFiles?: number
		warnings?: string[]
		failures?: string[]
	} = {},
): OperationOutcome {
	const rejectedFiles = options.rejectedFiles ?? 0
	const skippedFiles = options.skippedFiles ?? 0
	const warnings = options.warnings ?? []
	const failures = options.failures ?? []
	const changed = result.addedFiles + result.replacedFiles + result.deletedFiles
	const unchanged = result.unchangedFiles ?? 0
	const status = deriveOperationOutcomeStatus({
		changed,
		unchanged,
		rejected: rejectedFiles,
		skipped: skippedFiles,
		warnings: warnings.length,
		failures: failures.length,
	})
	const undoReference = changed > 0 && result.appliedAtUnixMs !== null && projectRoot !== null ?
		{
			operationId: result.operationId,
			projectRoot,
			appliedAtUnixMs: result.appliedAtUnixMs,
		} :
		null
	const counters: OperationCounter[] = [
		{
			kind: "created",
			files: result.addedFiles,
			directories: result.addedDirectories,
		},
		{
			kind: "edited",
			files: result.replacedFiles,
			directories: result.replacedDirectories,
		},
		{
			kind: "deleted",
			files: result.deletedFiles,
			directories: result.deletedDirectories,
		},
		{
			kind: "unchanged",
			files: unchanged,
			directories: result.unchangedDirectories ?? 0,
		},
	]

	if (rejectedFiles > 0) {
		counters.push({
			kind: "rejected",
			files: rejectedFiles,
			directories: 0,
		})
	}
	if (skippedFiles > 0) {
		counters.push({
			kind: "skipped",
			files: skippedFiles,
			directories: 0,
		})
	}

	return createOperationOutcome({
		operationId: result.operationId,
		operationType: "files_apply",
		projectRoot,
		status,
		counters,
		warnings,
		failures,
		undoReference,
	})
}

export function gitApplyOutcomeFromResult(
	projectRoot: string,
	result: GitApplyBackendResultLike,
): OperationOutcome {
	const base = filesApplyOutcomeFromResult(
		projectRoot,
		result,
	)

	return {
		...base,
		operationType: "git_apply",
		counters: [
			...base.counters.filter(counter => counter.kind !== "unchanged"),
			{
				kind: "lines",
				files: 0,
				directories: 0,
				addedLines: result.addedLines,
				deletedLines: result.deletedLines,
			},
		],
	}
}

export function projectIgnoreOutcomeFromResult(
	projectRoot: string,
	ignorePaths: boolean,
	result: ProjectIgnoreBackendResultLike,
): OperationOutcome {
	const changed = result.changedFiles + result.changedDirectories
	const unchanged = result.unchangedFiles + result.unchangedDirectories

	return createOperationOutcome({
		operationId: result.operationId,
		operationType: ignorePaths ?
			"dev_ignore_add" :
			"dev_ignore_remove",
		projectRoot,
		status: deriveOperationOutcomeStatus({
			changed,
			unchanged,
		}),
		counters: [
			{
				kind: "changed",
				files: result.changedFiles,
				directories: result.changedDirectories,
			},
			{
				kind: "already_in_state",
				files: result.unchangedFiles,
				directories: result.unchangedDirectories,
			},
		],
	})
}

export function undoOutcomeFromResult(
	projectRoot: string,
	result: UndoBackendResultLike,
): OperationOutcome {
	return createOperationOutcome({
		operationId: result.operationId,
		operationType: "undo",
		projectRoot,
		status: "success",
		counters: [
			{
				kind: "restored",
				files: result.restoredFiles,
				directories: 0,
			},
			{
				kind: "removed_by_undo",
				files: result.removedFiles,
				directories: 0,
			},
		],
	})
}

export function isContextualUndoEligible(
	reference: OperationUndoReference,
	latestHistoryEntry: { operationId: string } | null | undefined,
): boolean {
	return latestHistoryEntry?.operationId === reference.operationId
}

export type RoutedApplyState = "applied" |
	"already_applied" |
	"resolve" |
	"git_preview" |
	"undone"

export function getRoutedApplyMessageKey(state: RoutedApplyState): "projectRoute.switchedApplied" |
	"projectRoute.switchedAlreadyApplied" |
	"projectRoute.switchedResolve" |
	"projectRoute.switchedGitPreview" |
	"projectRoute.undoDone" {
	if (state === "applied")
		return "projectRoute.switchedApplied"

	if (state === "already_applied")
		return "projectRoute.switchedAlreadyApplied"

	if (state === "resolve")
		return "projectRoute.switchedResolve"

	if (state === "git_preview")
		return "projectRoute.switchedGitPreview"

	return "projectRoute.undoDone"
}
