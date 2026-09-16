import type { OperationOutcome } from "./operationOutcome"
import type { Locale } from "@/infra/i18n"

export const HISTORY_LIMIT_MIN = 1
export const HISTORY_LIMIT_MAX = 100
export const DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT = 10
export const DEFAULT_CONTEXT_HISTORY_LIMIT = 5
export const DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT = 10
export const DEFAULT_DIAGNOSTIC_FILE_LIMIT = 20
export const DEFAULT_APP_THEME = "light"
export const DEFAULT_WORK_MODE = "files"
export const DEFAULT_HIDE_OPEN_PROJECT_SUBFOLDERS = true
export const DEFAULT_FOLDER_ACTION = "select"

export type AppTheme = "light" | "dark"
export type WorkMode = "files" | "git"
export type FolderAction = "select" | "explorer" | "vscode" | "close"

export interface ContextSelectionFile {
	relativePath: string
}

export interface DiscoveredContextFile extends ContextSelectionFile {
	sizeBytes: number
}

export interface GeneratedFile {
	relativePath: string
	content: string | null
}

export interface SkippedFile {
	relativePath: string
	reason: string
}

export interface ProcessDropResult {
	files: DiscoveredContextFile[]
	directories: string[]
	skippedFiles: SkippedFile[]
	skippedDirectoryCount: number
	selectedBytes: number
}

export interface MaterializeContextResult {
	files: GeneratedFile[]
	directories: string[]
	skippedFiles: SkippedFile[]
	skippedDirectoryCount: number
}

export interface ContextRemovalPath {
	relativePath: string
	isDirectory: boolean
}

export interface ProjectIgnoreUpdateResult {
	operationId: string
	changedPaths: number
	unchangedPaths: number
	changedFiles: number
	changedDirectories: number
	unchangedFiles: number
	unchangedDirectories: number
}

export type ProjectDiagnosticKind = "typecheck" | "eslint"
export type ContextMode = "project" | "commit" | "typecheck" | "eslint" | "create"

export interface FullProjectContextSummary {
	fileCount: number
	byteCount: number
}

export interface ProjectDiagnosticCapabilities {
	typecheck: boolean
	eslint: boolean
}

export interface ProjectDiagnosticMessage {
	line: number | null
	column: number | null
	code: string
	message: string
	severity: "error" | "warning"
}

export interface ProjectDiagnosticFile {
	relativePath: string
	content: string | null
	messages: ProjectDiagnosticMessage[]
}

export interface ProjectDiagnosticContextData {
	kind: ProjectDiagnosticKind
	severity: "error" | "warning"
	issueCount: number
	errorCount: number
	warningCount: number
	totalFilesWithIssues: number
	selectedFileCount: number
	files: ProjectDiagnosticFile[]
	globalMessages: ProjectDiagnosticMessage[]
}

export interface GitCommitUntrackedFile {
	relativePath: string
	content: string | null
	sizeBytes: number
}

export interface GitCommitContextData {
	repositoryName: string
	branch: string
	status: string
	stagedDiff: string
	unstagedDiff: string
	untrackedFiles: GitCommitUntrackedFile[]
}

export type GitPatchChangeKind = "create" | "modify" | "delete" | "rename"

export interface GitPatchChange {
	relativePath: string
	previousPath: string | null
	kind: GitPatchChangeKind
	addedLines: number
	deletedLines: number
}

export interface GitPatchPreview {
	patchName: string
	patchFingerprint: string
	fileCount: number
	addedLines: number
	deletedLines: number
	changes: GitPatchChange[]
}

export interface PendingGitPatch extends GitPatchPreview {
	patchPath: string
}

export interface ApplyGitPatchResult {
	operationId: string
	appliedAtUnixMs: number
	addedFiles: number
	replacedFiles: number
	deletedFiles: number
	addedDirectories: number
	replacedDirectories: number
	deletedDirectories: number
	addedLines: number
	deletedLines: number
}

export interface ContextHistoryEntry {
	id: number
	fileCount: number
	byteCount: number
	createdAt: number
}

export interface ContextHistorySnapshot {
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
	rootCandidate: OverlayDestinationCandidate | null
	recommendedCandidateIndex: number | null
	candidateCount: number
	ambiguityLimit: number
	ambiguityLimitExceeded: boolean
	sourceFingerprint: string
	routingFingerprint: string
}

export interface ApplyProjectOverlayResult {
	operationId: string
	appliedAtUnixMs: number | null
	addedFiles: number
	replacedFiles: number
	deletedFiles: number
	unchangedFiles: number
	addedDirectories: number
	replacedDirectories: number
	deletedDirectories: number
	unchangedDirectories: number
}

export interface UndoProjectOverlayResult {
	operationId: string
	restoredFiles: number
	removedFiles: number
	undoneBatches: number
	remainingHistoryEntries: number
}

export interface OverlayUndoHistoryEntry {
	operationId: string
	steps: number
	addedFiles: number
	replacedFiles: number
	deletedFiles: number
	appliedAtUnixMs: number
	sourceKind: WorkMode
	sourceLabel: string | null
	addedLines: number | null
	deletedLines: number | null
}

export interface PendingProjectOverlay {
	paths: string[]
	sourceLabel: string
	sourceFingerprint: string
	routingFingerprint: string
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
} |
{
	type: "addContextAndCopy"
	paths: string[]
} |
{
	type: "addIgnore"
	paths: string[]
} |
{
	type: "removeIgnore"
	paths: string[]
}

export interface QueuedExternalAction {
	id: number
	action: ExternalAction
}

export interface AppSettings {
	locale: Locale
	theme: AppTheme
	workMode: WorkMode
	autoCopyContextAfterAdd: boolean
	autoClearAfterExport: boolean
	contextFilterHistoryLimit: number
	contextHistoryLimit: number
	overlayUndoHistoryLimit: number
	diagnosticFileLimit: number
	openExplorerOnAppStart: boolean
	openExplorerOnProjectOpen: boolean
	closeExplorerOnFolderClose: boolean
	closeExplorerOnAppExit: boolean
	hideOpenProjectSubfolders: boolean
	folderAction: FolderAction
	folderSectionExpanded: boolean
	contextSectionExpanded: boolean
	applySectionExpanded: boolean
	settingsGeneralExpanded: boolean
	settingsContextExpanded: boolean
	settingsHistoryExpanded: boolean
	settingsVscodeExpanded: boolean
	settingsExplorerExpanded: boolean
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
	details?: string[]
	outcome?: OperationOutcome
}
