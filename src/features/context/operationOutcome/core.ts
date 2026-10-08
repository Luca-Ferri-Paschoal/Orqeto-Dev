import type {
	ClientOperationIdNamespace,
	OperationCounter,
	OperationOutcome,
	OperationOutcomeStatus,
	OperationOutcomeType,
	OperationUndoReference,
	OutcomeStatusInput,
} from "./types.ts"

let clientOperationSequence = 0

export function createClientOperationId(operationType: ClientOperationIdNamespace): string {
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
