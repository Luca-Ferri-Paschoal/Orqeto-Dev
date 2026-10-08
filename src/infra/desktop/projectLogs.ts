import type {
	ProjectLogClearResult,
	ProjectLogSnapshot,
} from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export async function approveProjectLogCommand(rootFolder: string, expectedCommand: string): Promise<void> {
	await invoke(
		"approve_project_log_command",
		{ rootFolder, expectedCommand },
	)
}

export const startProjectLogSession = (rootFolder: string) => invoke<ProjectLogSnapshot>(
	"start_project_log_session",
	{ rootFolder },
)

export const stopProjectLogSession = (rootFolder: string) => invoke<boolean>(
	"stop_project_log_session",
	{ rootFolder },
)

export const getProjectLogSnapshot = (rootFolder: string, afterSequence: number) => invoke<ProjectLogSnapshot>(
	"get_project_log_snapshot",
	{ rootFolder, afterSequence },
)

export const clearProjectLogSession = (rootFolder: string, throughSequence: number | null = null) => invoke<ProjectLogClearResult>(
	"clear_project_log_session",
	{ rootFolder, throughSequence },
)
