import {
	createOperationOutcome,
	deriveOperationOutcomeStatus,
} from "./core.ts"
import type {
	ApplyBackendResultLike,
	GitApplyBackendResultLike,
	OperationCounter,
	OperationOutcome,
} from "./types.ts"

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
	const protectedSecretFiles = result.protectedSecretFiles ?? 0
	const detectedSecrets = result.detectedSecrets ?? 0
	const skippedFiles = options.skippedFiles ?? 0
	const warnings = options.warnings ?? []
	const failures = [
		...(options.failures ?? []),
		...(result.permanentDeletionError === undefined ?
			[] :
			[result.permanentDeletionError]),
	]
	const reversibleChanged = result.addedFiles + result.replacedFiles + result.deletedFiles +
		result.addedDirectories + result.replacedDirectories + result.deletedDirectories
	const changed = reversibleChanged + (result.permanentDeletedFiles ?? 0) + (result.permanentDeletedDirectories ?? 0)
	const unchanged = result.unchangedFiles ?? 0
	const status = deriveOperationOutcomeStatus({
		changed,
		unchanged,
		rejected: rejectedFiles + protectedSecretFiles,
		skipped: skippedFiles,
		warnings: warnings.length,
		failures: failures.length,
	})
	const undoReference = reversibleChanged > 0 && result.appliedAtUnixMs !== null && projectRoot !== null ?
		{
			operationId: result.operationId,
			projectRoot,
			appliedAtUnixMs: result.appliedAtUnixMs,
		} :
		null
	const counters: OperationCounter[] = [
		{ kind: "created", files: result.addedFiles, directories: result.addedDirectories },
		{ kind: "edited", files: result.replacedFiles, directories: result.replacedDirectories },
		{ kind: "deleted", files: result.deletedFiles, directories: result.deletedDirectories },
		...(result.permanentDeletedFiles !== undefined || result.permanentDeletedDirectories !== undefined ?
			[{
				kind: "permanent_deleted" as const,
				files: result.permanentDeletedFiles ?? 0,
				directories: result.permanentDeletedDirectories ?? 0,
			}] :
			[]),
		{ kind: "unchanged", files: unchanged, directories: result.unchangedDirectories ?? 0 },
	]
	if (rejectedFiles > 0)
		counters.push({ kind: "rejected", files: rejectedFiles, directories: 0 })
	if (protectedSecretFiles > 0) {
		counters.push({
			kind: "protected",
			files: protectedSecretFiles,
			directories: 0,
			detectedSecrets,
		})
	}
	if (skippedFiles > 0)
		counters.push({ kind: "skipped", files: skippedFiles, directories: 0 })
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
