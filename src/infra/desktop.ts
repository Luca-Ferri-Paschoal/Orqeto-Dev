import type {
	ApplyGitPatchResult,
	ApplyProjectOverlayResult,
	ContextRemovalPath,
	GitCommitContextData,
	GitPatchPreview,
	MaterializeContextResult,
	OverlayDestinationCandidate,
	OverlayUndoHistoryEntry,
	PrepareProjectOverlayResult,
	ProcessDropResult,
	ProjectDiagnosticCapabilities,
	ProjectDiagnosticContextData,
	ProjectDiagnosticKind,
	ProjectIgnoreUpdateResult,
	QueuedExternalAction,
	UndoProjectOverlayResult,
} from "@/features/context/types"
import { invoke } from "@tauri-apps/api/core"

export interface OverlayRecoveryStatus {
	blocked: boolean
}

export async function getOverlayRecoveryStatus(): Promise<OverlayRecoveryStatus> {
	return invoke<OverlayRecoveryStatus>("overlay_recovery_status")
}

export async function peekExternalActions(): Promise<QueuedExternalAction[]> {
	return invoke<QueuedExternalAction[]>("peek_external_actions")
}

export async function nextExternalAction(): Promise<QueuedExternalAction | null> {
	return invoke<QueuedExternalAction | null>("next_external_action")
}

export async function ackExternalAction(id: number): Promise<void> {
	await invoke(
		"ack_external_action",
		{ id },
	)
}

export async function projectIgnoreExists(rootFolder: string): Promise<boolean> {
	return invoke<boolean>(
		"project_ignore_exists",
		{ rootFolder },
	)
}

export async function createProjectIgnore(rootFolder: string): Promise<boolean> {
	return invoke<boolean>(
		"create_project_ignore",
		{ rootFolder },
	)
}

export async function updateProjectIgnore(
	rootFolder: string,
	paths: string[],
	ignorePaths: boolean,
): Promise<ProjectIgnoreUpdateResult> {
	return invoke<ProjectIgnoreUpdateResult>(
		"update_project_ignore",
		{
			rootFolder,
			paths,
			ignorePaths,
		},
	)
}

export async function setExternalIntegrationState(
	openProjectRoots: string[],
	contextProjectRoots: string[],
	ignoreProjectRoot: string | null,
	hideOpenProjectSubfolders: boolean,
): Promise<void> {
	await invoke(
		"set_external_integration_state",
		{
			openProjectRoots,
			contextProjectRoots,
			ignoreProjectRoot,
			hideOpenProjectSubfolders,
		},
	)
}

export async function destroyMainWindow(): Promise<void> {
	await invoke("destroy_main_window")
}

export async function folderExists(path: string): Promise<boolean> {
	return invoke<boolean>(
		"folder_exists",
		{
			path,
		},
	)
}

export async function isGitRepository(rootFolder: string): Promise<boolean> {
	return invoke<boolean>(
		"is_git_repository",
		{ rootFolder },
	)
}

export async function generateGitCommitContext(rootFolder: string): Promise<GitCommitContextData> {
	return invoke<GitCommitContextData>(
		"generate_git_commit_context",
		{ rootFolder },
	)
}

export async function getProjectDiagnosticCapabilities(rootFolder: string): Promise<ProjectDiagnosticCapabilities> {
	return invoke<ProjectDiagnosticCapabilities>(
		"get_project_diagnostic_capabilities",
		{ rootFolder },
	)
}

export async function approveProjectDiagnostics(rootFolder: string): Promise<void> {
	await invoke(
		"approve_project_diagnostics",
		{ rootFolder },
	)
}

export async function generateProjectDiagnosticContext(
	rootFolder: string,
	kind: ProjectDiagnosticKind,
	fileLimit: number,
): Promise<ProjectDiagnosticContextData> {
	return invoke<ProjectDiagnosticContextData>(
		"generate_project_diagnostic_context",
		{
			rootFolder,
			kind,
			fileLimit,
		},
	)
}

export async function prepareGitPatch(
	rootFolder: string,
	patchPath: string,
): Promise<GitPatchPreview> {
	return invoke<GitPatchPreview>(
		"prepare_git_patch",
		{
			rootFolder,
			patchPath,
		},
	)
}

export async function applyGitPatch(
	rootFolder: string,
	patchPath: string,
	expectedPatchFingerprint: string,
	undoHistoryLimit: number,
): Promise<ApplyGitPatchResult> {
	return invoke<ApplyGitPatchResult>(
		"apply_git_patch",
		{
			rootFolder,
			patchPath,
			expectedPatchFingerprint,
			undoHistoryLimit,
		},
	)
}

export async function openFolderInExplorer(path: string): Promise<void> {
	await invoke(
		"open_folder_in_explorer",
		{
			path,
		},
	)
}

export async function closeFolderInExplorer(path: string): Promise<void> {
	await invoke(
		"close_folder_in_explorer",
		{
			path,
		},
	)
}

export async function isVscodeAvailable(): Promise<boolean> {
	return invoke<boolean>("is_vscode_available")
}

export async function openFolderInVscode(path: string): Promise<void> {
	await invoke(
		"open_folder_in_vscode",
		{
			path,
		},
	)
}

export async function installVscodeExtension(): Promise<void> {
	await invoke("install_vscode_extension")
}

