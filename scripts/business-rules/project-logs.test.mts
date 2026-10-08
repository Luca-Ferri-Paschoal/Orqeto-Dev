import { formatProjectLogs } from "../../src/features/context/formatProjectLogs.ts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

// BR-LOG-001
void test("BR-LOG-001 development logs are explicit, trusted, bounded, redacted, and process-tree controlled", async () => {
	const [
		config,
		commands,
		model,
		processSource,
		bootstrap,
		rustTests,
	] = await Promise.all([
		read("src-tauri/src/project_logs/config.rs"),
		read("src-tauri/src/project_logs/commands.rs"),
		read("src-tauri/src/project_logs/model.rs"),
		read("src-tauri/src/project_logs/process.rs"),
		read("src-tauri/src/lib/app_bootstrap.rs"),
		read("src-tauri/src/project_logs/tests.rs"),
	])

	assert.match(
		config,
		/get\("orqetoDev"\)[\s\S]*get\("logs"\)[\s\S]*get\("development"\)/,
	)
	assert.doesNotMatch(
		config,
		/get\("scripts"\)/,
	)
	assert.match(
		commands,
		/current_command != expected_command/,
	)
	assert.match(
		commands,
		/state\.is_approved\(&root, &command\)/,
	)
	assert.match(
		commands,
		/thread::Builder::new\(\)[\s\S]*run_session/,
	)
	assert.match(
		commands,
		/get_project_log_snapshot[\s\S]*spawn_blocking/,
	)
	assert.match(
		commands,
		/stop_project_log_session[\s\S]*spawn_blocking/,
	)
	assert.match(
		processSource,
		/stdout\.take\(\)[\s\S]*stderr\.take\(\)/,
	)
	assert.match(
		processSource,
		/terminate_process_tree\(&mut child\)/,
	)
	assert.match(
		model,
		/MAX_LOG_BUFFER_BYTES: usize = 8 \* 1024 \* 1024/,
	)
	assert.match(
		model,
		/MAX_LOG_BUFFER_ENTRIES: usize = 20_000/,
	)
	assert.match(
		model,
		/redact_unstructured_text\(message\)/,
	)
	assert.match(
		bootstrap,
		/manage\(project_logs::ProjectLogState::new\(\)\)/,
	)
	assert.match(
		bootstrap,
		/project_logs::start_project_log_session/,
	)
	assert.match(
		bootstrap,
		/project_logs::stop_project_log_session/,
	)
	assert.match(
		rustTests,
		/development_log_command_is_explicit_only/,
	)
	assert.match(
		rustTests,
		/development_process_streams_output_and_can_stop/,
	)
	assert.match(
		rustTests,
		/log_buffer_is_bounded_redacted_and_clear_advances_the_cursor/,
	)
})

