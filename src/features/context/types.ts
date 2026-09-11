import type { Locale } from "@/infra/i18n"

export const HISTORY_LIMIT_MIN = 1
export const HISTORY_LIMIT_MAX = 100
export const DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT = 10
export const DEFAULT_CONTEXT_HISTORY_LIMIT = 5
export const DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT = 10
export const DEFAULT_APP_THEME = "light"

export type AppTheme = "light" | "dark"

export interface GeneratedFile {
	relativePath: string
	content: string | null
}

export interface SkippedFile {
	relativePath: string
	reason: string
}

export interface ProcessDropResult {
	files: GeneratedFile[]
	skippedFiles: SkippedFile[]
}

export interface ContextRemovalPath {
	relativePath: string
	isDirectory: boolean
}

export interface ContextHistoryEntry {
	id: number
	content: string
	fileCount: number
	byteCount: number
	createdAt: number
}

export interface OverlayDestinationCandidate {
	destinationRelativePath: string
	sourcePrefix: string
	matchedFiles: number
	matchedDirectories: number
	sourceContextMatches: number
}

export interface PrepareProjectOverlayResult {
	fileCount: number
	deleteCount: number
	candidates: OverlayDestinationCandidate[]
	recommendedCandidateIndex: number | null
	candidateCount: number
	ambiguityLimit: number
	ambiguityLimitExceeded: boolean
}

export interface ApplyProjectOverlayResult {
	addedFiles: number
	replacedFiles: number
	deletedFiles: number
}

export interface UndoProjectOverlayResult {
	restoredFiles: number
	removedFiles: number
	undoneBatches: number
	remainingHistoryEntries: number
}

export interface OverlayUndoHistoryEntry {
	steps: number
	addedFiles: number
	replacedFiles: number
	deletedFiles: number
	appliedAtUnixMs: number
}

export interface PendingProjectOverlay {
	paths: string[]
	sourceLabel: string
	fileCount: number
	deleteCount: number
	candidates: OverlayDestinationCandidate[]
	queuePosition: number
	queueTotal: number
}

export type ExternalAction = | {
	type: "openRoot"
	path: string
} |
{
	type: "addContext"
	paths: string[]
} |
{
	type: "removeContext"
	paths: string[]
}

export interface AppSettings {
	locale: Locale
	theme: AppTheme
	autoCopyContextAfterAdd: boolean
	autoClearAfterExport: boolean
	contextFilterHistoryLimit: number
	contextHistoryLimit: number
	overlayUndoHistoryLimit: number
	openExplorerOnAppStart: boolean
	openExplorerOnProjectOpen: boolean
	closeExplorerOnFolderClose: boolean
	closeExplorerOnAppExit: boolean
}

export interface ProjectTab {
	id: string
	rootFolder: string | null
	folderSectionExpanded: boolean
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
}

export type ProjectSection = "folder" | "context" | "apply"

export interface AppNotice {
	kind: "info" | "success" | "warning" | "error"
	message: string
}
