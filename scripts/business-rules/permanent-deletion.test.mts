import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

// BR-FILE-007
void test("BR-FILE-007 permanent generated-folder deletion requires user approval and never creates Undo backups", async () => {
	const [manifest, validation, deletion, preparation, frontend, confirmation, batch, workspaceState, pendingOverlayActions, pendingOverlayTypes, ptProtocol, enProtocol, copiedPrompt, backendProtocol, bootstrap, docs] = await Promise.all([
		readProjectFile("src-tauri/src/overlay/model.rs"),
		readProjectFile("src-tauri/src/overlay/manifest_permanent.rs"),
		readProjectFile("src-tauri/src/overlay/permanent_delete.rs"),
		readProjectFile("src-tauri/src/overlay/prepare.rs"),
		readProjectFile("src/features/context/workspace/actions/applyApprovedFilesOverlay.ts"),
		readProjectFile("src/features/context/workspace/actions/requestPermanentDeletionApproval.ts"),
		readProjectFile("src/features/context/workspace/actions/useOverlayBatchActions.ts"),
		readProjectFile("src/features/context/workspace/useWorkspaceState.ts"),
		readProjectFile("src/features/context/workspace/actions/usePendingOverlayActions.ts"),
		readProjectFile("src/features/context/types.ts"),
		readProjectFile("src/infra/i18n/locales/ptBR/protocol.ts"),
		readProjectFile("src/infra/i18n/locales/en/protocol.ts"),
		readProjectFile("src/features/context/formatAiWorkflowPrompt.ts"),
		readProjectFile("src-tauri/src/lib/context_materialization.rs"),
		readProjectFile("src-tauri/src/lib/app_bootstrap.rs"),
		readProjectFile("docs/docs.md"),
	])
	assert.match(
		manifest,
		/rename = "deletePermanent", default/,
	)
	assert.match(
		validation,
		/"target", "node_modules", "dist", "build"/,
	)
	assert.match(
		validation,
		/ensure_separate_deletion_modes/,
	)
	assert.match(
		deletion,
		/reject_sensitive_permanent_entry/,
	)
	assert.match(
		deletion,
		/metadata_is_link_or_reparse/,
	)
	assert.match(
		deletion,
		/if !confirmed/,
	)
	assert.doesNotMatch(
		deletion,
		/store_stable_backup|write_recovery_journal|record_undo_snapshot|remove_dir_all/,
	)
	assert.match(
		preparation,
		/permanent_delete_paths:/,
	)
	assert.match(
		frontend,
		/confirmPermanentDeletion\(permanentPaths\)/,
	)
	assert.ok(frontend.indexOf("confirmPermanentDeletion(permanentPaths)") < frontend.indexOf("await applyProjectOverlay("))
	assert.ok(frontend.indexOf("await applyProjectOverlay(") < frontend.indexOf("await deleteProjectGeneratedDirectoriesPermanently("))
	assert.match(
		confirmation,
		/workspace.permanentDeletionConfirmMessage/,
	)
	assert.match(
		batch,
		/requestPermanentDeletionApproval/,
	)
	assert.match(
		workspaceState,
		/permanentDeletedFiles:\s*0,[\s\S]{0,160}permanentDeletedDirectories:\s*0,[\s\S]{0,160}permanentDeletionError:\s*null/,
	)
	assert.match(
		frontend,
		/plan: Pick<PrepareProjectOverlayResult,/,
	)
	assert.match(
		pendingOverlayActions,
		/plan: currentPendingOverlay/,
	)
	assert.match(
		pendingOverlayTypes,
		/interface PendingProjectOverlay[\s\S]*permanentDeletePaths: string\[\]/,
	)
	for (const protocol of [ptProtocol, enProtocol, copiedPrompt, backendProtocol, docs]) {
		assert.match(
			protocol,
			/deletePermanent/,
		)
		assert.match(
			protocol,
			/Undo|Desfazer/,
		)
	}
	assert.match(
		bootstrap,
		/overlay::delete_project_generated_directories_permanently/,
	)
})
