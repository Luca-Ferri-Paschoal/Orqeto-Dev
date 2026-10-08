import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import { test } from "node:test"

void test(
	"BR-PERF-005 release bundle splits third-party dependencies instead of hiding the chunk-size warning",
	async () => {
		const viteConfig = await readProjectFile("vite.config.ts")

		assert.match(
			viteConfig,
			/codeSplitting:\s*\{/,
		)
		assert.match(
			viteConfig,
			/name: "vendor"/,
		)
		assert.match(
			viteConfig,
			/node_modules/,
		)
		assert.match(
			viteConfig,
			/maxSize: 350_000/,
		)
		assert.doesNotMatch(
			viteConfig,
			/chunkSizeWarningLimit/,
		)
	},
)

void test(
	"BR-UI-001 project UI state is global and shared by every open tab",
	async () => {
		const app = await readProjectFile("src/App/index.tsx")
		const settings = await readProjectFile("src/features/context/useAppSettings.ts")
		const frontendConfig = await readProjectFile("src/infra/configDatabase.ts")
		const configDatabase = await readProjectFile("src-tauri/src/config_database.rs")
		const settingValidation = configDatabase.slice(
			configDatabase.indexOf("fn validate_setting"),
			configDatabase.indexOf("async fn trim_filter_history"),
		)

		assert.match(
			app,
			/folderSectionExpanded=\{appSettings\.folderSectionExpanded\}/,
		)
		assert.match(
			app,
			/contextSectionExpanded=\{appSettings\.contextSectionExpanded\}/,
		)
		assert.match(
			app,
			/applySectionExpanded=\{appSettings\.applySectionExpanded\}/,
		)
		assert.match(
			app,
			/folderAction=\{appSettings\.folderAction\}/,
		)
		assert.match(
			app,
			/onFolderActionChange=\{action => void appSettings\.updateFolderAction\(action\)\}/,
		)
		assert.doesNotMatch(
			app,
			/setProjectTabSectionExpanded/,
		)
		assert.match(
			settings,
			/updateFolderSectionExpanded/,
		)
		assert.match(
			settings,
			/updateContextSectionExpanded/,
		)
		assert.match(
			settings,
			/updateApplySectionExpanded/,
		)
		assert.match(
			settings,
			/updateFolderAction/,
		)
		assert.match(
			frontendConfig,
			/folderAction: "folder_action"/,
		)
		assert.match(
			frontendConfig,
			/setFolderActionSetting/,
		)
		for (const settingKey of [
			"folder_action",
			"folder_section_expanded",
			"context_section_expanded",
			"apply_section_expanded",
		]) {
			assert.match(
				settingValidation,
				new RegExp(`"${settingKey}"`),
			)
		}
	},
)

void test(
	"Navigation and Settings collapse state survives application restart",
	async () => {
		const app = await readProjectFile("src/App/index.tsx")
		const settings = await readProjectFile("src/features/context/useAppSettings.ts")
		const drawer = await readProjectFile("src/features/context/components/SettingsDrawer/index.tsx")
		const configDatabase = await readProjectFile("src-tauri/src/config_database.rs")
		const settingValidation = configDatabase.slice(
			configDatabase.indexOf("fn validate_setting"),
			configDatabase.indexOf("async fn trim_filter_history"),
		)
		const settingsLoadQuery = configDatabase.slice(
			configDatabase.indexOf("pub async fn config_get_settings"),
			configDatabase.indexOf("pub async fn config_get_project_tabs"),
		)

		assert.match(
			app,
			/getActiveProjectTabId\(\)/,
		)
		assert.match(
			app,
			/const desiredActiveTabId = duplicateActiveTabRedirect \?\? storedActiveTabId/,
		)
		assert.match(
			app,
			/nextTabs\.find\(tab => tab\.id === desiredActiveTabId\)/,
		)
		assert.match(
			app,
			/setActiveProjectTabId\(nextActiveTab\.id\)/,
		)

		for (const settingName of [
			"settingsGeneralExpanded",
			"settingsContextExpanded",
			"settingsHistoryExpanded",
			"settingsVscodeExpanded",
			"settingsExplorerExpanded",
		]) {
			assert.match(
				settings,
				new RegExp(settingName),
			)
			assert.match(
				drawer,
				new RegExp(settingName),
			)
		}

		for (const settingKey of [
			"folder_action",
			"folder_section_expanded",
			"context_section_expanded",
			"apply_section_expanded",
			"settings_general_expanded",
			"settings_context_expanded",
			"settings_history_expanded",
			"settings_vscode_expanded",
			"settings_explorer_expanded",
		]) {
			assert.match(
				settingValidation,
				new RegExp(`"${settingKey}"`),
			)
			assert.match(
				settingsLoadQuery,
				new RegExp(`'${settingKey}'`),
			)
		}

		assert.doesNotMatch(
			drawer,
			/INITIAL_OPEN_SECTIONS/,
		)
	},
)
