import type {
	ApplyProjectOverlayResult,
	ContextRemovalPath,
	ExternalAction,
	OverlayDestinationCandidate,
	OverlayUndoHistoryEntry,
	PrepareProjectOverlayResult,
	ProcessDropResult,
	UndoProjectOverlayResult,
} from "@/features/context/types"
import { invoke } from "@tauri-apps/api/core"

export async function peekExternalActions(): Promise<ExternalAction[]> {
	return invoke<ExternalAction[]>("peek_external_actions")
}

export async function takeExternalActions(): Promise<ExternalAction[]> {
	return invoke<ExternalAction[]>("take_external_actions")
}

export async function folderExists(path: string): Promise<boolean> {
	return invoke<boolean>(
		"folder_exists",
		{
			path,
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
	pathsOnly: boolean,
): Promise<ProcessDropResult> {
	return invoke<ProcessDropResult>(
		"process_drop",
		{
			rootFolder,
			paths,
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

export async function writeExportFile(
	path: string,
	content: string,
): Promise<void> {
	await invoke(
		"write_export_file",
		{
			path,
			content,
		},
	)
}