// BR-LOG-002
void test("BR-LOG-002 Logs UI exposes lifecycle and exports with default-on copy clear", async () => {
	const [
		panel,
		hook,
		exports,
		folderOptions,
		workspaceSection,
		settings,
		settingKeys,
		tabClose,
		rootClose,
		rootChange,
		shutdown,
		readme,
		docs,
	] = await Promise.all([
		read("src/features/context/components/ProjectLogsPanel/index.tsx"),
		read("src/features/context/components/ProjectLogsPanel/useProjectLogs.ts"),
		read("src/features/context/components/ProjectLogsPanel/exports.ts"),
		read("src/features/context/components/FolderSettings/options.ts"),
		read("src/features/context/components/ProjectWorkspacePane/sections/WorkspaceFolderSection.tsx"),
		read("src/domain/appSettings.ts"),
		read("src/infra/configDatabase/shared.ts"),
		read("src/features/context/workspace/actions/useTabCloseActions.ts"),
		read("src/features/context/workspace/actions/useWorkspaceRootFilterActions.ts"),
		read("src/features/context/workspace/actions/useWorkspaceRootActions.ts"),
		read("src-tauri/src/lib/export.rs"),
		read("README.md"),
		read("docs/docs.md"),
	])

	for (const key of ["logs.start", "logs.stop", "logs.copy", "logs.download", "logs.clear"]) {
		assert.match(
			panel,
			new RegExp(key.replaceAll(
				".",
				"[.]",
			)),
		)
	}
	assert.match(
		hook,
		/getProjectLogSnapshot/,
	)
	assert.match(
		hook,
		/if \(!active \|\| snapshotMutationRef\.current \|\| refreshInFlightRef\.current\)/,
	)
	assert.match(
		hook,
		/copyProjectLogs/,
	)
	assert.match(
		exports,
		/getProjectLogSnapshot\([\s\S]*0[\s\S]*writeText/,
	)
	assert.match(
		exports,
		/clearProjectLogSession\([\s\S]*snapshot\.latestSequence/,
	)
	assert.match(
		exports,
		/saveExportFile/,
	)
	assert.match(
		workspaceSection,
		/contextMode === "logs"[\s\S]*<ProjectLogsPanel/,
	)
	assert.match(
		folderOptions,
		/mode: "logs" as const/,
	)
	assert.match(
		settings,
		/DEFAULT_CLEAR_LOGS_AFTER_COPY = true/,
	)
	assert.match(
		settingKeys,
		/clearLogsAfterCopy: "clear_logs_after_copy"/,
	)
	assert.match(
		tabClose,
		/stopProjectLogSession\(rootFolderRef\.current\)/,
	)
	assert.match(
		rootClose,
		/stopProjectLogSession\(configuredRootFolder\)/,
	)
	assert.match(
		rootChange,
		/stopProjectLogSession\(previousRootFolder\)/,
	)
	assert.match(
		shutdown,
		/project_log_state\.stop_all_and_wait\(\)/,
	)
	assert.match(
		readme,
		/"development": "npm run dev"/,
	)
	assert.match(
		docs,
		/clear_logs_after_copy/,
	)
})

void test("project log export preserves ordered retained entries and truncation metadata", () => {
	const content = formatProjectLogs(
		"en",
		"npm run dev",
		1_700_000_000_000,
		[
			{ timestampMs: 1_700_000_001_000, stream: "stdout", message: "server ready" },
			{ timestampMs: 1_700_000_002_000, stream: "stderr", message: "request failed" },
		],
		true,
	)

	assert.match(
		content,
		/# Project logs/,
	)
	assert.match(
		content,
		/Command: npm run dev/,
	)
	assert.ok(content.indexOf("server ready") < content.indexOf("request failed"))
	assert.match(
		content,
		/older logs were discarded/,
	)
})

void test("project log frontend stays strict-TypeScript and effect-safe", async () => {
	const [helper, hook, formatter, state] = await Promise.all([
		read("src/features/context/components/ProjectLogsPanel/helpers.ts"),
		read("src/features/context/components/ProjectLogsPanel/useProjectLogs.ts"),
		read("src/features/context/formatProjectLogs.ts"),
		read("src/features/context/components/ProjectLogsPanel/state.ts"),
	])

	assert.match(
		helper,
		/const next = entries\[start - 1\][\s\S]*if \(next === undefined\)\s*break/,
	)
	assert.doesNotMatch(
		hook,
		/type Locale/,
	)
	assert.doesNotMatch(
		hook,
		/startedAtMs/,
	)
	const pollingEffect = hook.match(/useEffect\(\(\) => \{\s*snapshotEpochRef[\s\S]*?\}, \[refresh, rootFolder\]\)/)?.[0]
	assert.ok(pollingEffect)
	assert.doesNotMatch(
		pollingEffect,
		/\bset(?:ViewState|Entries|SessionCommand|Running|ExitCode|Truncated)\(/,
	)
	assert.doesNotMatch(
		formatter,
		/from "[.]\/types[.]js"/,
	)
	assert.match(
		formatter,
		/interface ProjectLogEntryForFormat/,
	)
	assert.match(
		formatter,
		/from "\.\.\/\.\.\/domain\/locale\.js"/,
	)
	assert.match(
		hook,
		/emptyProjectLogsViewState/,
	)
	assert.match(
		hook,
		/projectLogTrustKey/,
	)
	assert.match(
		state,
		/trustedProjectLogCommands/,
	)
	assert.ok(hook.split("\n").length <= 300)
})
