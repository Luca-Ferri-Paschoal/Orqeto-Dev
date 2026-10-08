import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import { test } from "node:test"

void test("BR-HISTORY-005 applied-source history shows origin and warns before reusing older content", async () => {
	const overlay = await readProjectFile("src-tauri/src/overlay.rs")
	const desktop = await readProjectFile("src/infra/desktop.ts")
	const app = await readProjectFile("src/App/index.tsx")
	const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")
	const dropZone = await readProjectFile("src/features/context/components/ApplyDropZone/index.tsx")
	const ptBR = await readProjectFile("src/infra/i18n/locales/pt-BR.ts")
	const en = await readProjectFile("src/infra/i18n/locales/en.ts")

	assert.match(
		overlay,
		/source_fingerprints: Vec<String>/,
	)
	assert.match(
		overlay,
		/fn application_source_label\(/,
	)
	assert.match(
		overlay,
		/snapshot\.source_fingerprints = vec!\[current_plan\.source_fingerprint\]/,
	)
	assert.match(
		overlay,
		/pub async fn project_overlay_source_history_match\(/,
	)
	assert.match(
		overlay,
		/currently_applied: bool/,
	)
	assert.match(
		overlay,
		/snapshot_matches_current_applied_state/,
	)
	assert.match(
		desktop,
		/project_overlay_source_history_match/,
	)
	assert.match(
		desktop,
		/git_patch_source_fingerprint/,
	)
	assert.match(
		app,
		/history\?\.kind === "latest" && history\.currentlyApplied/,
	)
	assert.match(
		app,
		/workspace\.applyAlreadyApplied/,
	)
	assert.match(
		workspace,
		/getProjectAppliedSourceHistoryMatch/,
	)
	assert.match(
		workspace,
		/workspace\.reapplyWarning\.one/,
	)
	assert.match(
		workspace,
		/workspace\.reapplyWarningConfirm/,
	)
	assert.match(
		dropZone,
		/entry\.sourceLabel \?\? translate/,
	)
	assert.match(
		dropZone,
		/dateStyle: "short"/,
	)
	assert.match(
		ptBR,
		/Este código já foi aplicado \{count\} aplica/,
	)
	assert.match(
		en,
		/This code was already applied \{count\} application/,
	)
})