export async function cleanupNativeDrop(path: string): Promise<void> {
	await invoke(
		"cleanup_native_drop",
		{
			path,
		},
	)
}

export async function processDrop(
	rootFolder: string,
	paths: string[],
): Promise<ProcessDropResult> {
	return invoke<ProcessDropResult>(
		"process_drop",
		{
			rootFolder,
			paths,
		},
	)
}

export async function materializeContextFiles(
	rootFolder: string,
	relativePaths: string[],
	pathsOnly: boolean,
): Promise<MaterializeContextResult> {
	return invoke<MaterializeContextResult>(
		"materialize_context_files",
		{
			rootFolder,
			relativePaths,
			pathsOnly,
		},
	)
}

export async function resolveContextRemovalPaths(
	rootFolder: string,
	paths: string[],
): Promise<ContextRemovalPath[]> {
	return invoke<ContextRemovalPath[]>(
		"resolve_context_removal_paths",
		{
			rootFolder,
			paths,
		},
	)
}

export async function prepareProjectOverlay(
	rootFolder: string,
	paths: string[],
): Promise<PrepareProjectOverlayResult> {
	return invoke<PrepareProjectOverlayResult>(
		"prepare_project_overlay",
		{
			rootFolder,
			paths,
		},
	)
}

export async function applyProjectOverlay(
	rootFolder: string,
	paths: string[],
	candidate: OverlayDestinationCandidate,
	expectedSourceFingerprint: string,
	expectedRoutingFingerprint: string,
	appendUndo: boolean,
	undoHistoryLimit: number,
): Promise<ApplyProjectOverlayResult> {
	return invoke<ApplyProjectOverlayResult>(
		"apply_project_overlay",
		{
			rootFolder,
			paths,
			destinationRelativePath: candidate.destinationRelativePath,
			sourcePrefix: candidate.sourcePrefix,
			expectedSourceFingerprint,
			expectedRoutingFingerprint,
			appendUndo,
			undoHistoryLimit,
		},
	)
}

export async function getProjectOverlayUndoHistory(
	rootFolder: string,
	undoHistoryLimit: number,
): Promise<OverlayUndoHistoryEntry[]> {
	return invoke<OverlayUndoHistoryEntry[]>(
		"project_overlay_undo_history",
		{
			rootFolder,
			undoHistoryLimit,
		},
	)
}

export async function undoProjectOverlay(
	rootFolder: string,
	steps: number,
): Promise<UndoProjectOverlayResult> {
	return invoke<UndoProjectOverlayResult>(
		"undo_project_overlay",
		{
			rootFolder,
			steps,
		},
	)
}

export async function discardProjectOverlayUndo(rootFolder: string): Promise<void> {
	await invoke(
		"discard_project_overlay_undo",
		{ rootFolder },
	)
}

export async function findProjectForRoot(
	rootFolders: string[],
	path: string,
): Promise<number | null> {
	return invoke<number | null>(
		"find_project_for_root",
		{
			rootFolders,
			path,
		},
	)
}

export async function findProjectForPaths(
	rootFolders: string[],
	paths: string[],
): Promise<number | null> {
	return invoke<number | null>(
		"find_project_for_paths",
		{
			rootFolders,
			paths,
		},
	)
}

interface SaveFullProjectContextExportFileOptions {
	rootFolder: string
	relativePaths: string[]
	pathsOnly: boolean
	locale: "pt-BR" | "en"
	workMode: "files" | "git"
	suggestedFileName: string
	dialogTitle: string
	filterName: string
	extension: "txt"
}

export interface FullProjectContextExportResult {
	saved: boolean
	fileCount: number
	skippedFileCount: number
	skippedDirectoryCount: number
}

export async function saveFullProjectContextExportFile({
	rootFolder,
	relativePaths,
	pathsOnly,
	locale,
	workMode,
	suggestedFileName,
	dialogTitle,
	filterName,
	extension,
}: SaveFullProjectContextExportFileOptions): Promise<FullProjectContextExportResult> {
	return invoke<FullProjectContextExportResult>(
		"save_full_project_context_export_file",
		{
			rootFolder,
			relativePaths,
			pathsOnly,
			locale,
			workMode,
			suggestedFileName,
			dialogTitle,
			filterName,
			extension,
		},
	)
}

interface SaveContextHistoryExportFileOptions {
	rootFolder: string
	id: number
	suggestedFileName: string
	dialogTitle: string
	filterName: string
	extension: "txt"
}

export async function saveContextHistoryExportFile({
	rootFolder,
	id,
	suggestedFileName,
	dialogTitle,
	filterName,
	extension,
}: SaveContextHistoryExportFileOptions): Promise<boolean> {
	return invoke<boolean>(
		"save_context_history_export_file",
		{
			rootFolder,
			id,
			suggestedFileName,
			dialogTitle,
			filterName,
			extension,
		},
	)
}

interface SaveExportFileOptions {
	suggestedFileName: string
	dialogTitle: string
	filterName: string
	extension: "txt"
	content: string
}

export async function saveExportFile({
	suggestedFileName,
	dialogTitle,
	filterName,
	extension,
	content,
}: SaveExportFileOptions): Promise<boolean> {
	return invoke<boolean>(
		"save_export_file",
		{
			suggestedFileName,
			dialogTitle,
			filterName,
			extension,
			content,
		},
	)
}
