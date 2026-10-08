import type { WorkMode } from "./appSettings.ts"

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
export type ProjectValidationCommandKind = "lintfix" | "test"

export interface ProjectDiagnosticCapabilities {
	typecheck: boolean
	eslint: boolean
	lintFixCommand: string | null
	testCommand: string | null
	developmentLogCommand: string | null
}

export type ProjectLogStream = "stdout" | "stderr" | "system"

export interface ProjectLogEntry {
	sequence: number
	timestampMs: number
	stream: ProjectLogStream
	message: string
}

export interface ProjectLogSnapshot {
	sessionId: string | null
	command: string | null
	running: boolean
	startedAtMs: number | null
	exitCode: number | null
	entries: ProjectLogEntry[]
	truncated: boolean
	latestSequence: number
}

export interface ProjectLogClearResult {
	cursor: number
}

export interface ProjectLintFixResult {
	changedFileCount: number
	remainingIssueCount: number
	remainingErrorCount: number
	remainingWarningCount: number
	remainingFilesWithIssues: number
}

export interface ProjectValidationCommandResult {
	kind: ProjectValidationCommandKind
	command: string
	exitCode: number | null
	success: boolean
	durationMs: number
	stdout: string
	stderr: string
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

export type { GitCommitComparisonData, GitCommitHistoryPage, GitCommitSummary } from "./gitCommitComparison.ts"

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

export type ContextHistoryKind = "custom" | "project" | "commit" | "typecheck" | "lintfix" | "eslint" | "test"

export interface ContextHistoryEntry {
	id: number
	kind: ContextHistoryKind
	fileCount: number
	byteCount: number
	createdAt: number
}

export interface ContextHistorySnapshot {
	kind: ContextHistoryKind
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
	permanentDeletePaths: string[]
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

export type { SecretReviewFile, SecretReviewResult } from "./secretReviewContracts.ts"

export interface ApplyProjectOverlayResult {
	permanentDeletedFiles?: number
	permanentDeletedDirectories?: number
	permanentDeletedBytes?: number
	permanentDeletionError?: string
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
	protectedSecretFiles: number
	detectedSecrets: number
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

export interface AppliedSourceHistoryMatch {
	kind: "none" | "latest" | "older"
	applicationsAgo: number | null
	sourceLabel: string | null
	currentlyApplied: boolean
}

export type ExternalAction = | {
	type: "openRoot"
	path: string
} | {
	type: "addContext"
	paths: string[]
} | {
	type: "removeContext"
	paths: string[]
} | {
	type: "addContextAndCopy"
	paths: string[]
} | {
	type: "addIgnore"
	paths: string[]
} | {
	type: "removeIgnore"
	paths: string[]
}

export interface QueuedExternalAction {
	id: number
	action: ExternalAction
}
