import type { QueuedExternalAction } from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export const peekExternalActions = () => invoke<QueuedExternalAction[]>("peek_external_actions")
export const nextExternalAction = () => invoke<QueuedExternalAction | null>("next_external_action")
export async function ackExternalAction(id: number): Promise<void> {
	await invoke(
		"ack_external_action",
		{ id },
	)
}
export async function setExternalIntegrationState(
	openProjectRoots: string[],
	contextProjectRoots: string[],
	busyProjectRoots: string[],
	ignoreProjectRoot: string | null,
	hideOpenProjectSubfolders: boolean,
	locale: "pt-BR" | "en",
): Promise<void> {
	await invoke("set_external_integration_state", {
		openProjectRoots,
		contextProjectRoots,
		busyProjectRoots,
		ignoreProjectRoot,
		hideOpenProjectSubfolders,
		locale,
	})
}
export async function destroyMainWindow(): Promise<void> {
	await invoke("destroy_main_window")
}
