import { useWorkspaceActions } from "./workspace/actions"
import { createContextWorkspace } from "./workspace/createContextWorkspace"
import type { UseContextWorkspaceOptions } from "./workspace/types"
import { useCancellableOperations } from "./workspace/useCancellableOperations"
import { useWorkspaceInitialization } from "./workspace/useWorkspaceInitialization"
import { useWorkspaceState } from "./workspace/useWorkspaceState"

export type {
	ContextWorkspacePreferences,
	PreparedApplyOutcome,
	UseContextWorkspaceOptions,
	WorkspaceConfirmationRequest,
} from "./workspace/types"

export function useContextWorkspace(options: UseContextWorkspaceOptions) {
	const state = useWorkspaceState(
		options.initialRootFolder,
		options.preferences,
	)
	const cancellation = useCancellableOperations(state)
	const actions = useWorkspaceActions(
		state,
		options,
		cancellation,
	)

	useWorkspaceInitialization(
		state,
		options,
		actions,
	)

	return createContextWorkspace(
		state,
		actions,
	)
}

export type ContextWorkspace = ReturnType<typeof useContextWorkspace>
