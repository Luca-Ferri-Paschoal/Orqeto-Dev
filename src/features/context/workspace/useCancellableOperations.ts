import { createClientOperationId } from "../operationOutcome"
import type {
	CancellableContextOperationKind,
	CancellableContextOperationToken,
} from "./types"
import type { WorkspaceState } from "./useWorkspaceState"
import { cancelProjectValidationOperation } from "@/infra/desktop"
import { useCallback } from "react"

export function useCancellableOperations(state: WorkspaceState) {
	const {
		cancellableContextOperationRef,
		cancellableContextOperationSequenceRef,
		fullProjectSummaryRequestVersionRef,
		isFixingLintRef,
		isGeneratingCommitContextRef,
		isInspectingProjectContextRef,
		isOperationRunningRef,
		rootFolderRef,
		setCancellableContextOperationKind,
		setCancelledContextOperationKind,
		setDiagnosticContextKind,
		setFullProjectContextScanState,
		setIsCancellableContextOperationCancelled,
		setIsFixingLint,
		setIsGeneratingCommitContext,
		setIsGeneratingProjectContext,
		setIsInspectingProjectContext,
		setIsProcessing,
		setOperationRevision,
		setPreparedDiagnosticContexts,
		setPreparedGitCommitContext,
		setPreparedValidationCommandContexts,
		setValidationCommandKind,
	} = state

	const begin = useCallback((
		kind: CancellableContextOperationKind,
		cancellable = true,
	): CancellableContextOperationToken | null => {
		if (cancellableContextOperationRef.current !== null)
			return null

		const token: CancellableContextOperationToken = {
			id: cancellableContextOperationSequenceRef.current + 1,
			backendOperationId: createClientOperationId("validation_operation"),
			kind,
			cancelled: false,
			cancellable,
		}
		cancellableContextOperationSequenceRef.current = token.id
		cancellableContextOperationRef.current = token
		setCancelledContextOperationKind(null)
		setIsCancellableContextOperationCancelled(false)
		setCancellableContextOperationKind(cancellable ?
			kind :
			null)
		return token
	}, [
		cancellableContextOperationRef,
		cancellableContextOperationSequenceRef,
		setCancellableContextOperationKind,
		setCancelledContextOperationKind,
		setIsCancellableContextOperationCancelled,
	])

	const isActive = useCallback(
		(token: CancellableContextOperationToken): boolean =>
			cancellableContextOperationRef.current === token && !token.cancelled,
		[cancellableContextOperationRef],
	)

	const commit = useCallback((token: CancellableContextOperationToken): boolean => {
		if (!isActive(token))
			return false

		token.cancellable = false
		setCancellableContextOperationKind(null)
		return true
	}, [isActive, setCancellableContextOperationKind])

	const finish = useCallback((token: CancellableContextOperationToken): boolean => {
		if (cancellableContextOperationRef.current !== token)
			return false

		cancellableContextOperationRef.current = null
		setCancellableContextOperationKind(null)
		setCancelledContextOperationKind(null)
		setIsCancellableContextOperationCancelled(false)
		return true
	}, [
		cancellableContextOperationRef,
		setCancellableContextOperationKind,
		setCancelledContextOperationKind,
		setIsCancellableContextOperationCancelled,
	])

	const cancel = useCallback((): void => {
		const token = cancellableContextOperationRef.current
		if (token === null || token.cancelled || !token.cancellable)
			return

		token.cancellable = false
		token.cancelled = true
		cancellableContextOperationRef.current = null
		setCancellableContextOperationKind(null)
		setCancelledContextOperationKind(token.kind)
		setIsCancellableContextOperationCancelled(true)

		if (token.kind === "create" || token.kind === "custom") {
			isOperationRunningRef.current = false
			setOperationRevision(revision => revision + 1)
			setIsProcessing(false)
		}
		if (token.kind === "commit") {
			isGeneratingCommitContextRef.current = false
			setIsGeneratingCommitContext(false)
		}
		if (token.kind === "project") {
			isGeneratingCommitContextRef.current = false
			isInspectingProjectContextRef.current = false
			setIsGeneratingProjectContext(false)
			setIsInspectingProjectContext(false)
		}
		if (token.kind === "typecheck" || token.kind === "eslint") {
			isGeneratingCommitContextRef.current = false
			setDiagnosticContextKind(current => current === token.kind ?
				null :
				current)
		}
		if (token.kind !== "lintfix" && token.kind !== "test")
			return

		const configuredRootFolder = rootFolderRef.current
		if (configuredRootFolder !== null) {
			void cancelProjectValidationOperation(
				configuredRootFolder,
				token.kind,
				token.backendOperationId,
			).catch(() => undefined)
		}
		isGeneratingCommitContextRef.current = false
		setValidationCommandKind(current => current === token.kind ?
			null :
			current)
		setPreparedValidationCommandContexts(current => ({ ...current, [token.kind]: null }))
		if (token.kind === "lintfix") {
			isFixingLintRef.current = false
			setIsFixingLint(false)
			setPreparedGitCommitContext(null)
			setPreparedDiagnosticContexts({ typecheck: null, eslint: null })
			fullProjectSummaryRequestVersionRef.current += 1
			setFullProjectContextScanState({ rootFolder: configuredRootFolder, value: null })
		}
		setOperationRevision(revision => revision + 1)
	}, [
		cancellableContextOperationRef,
		fullProjectSummaryRequestVersionRef,
		isFixingLintRef,
		isGeneratingCommitContextRef,
		isInspectingProjectContextRef,
		isOperationRunningRef,
		rootFolderRef,
		setCancellableContextOperationKind,
		setCancelledContextOperationKind,
		setDiagnosticContextKind,
		setFullProjectContextScanState,
		setIsCancellableContextOperationCancelled,
		setIsFixingLint,
		setIsGeneratingCommitContext,
		setIsGeneratingProjectContext,
		setIsInspectingProjectContext,
		setIsProcessing,
		setOperationRevision,
		setPreparedDiagnosticContexts,
		setPreparedGitCommitContext,
		setPreparedValidationCommandContexts,
		setValidationCommandKind,
	])

	return {
		beginCancellableContextOperation: begin,
		cancelCancellableContextOperation: cancel,
		commitCancellableContextOperation: commit,
		finishCancellableContextOperation: finish,
		isCancellableContextOperationActive: isActive,
	}
}
