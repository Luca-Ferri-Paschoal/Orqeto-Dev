import type { ProjectLogEntry } from "@/features/context/types"

export interface ProjectLogsViewState {
	rootFolder: string
	entries: ProjectLogEntry[]
	sessionCommand: string | null
	running: boolean
	exitCode: number | null
	truncated: boolean
}

export const trustedProjectLogCommands = new Set<string>()

export function emptyProjectLogsViewState(rootFolder: string): ProjectLogsViewState {
	return {
		rootFolder,
		entries: [],
		sessionCommand: null,
		running: false,
		exitCode: null,
		truncated: false,
	}
}

export function projectLogTrustKey(rootFolder: string, command: string): string {
	return `${rootFolder}\u0000${command}`
}
