import type { UseContextWorkspaceOptions } from "../types"
import type { useCancellableOperations } from "../useCancellableOperations"
import type { WorkspaceState } from "../useWorkspaceState"
import { useApplyDropActions } from "./useApplyDropActions"
import { useContextAddActions } from "./useContextAddActions"
import { useContextHistoryActions } from "./useContextHistoryActions"
import { useContextRemoveActions } from "./useContextRemoveActions"
import { useDiagnosticExportActions } from "./useDiagnosticExportActions"
import { useDiagnosticGenerateActions } from "./useDiagnosticGenerateActions"
import { useFullProjectExportActions } from "./useFullProjectExportActions"
import { useFullProjectScanActions } from "./useFullProjectScanActions"
import { useGeneratedExportActions } from "./useGeneratedExportActions"
import { useGitCommitComparisonActions } from "./useGitCommitComparisonActions"
import { useGitContextActions } from "./useGitContextActions"
import { useLintFixActions } from "./useLintFixActions"
import { useOverlayBatchActions } from "./useOverlayBatchActions"
import { useOverlayUndoActions } from "./useOverlayUndoActions"
import { usePendingGitActions } from "./usePendingGitActions"
import { usePendingOverlayActions } from "./usePendingOverlayActions"
import { usePreparedApplyActions } from "./usePreparedApplyActions"
import { useTabCloseActions } from "./useTabCloseActions"
import { useTestActions } from "./useTestActions"
import { useValidationTrustActions } from "./useValidationTrustActions"
import { useWorkspaceCoreStateActions } from "./useWorkspaceCoreStateActions"
import { useWorkspaceHistoryActions } from "./useWorkspaceHistoryActions"
import { useWorkspaceMaterializationActions } from "./useWorkspaceMaterializationActions"
import { useWorkspaceRootActions } from "./useWorkspaceRootActions"
import { useWorkspaceRootFilterActions } from "./useWorkspaceRootFilterActions"

export function useWorkspaceActions(
	state: WorkspaceState,
	options: UseContextWorkspaceOptions,
	cancellation: ReturnType<typeof useCancellableOperations>,
) {
	const core = {
		...cancellation,
		...useWorkspaceCoreStateActions(
			state,
			options,
		),
	}
	const history = { ...core, ...useWorkspaceHistoryActions(state) }
	const materialization = {
		...history,
		...useWorkspaceMaterializationActions(
			state,
			options,
			history,
		),
	}
	const root = {
		...materialization,
		...useWorkspaceRootActions(
			state,
			options,
			materialization,
		),
	}
	const rootFilter = {
		...root,
		...useWorkspaceRootFilterActions(
			state,
			options,
			root,
		),
	}
	const contextAdd = {
		...rootFilter,
		...useContextAddActions(
			state,
			rootFilter,
		),
	}
	const contextRemove = {
		...contextAdd,
		...useContextRemoveActions(
			state,
			contextAdd,
		),
	}
	const overlayBatch = {
		...contextRemove,
		...useOverlayBatchActions(
			state,
			options,
			contextRemove,
		),
	}
	const applyDrop = {
		...overlayBatch,
		...useApplyDropActions(
			state,
			overlayBatch,
		),
	}
	const preparedApply = {
		...applyDrop,
		...usePreparedApplyActions(
			state,
			applyDrop,
		),
	}
	const pendingGit = {
		...preparedApply,
		...usePendingGitActions(
			state,
			preparedApply,
		),
	}
	const pendingOverlay = {
		...pendingGit,
		...usePendingOverlayActions(
			state,
			pendingGit,
		),
	}
	const overlayUndo = {
		...pendingOverlay,
		...useOverlayUndoActions(
			state,
			pendingOverlay,
		),
	}
	const gitContext = {
		...overlayUndo,
		...useGitContextActions(
			state,
			overlayUndo,
		),
	}
	const gitComparison = {
		...gitContext,
		...useGitCommitComparisonActions(
			state,
			gitContext,
		),
	}
	const fullProjectScan = {
		...gitComparison,
		...useFullProjectScanActions(
			state,
			gitComparison,
		),
	}
	const fullProjectExport = {
		...fullProjectScan,
		...useFullProjectExportActions(
			state,
			fullProjectScan,
		),
	}
	const validationTrust = {
		...fullProjectExport,
		...useValidationTrustActions(
			state,
			options,
		),
	}
	const lintFix = {
		...validationTrust,
		...useLintFixActions(
			state,
			validationTrust,
		),
	}
	const tests = {
		...lintFix,
		...useTestActions(
			state,
			lintFix,
		),
	}
	const diagnosticGenerate = {
		...tests,
		...useDiagnosticGenerateActions(
			state,
			tests,
		),
	}
	const diagnosticExport = { ...diagnosticGenerate, ...useDiagnosticExportActions(state) }
	const generatedExport = {
		...diagnosticExport,
		...useGeneratedExportActions(
			state,
			diagnosticExport,
		),
	}
	const contextHistory = { ...generatedExport, ...useContextHistoryActions(state) }
	return {
		...contextHistory,
		...useTabCloseActions(
			state,
			contextHistory,
		),
	}
}
