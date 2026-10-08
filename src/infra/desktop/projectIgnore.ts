import type { ProjectIgnoreUpdateResult } from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export const projectIgnoreExists = (rootFolder: string) => invoke<boolean>(
	"project_ignore_exists",
	{ rootFolder },
)
export const createProjectIgnore = (rootFolder: string) => invoke<boolean>(
	"create_project_ignore",
	{ rootFolder },
)
export const updateProjectIgnore = (
	rootFolder: string,
	paths: string[],
	ignorePaths: boolean,
) => invoke<ProjectIgnoreUpdateResult>(
	"update_project_ignore",
	{ rootFolder, paths, ignorePaths },
)
