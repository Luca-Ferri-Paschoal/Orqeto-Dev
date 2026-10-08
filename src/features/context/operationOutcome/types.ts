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

export type ClientOperationIdNamespace = OperationOutcomeType | "validation_operation"

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
	"protected" |
	"permanent_deleted" |
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
	detectedSecrets?: number
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
	protectedSecretFiles?: number
	detectedSecrets?: number
	permanentDeletedFiles?: number
	permanentDeletedDirectories?: number
	permanentDeletionError?: string
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
