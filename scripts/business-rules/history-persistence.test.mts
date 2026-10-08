import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

// BR-HISTORY-006
void test(
	"BR-HISTORY-006 every Context generator contributes to one persisted typed history",
	async () => {
		const [
			types,
			gitActions,
			diagnosticGenerate,
			historyActions,
			fullProjectExport,
			generatedExport,
			pane,
			actions,
			summary,
			configDatabase,
			rustDatabase,
			lib,
		] = await Promise.all([
			readProjectFile("src/domain/contextContracts.ts"),
			readProjectFile("src/features/context/workspace/actions/useGitContextActions.ts"),
			readProjectFile("src/features/context/workspace/actions/useDiagnosticGenerateActions.ts"),
			readProjectFile("src/features/context/workspace/actions/useWorkspaceHistoryActions.ts"),
			readProjectFile("src/features/context/workspace/actions/useFullProjectExportActions.ts"),
			readProjectFile("src/features/context/workspace/actions/useGeneratedExportActions.ts"),
			readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			readProjectFile("src/features/context/components/ContextExportActions/index.tsx"),
			readProjectFile("src/features/context/components/ContentSummary/index.tsx"),
			readProjectFile("src/infra/configDatabase.ts"),
			readProjectFile("src-tauri/src/config_database.rs"),
			readProjectFile("src-tauri/src/lib.rs"),
		])

		assert.match(
			types,
			/type ContextHistoryKind = "custom" \| "project" \| "commit" \| "typecheck" \| "lintfix" \| "eslint" \| "test"/,
		)
		assert.match(
			configDatabase,
			/kind: entry\.kind/,
		)
		assert.match(
			rustDatabase,
			/SELECT id, kind, file_count, byte_count, created_at FROM context_export_history/,
		)
		assert.match(
			lib,
			/ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom'/,
		)

		assert.match(
			gitActions,
			/archiveContextSnapshot\([\s\S]*?content,[\s\S]*?0,[\s\S]*?"commit"/,
		)
		assert.match(
			diagnosticGenerate,
			/archiveContextSnapshot\([\s\S]*?result\.content,[\s\S]*?result\.data\.selectedFileCount,[\s\S]*?kind/,
		)
		assert.match(
			historyActions,
			/const publishValidationCommandContext = useCallback\([\s\S]*archiveContextSnapshot\([\s\S]*content,[\s\S]*0,[\s\S]*kind/,
		)
		assert.match(
			fullProjectExport,
			/archiveContextSnapshot\([\s\S]*?loaded\.content,[\s\S]*?loaded\.fileCount,[\s\S]*?"project"/,
		)
		assert.match(
			fullProjectExport,
			/contextHistoryLimit/,
		)
		assert.match(
			lib,
			/save_context_history_record\([\s\S]*?"project"/,
		)
		assert.match(
			generatedExport,
			/archiveContextSnapshot\([\s\S]*?materialized\.content,[\s\S]*?materialized\.fileCount,[\s\S]*?"custom"/,
		)

		assert.equal(
			pane.match(/<ContextHistoryPanel/g)?.length ?? 0,
			1,
		)
		assert.match(
			pane,
			/headerAccessory=\{workspace\.rootFolder === null[\s\S]*?<ContextHistoryPanel[\s\S]*?history=\{workspace\.contextHistory\}/,
		)
		assert.doesNotMatch(
			actions,
			/ContextHistoryPanel/,
		)
		assert.doesNotMatch(
			summary,
			/ContextHistoryPanel/,
		)
	},
)

// BR-HISTORY-007
void test(
	"BR-HISTORY-007 application history and Undo survive restart and project-tab reopen",
	async () => {
		const [
			overlay,
			storage,
			lib,
			app,
			workspace,
		] = await Promise.all([
			readProjectFile("src-tauri/src/overlay.rs"),
			readProjectFile("src-tauri/src/storage.rs"),
			readProjectFile("src-tauri/src/lib.rs"),
			readProjectFile("src/App/index.tsx"),
			readProjectFile("src/features/context/useContextWorkspace.ts"),
		])

		assert.match(
			overlay,
			/UNDO_HISTORY_FILE_NAME: &str = "\.orqeto-undo-history\.json"/,
		)
		assert.match(
			overlay,
			/fn persist_undo_snapshot\(/,
		)
		const applicationCommitStart = overlay.indexOf("fn commit_application_snapshot")
		const applicationCommitEnd = overlay.indexOf(
			"fn recovery_current_state",
			applicationCommitStart,
		)
		const applicationCommit = overlay.slice(
			applicationCommitStart,
			applicationCommitEnd,
		)
		assert.ok(applicationCommitStart >= 0)
		assert.ok(applicationCommitEnd > applicationCommitStart)
		assert.ok(applicationCommit.indexOf("persist_undo_snapshot(snapshot)?") <
			applicationCommit.indexOf("write_recovery_journal_state(snapshot, true)?"))
		assert.match(
			overlay,
			/pub\(crate\) fn load_persisted_histories\(&self\)/,
		)
		assert.doesNotMatch(
			overlay,
			/impl Drop for OverlayUndoState/,
		)
		assert.match(
			storage,
			/snapshot_directories_by_class/,
		)
		assert.match(
			overlay,
			/StorageClass::ActiveUndo[\s\S]*?has_persisted_undo_history_file/,
		)
		assert.match(
			lib,
			/state::<overlay::OverlayUndoState>\(\)[\s\S]*?load_persisted_histories\(\)/,
		)
		assert.doesNotMatch(
			app,
			/discardProjectOverlayUndo/,
		)
		assert.doesNotMatch(
			workspace,
			/discardProjectOverlayUndo/,
		)
		assert.match(
			workspace,
			/await refreshOverlayUndoHistory\(\)/,
		)
	},
)

// BR-HISTORY-008
void test(
	"BR-HISTORY-008 Context history stays beside Create context and Custom actions stay in one row",
	async () => {
		const [
			pane,
			folderSettings,
			folderStyle,
			applyStyle,
			historyPanel,
			historyStyle,
			summary,
			summaryStyle,
		] = await Promise.all([
			readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx"),
			readProjectFile("src/features/context/components/FolderSettings/index.tsx"),
			readProjectFile("src/features/context/components/FolderSettings/style.ts"),
			readProjectFile("src/features/context/components/ApplyDropZone/style.ts"),
			readProjectFile("src/features/context/components/ContextHistoryPanel/index.tsx"),
			readProjectFile("src/features/context/components/ContextHistoryPanel/style.ts"),
			readProjectFile("src/features/context/components/ContentSummary/index.tsx"),
			readProjectFile("src/features/context/components/ContentSummary/style.ts"),
		])

		assert.match(
			folderSettings,
			/headerAccessory\?: ReactNode/,
		)
		assert.match(
			folderSettings,
			/<h2 className=\{styles\.title\}>[\s\S]*?\{sectionName\}[\s\S]*?\{headerAccessory\}/,
		)
		assert.match(
			pane,
			/<ContextHistoryPanel[\s\S]*?placement="header"/,
		)
		assert.match(
			historyPanel,
			/type ContextHistoryPlacement = "section" \| "header"/,
		)
		assert.match(
			historyPanel,
			/const isExpanded = expanded && history\.length > 0/,
		)
		assert.doesNotMatch(
			historyPanel,
			/if \(history\.length === 0\)\s*setExpanded\(false\)/,
		)
		assert.match(
			historyStyle,
			/placement === "header"[\s\S]*?"absolute"[\s\S]*?"left-0"[\s\S]*?"right-0"/,
		)
		assert.match(
			folderStyle,
			/titleGroup:[\s\S]*?"gap-3"[\s\S]*?title:[\s\S]*?"text-\[14px\]"/,
		)
		assert.match(
			applyStyle,
			/sectionTitle:[\s\S]*?"text-\[14px\]"/,
		)
		assert.match(
			historyStyle,
			/placement === "header"[\s\S]*?"min-h-7"[\s\S]*?"text-\[9px\]"/,
		)
		assert.doesNotMatch(
			summary,
			/ContextHistoryPanel|onHistoryCopy|onHistoryDownload|onHistoryDelete/,
		)
		assert.match(
			summaryStyle,
			/actions:[\s\S]*?"flex-nowrap"/,
		)
		assert.doesNotMatch(
			summaryStyle,
			/grid-cols|copyButton|downloadButton|clearButton/,
		)
	},
)
