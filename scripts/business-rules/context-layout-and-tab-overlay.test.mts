import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
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
		/onClick=\{\(\) => executeAction\(currentAction\.value\)\}/,
	)
	assert.match(
		folderSettings,
		/onSelectedActionChange\(action\.value\)/,
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
		/generateValidation\("typecheck"\)/,
	)
	assert.match(
		workspace,
		/generateValidation\("eslint"\)/,
	)
	assert.match(
		workspace,
		/<DropZone[\s\S]*?embedded/,
	)
	assert.match(
		workspace,
		/showFilters=\{folderSectionExpanded\}/,
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
