import type { WorkspaceConfirmationRequest } from "../../../useContextWorkspace"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

export function useWorkspaceConfirmation() {
	const [pendingConfirmation, setPendingConfirmation] = useState<WorkspaceConfirmationRequest | null>(null)
	const resolverRef = useRef<((approved: boolean) => void) | null>(null)

	const requestConfirmation = useCallback(
		(request: WorkspaceConfirmationRequest): Promise<boolean> => new Promise(resolve => {
			resolverRef.current?.(false)
			resolverRef.current = resolve
			setPendingConfirmation(request)
		}),
		[],
	)
	const settleConfirmation = useCallback(
		(approved: boolean): void => {
			const resolve = resolverRef.current
			resolverRef.current = null
			setPendingConfirmation(null)
			resolve?.(approved)
		},
		[],
	)

	useEffect(
		() => () => {
			resolverRef.current?.(false)
			resolverRef.current = null
		},
		[],
	)

	return {
		pendingConfirmation,
		requestConfirmation,
		settleConfirmation,
	}
}
