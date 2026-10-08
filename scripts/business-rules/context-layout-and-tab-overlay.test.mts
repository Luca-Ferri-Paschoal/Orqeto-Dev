import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

void test("context creation is one semantic card with project, commit, and validation modes", async () => {
	const [folderSettings, folderStyles, workspace, dropZone, exportActions, ptBR, en] = await Promise.all([
		read("src/features/context/components/FolderSettings/index.tsx"),
		read("src/features/context/components/FolderSettings/style.ts"),
		read("src/features/context/components/ProjectWorkspacePane/index.tsx"),
		read("src/features/context/components/DropZone/index.tsx"),
		read("src/features/context/components/ContextExportActions/index.tsx"),
		read("src/infra/i18n/locales/pt-BR.ts"),
		read("src/infra/i18n/locales/en.ts"),
	])

	assert.match(
		folderSettings,
		/mode: "project"/,
	)
	assert.match(
		folderSettings,
		/mode: "commit" as const/,
	)
	assert.match(
		folderSettings,
		/mode: "validation" as const/,
	)
	assert.match(
		folderSettings,
		/actionExecuteButton/,
	)
	assert.match(
		folderSettings,
		/actionMenuButton/,
	)
	assert.match(
		folderSettings,
		/<\/CollapsibleRegion>\s*\{children\}/,
	)
	assert.match(
		folderSettings,
		/onClick=\{\(\) => props\.onExecute\(props\.currentAction\.value\)\}/,
	)
	assert.match(
		folderSettings,
		/props\.onSelect\(action\.value\)/,
	)
	assert.doesNotMatch(
		folderSettings,
		/useState<FolderAction>/,
	)
	assert.match(
		folderStyles,
		/collapseInner:[\s\S]*?"overflow-visible"/,
	)
	assert.match(
		workspace,
		/folder\.projectScope\.full/,
	)
	assert.match(
		workspace,
		/folder\.projectScope\.custom/,
	)
	assert.match(
		workspace,
		/generateDiagnosticContextReport\(kind\)/,
	)
	assert.match(
		workspace,
		/onGenerateDiagnostic\("eslint"\)/,
	)
	assert.match(
		workspace,
		/<DropZone[\s\S]*?embedded/,
	)
	assert.match(
		workspace,
		/showFilters=\{(?:props\.)?folderSectionExpanded\}/,
	)
	assert.match(
		workspace,
		/if \(mode === "project"\)[\s\S]{0,180}setRequestedContextMode\("create"\)/,
	)
	assert.match(
		dropZone,
		/if \(embedded\)/,
	)
	assert.match(
		exportActions,
		/const exportDisabled = disabled \|\| busy \|\| !generated/,
	)
	assert.match(
		ptBR,
		/"folder\.contextMode\.validation": "Validação"/,
	)
	assert.match(
		en,
		/"folder\.contextMode\.validation": "Validation"/,
	)
})

void test("tab loading overlay covers the complete workspace stage below project tabs", async () => {
	const [app, appStyles, workspaceStyles] = await Promise.all([
		read("src/App/index.tsx"),
		read("src/App/style.ts"),
		read("src/features/context/components/ProjectWorkspacePane/style.ts"),
	])

	assert.match(
		app,
		/<div className=\{styles\.workspaceStage\}>/,
	)
	assert.match(
		appStyles,
		/workspaceStage:[\s\S]*?"relative"[\s\S]*?"-mt-3"[\s\S]*?"pt-3"/,
	)
	assert.doesNotMatch(
		workspaceStyles,
		/root: cn\([\s\S]{0,80}"relative"/,
	)
})

// BR-UI-002
void test("routing decision dialogs stay outside the inert workspace content", async () => {
	const workspace = await read("src/features/context/components/ProjectWorkspacePane/index.tsx")

	assert.match(
		workspace,
		/inert=\{interaction\.isTabBusy\}[\s\S]*?<WorkspaceOverlays/,
	)
	assert.match(
		workspace,
		/<WorkspaceOverlays[\s\S]*?\{!suppressLoadingOverlay &&/,
	)
	assert.match(
		workspace,
		/active && workspace\.pendingGitPatch !== null[\s\S]*?active && workspace\.pendingOverlay !== null/,
	)
})
