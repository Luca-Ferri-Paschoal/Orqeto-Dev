import {
	createOperationOutcome,
	deriveOperationOutcomeStatus,
} from "./core.ts"
import type {
	OperationOutcome,
	ProjectIgnoreBackendResultLike,
	UndoBackendResultLike,
} from "./types.ts"

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
		status: deriveOperationOutcomeStatus({ changed, unchanged }),
		counters: [
			{ kind: "changed", files: result.changedFiles, directories: result.changedDirectories },
			{ kind: "already_in_state", files: result.unchangedFiles, directories: result.unchangedDirectories },
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
			{ kind: "restored", files: result.restoredFiles, directories: 0 },
			{ kind: "removed_by_undo", files: result.removedFiles, directories: 0 },
		],
	})
}
