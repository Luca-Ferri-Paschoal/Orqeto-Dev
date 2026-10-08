export type ContextFilterTarget = "fileName" | "path"
export type ContextFilterMode = "contains" | "exact" | "regex"

export interface ContextFilter {
	pattern: string
	target: ContextFilterTarget
	mode: ContextFilterMode
}

export interface ContextFilterHistoryEntry extends ContextFilter {
	lastUsedAt: number
}
