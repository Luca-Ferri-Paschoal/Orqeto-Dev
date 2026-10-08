import { invoke } from "@tauri-apps/api/core"

export const folderExists = (path: string) => invoke<boolean>(
	"folder_exists",
	{ path },
)
export const isGitRepository = (rootFolder: string) => invoke<boolean>(
	"is_git_repository",
	{ rootFolder },
)
export async function openFolderInExplorer(path: string): Promise<void> {
	await invoke(
		"open_folder_in_explorer",
		{ path },
	)
}
export async function closeFolderInExplorer(path: string): Promise<void> {
	await invoke(
		"close_folder_in_explorer",
		{ path },
	)
}
export const isVscodeAvailable = () => invoke<boolean>("is_vscode_available")
export async function openFolderInVscode(path: string): Promise<void> {
	await invoke(
		"open_folder_in_vscode",
		{ path },
	)
}
export async function installVscodeExtension(): Promise<void> {
	await invoke("install_vscode_extension")
}
