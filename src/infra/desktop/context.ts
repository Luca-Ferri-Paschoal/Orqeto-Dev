import type {
	ContextRemovalPath,
	MaterializeContextResult,
	ProcessDropResult,
} from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export async function cleanupNativeDrop(path: string): Promise<void> {
	await invoke(
		"cleanup_native_drop",
		{ path },
	)
}
export const processDrop = (
	rootFolder: string,
	paths: string[],
) => invoke<ProcessDropResult>(
	"process_drop",
	{ rootFolder, paths },
)
export const materializeContextFiles = (
	rootFolder: string,
	relativePaths: string[],
	pathsOnly: boolean,
) => invoke<MaterializeContextResult>(
	"materialize_context_files",
	{ rootFolder, relativePaths, pathsOnly },
)
export const resolveContextRemovalPaths = (
	rootFolder: string,
	paths: string[],
) => invoke<ContextRemovalPath[]>(
	"resolve_context_removal_paths",
	{ rootFolder, paths },
)
