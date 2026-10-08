import { invoke } from "@tauri-apps/api/core"

export const findProjectForRoot = (
	rootFolders: string[],
	path: string,
) => invoke<number | null>(
	"find_project_for_root",
	{ rootFolders, path },
)
export const findProjectForPaths = (
	rootFolders: string[],
	paths: string[],
) => invoke<number | null>(
	"find_project_for_paths",
	{ rootFolders, paths },
)
