export const EXTERNAL_ACTIONS_PENDING_EVENT = "external-actions-pending"

export type PendingExternalSelectionAction = {
	type: "add" | "addAndCopy" | "remove"
	target: "context" | "ignore"
	paths: string[]
}
