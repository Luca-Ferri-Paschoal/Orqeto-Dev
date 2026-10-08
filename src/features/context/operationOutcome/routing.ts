import type { OperationUndoReference } from "./types.ts"

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
