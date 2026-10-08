import type { OperationUndoReference } from "../operationOutcome"
import type {
	AppSettings,
	OverlayDestinationCandidate,
	ProjectDiagnosticKind,
	ProjectValidationCommandKind,
	WorkMode,
} from "../types"
import type { Locale } from "@/infra/i18n"

export interface OverlayQueueItem {
	paths: string[]
	sourceLabel: string
	sourceFingerprint: string
	routingFingerprint: string
	fileCount: number
	deleteCount: number
	permanentDeletePaths: string[]
	candidates: OverlayDestinationCandidate[]
}

export interface OverlayBatchStats {
	operationId: string
	createdFiles: number
	editedFiles: number
	deletedFiles: number
	unchangedFiles: number
	createdDirectories: number
	editedDirectories: number
	deletedDirectories: number
	unchangedDirectories: number
	protectedSecretFiles: number
	detectedSecrets: number
	permanentDeletedFiles: number
	permanentDeletedDirectories: number
	permanentDeletionError: string | null
	rejectedFiles: number
	skippedFiles: number
	firstFailure: string | null
}

export interface ContextSelectionActionStats {
	addedFiles: number
	addedDirectories: number
	unchangedFiles: number
	unchangedDirectories: number
	skippedFiles: number
	skippedDirectories: number
}

export interface ContextRemovalActionStats {
	removedFiles: number
	removedDirectories: number
	notPresentFiles: number
	notPresentDirectories: number
	filteredFiles: number
	filteredDirectories: number
}

export interface MaterializedContextResult {
	content: string
	fileCount: number
	directoryCount: number
	skippedFiles: number
	skippedDirectories: number
}

export interface PreparedGitCommitContext {
	rootFolder: string
	locale: Locale
	workMode: WorkMode
	repositoryName: string
	content: string
	byteCount: number
	variant: "current" | "compare"
	fromCommit: string | null
	toCommit: string | null
	comparisonStats: { fileCount: number; addedLines: number; deletedLines: number } | null
}

export interface PreparedDiagnosticContext {
	rootFolder: string
	locale: Locale
	workMode: WorkMode
	diagnosticFileLimit: number
	kind: ProjectDiagnosticKind
	content: string
	byteCount: number
}

export interface PreparedValidationCommandContext {
	rootFolder: string
	locale: Locale
	kind: ProjectValidationCommandKind
	content: string
	byteCount: number
}

export type CancellableContextOperationKind = | "create" |
	"custom" |
	"commit" |
	"project" |
	"typecheck" |
	"lintfix" |
	"eslint" |
	"test"

export interface CancellableContextOperationToken {
	id: number
	backendOperationId: string
	kind: CancellableContextOperationKind
	cancelled: boolean
	cancellable: boolean
}

export type ContextWorkspacePreferences = Omit<
	AppSettings,
	| "folderAction" |
	"folderSectionExpanded" |
	"contextSectionExpanded" |
	"applySectionExpanded" |
	"settingsGeneralExpanded" |
	"settingsContextExpanded" |
	"settingsHistoryExpanded" |
	"settingsVscodeExpanded" |
	"settingsExplorerExpanded"
>

export type PreparedApplyOutcome = | {
	status: "success"
	undoReference: OperationUndoReference | null
} | {
	status: "no_op" | "cancelled" | "failed" | "blocked"
	undoReference: null
}

export interface WorkspaceConfirmationRequest {
	title: string
	message: string
	confirmLabel: string
	cancelLabel: string
}

export interface UseContextWorkspaceOptions {
	active: boolean
	initialRootFolder: string | null
	folderPickerReferenceRoot: string | null
	preferences: ContextWorkspacePreferences
	onRootFolderChange: (rootFolder: string | null) => Promise<boolean>
	requestConfirmation: (request: WorkspaceConfirmationRequest) => Promise<boolean>
}
