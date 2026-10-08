import { formatGitCommitComparison } from "../../src/features/context/formatGitCommitComparison.ts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function source(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

const initial = {
	hash: "a".repeat(40),
	shortHash: "a".repeat(8),
	subject: "Initial snapshot",
	author: "Alice",
	authoredAt: "2026-09-20T14:35:00+00:00",
}
const finalCommit = {
	hash: "b".repeat(40),
	shortHash: "b".repeat(8),
	subject: "Later snapshot",
	author: "Bob",
	authoredAt: "2026-09-22T15:40:00+00:00",
}

void test("commit comparison export includes both full hashes, metadata, direction, counts, and intact diff", () => {
	const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new"
	const input = {
		repositoryName: "example-repo",
		initial,
		finalCommit,
		fileCount: 1,
		addedLines: 1,
		deletedLines: 1,
		diff,
	}
	const pt = formatGitCommitComparison(
		"pt-BR",
		input,
	)
	assert.match(
		pt,
		/COMPARAÇÃO DE COMMITS/,
	)
	assert.ok(pt.indexOf(initial.hash) < pt.indexOf(finalCommit.hash))
	assert.ok(pt.indexOf("Alice") < pt.indexOf("Bob"))
	assert.match(
		pt,
		/Initial snapshot/,
	)
	assert.match(
		pt,
		/Later snapshot/,
	)
	assert.match(
		pt,
		/Linhas adicionadas: 1/,
	)
	assert.match(
		pt,
		/Linhas removidas: 1/,
	)
	assert.match(
		pt,
		/não aplicar este diff automaticamente/,
	)
	assert.ok(
		pt.includes(diff),
		"diff must be included verbatim after backend redaction",
	)
	const en = formatGitCommitComparison(
		"en",
		input,
	)
	assert.match(
		en,
		/INITIAL COMMIT/,
	)
	assert.match(
		en,
		/FINAL COMMIT/,
	)
	assert.match(
		en,
		/Read-only context/,
	)
	assert.match(
		formatGitCommitComparison(
			"en",
			{ ...input, diff: "" },
		),
		/No differences between the versions/,
	)
})

void test("commit comparison uses bounded read-only Git commands and validates both exact commits", async () => {
	const [implementation, bindings, invocations, formatter, tests] = await Promise.all([
		source("src-tauri/src/git_context/commit_compare.rs"),
		source("src-tauri/src/lib/app_bootstrap.rs"),
		source("src/infra/desktop/git.ts"),
		source("src/features/context/formatGitCommitComparison.ts"),
		source("src-tauri/src/git_context/commit_compare_tests.rs"),
	])
	assert.match(
		implementation,
		/"log", "--all"/,
	)
	assert.match(
		implementation,
		/COMMIT_HISTORY_PAGE_SIZE: usize = 100/,
	)
	assert.match(
		implementation,
		/valid_commit_hash\(hash\)/,
	)
	assert.match(
		implementation,
		/"show", "--no-patch"/,
	)
	assert.match(
		implementation,
		/"diff", "--no-ext-diff", "--no-textconv", "--no-color"/,
	)
	assert.match(
		implementation,
		/"--numstat"/,
	)
	assert.match(
		implementation,
		/MAX_COMMIT_COMPARISON_BYTES/,
	)
	assert.match(
		implementation,
		/context_redaction::redact_git_diff\(diff\)/,
	)
	assert.match(
		implementation,
		/context_redaction::redact_unstructured_text/,
	)
	assert.match(
		implementation,
		/undo_state\.begin_project_read\(&root_folder\)/,
	)
	assert.doesNotMatch(
		implementation,
		/"checkout"|"reset"|"cherry-pick"|"apply"|"commit"/,
	)
	assert.match(
		bindings,
		/git_context::list_git_commits/,
	)
	assert.match(
		bindings,
		/git_context::compare_git_commits/,
	)
	assert.match(
		invocations,
		/"list_git_commits"/,
	)
	assert.match(
		invocations,
		/"compare_git_commits"/,
	)
	assert.match(
		formatter,
		/result\.initial/,
	)
	assert.match(
		formatter,
		/result\.finalCommit/,
	)
	assert.match(
		tests,
		/commit_comparison_lists_and_diffs_without_modifying_worktree/,
	)
})

void test("commit comparison is integrated with Commit export, exact selected hashes, and existing history", async () => {
	const [pane, section, picker, hook, actions, workspace, current, model, pt, en] = await Promise.all([
		source("src/features/context/components/ProjectWorkspacePane/sections/WorkspaceFolderSection.tsx"),
		source("src/features/context/components/CommitContextSection/index.tsx"),
		source("src/features/context/components/CommitContextSection/CommitComparisonPicker.tsx"),
		source("src/features/context/components/CommitContextSection/useCommitHistory.ts"),
		source("src/features/context/workspace/actions/useGitCommitComparisonActions.ts"),
		source("src/features/context/workspace/createContextWorkspace.ts"),
		source("src/features/context/workspace/actions/useGitContextActions.ts"),
		source("src/features/context/workspace/types.ts"),
		source("src/infra/i18n/locales/ptBR/workspaceB.ts"),
		source("src/infra/i18n/locales/en/workspaceB.ts"),
	])
	assert.match(
		pane,
		/contextMode === "commit"[\s\S]*<CommitContextSection/,
	)
	assert.match(
		section,
		/"current" \| "compare"/,
	)
	assert.match(
		section,
		/<ContextExportActions/,
	)
	assert.match(
		picker,
		/kind === "from"\s*\?\s*from\s*:\s*to/,
	)
	assert.match(
		picker,
		/<select/,
	)
	assert.match(
		picker,
		/comparison\?\.from === from && comparison\.to === to/,
	)
	assert.match(
		hook,
		/listGitCommits\(\s*rootFolder,\s*0,?\s*\)/,
	)
	assert.match(
		hook,
		/listGitCommits\(\s*rootFolder,\s*fetchedCount,?\s*\)/,
	)
	assert.match(
		actions,
		/compareGitCommits\(\s*root,\s*from,\s*to,?\s*\)/,
	)
	assert.match(
		actions,
		/archiveContextSnapshot\(\s*content,\s*result\.fileCount,\s*"commit",?\s*\)/,
	)
	assert.match(
		actions,
		/autoCopyGeneratedReports/,
	)
	assert.match(
		workspace,
		/gitCommitComparisonSelection:/,
	)
	assert.match(
		model,
		/variant: "current" \| "compare"/,
	)
	assert.match(
		current,
		/prepared\.variant === "compare"/,
	)
	for (const content of [pt, en]) {
		assert.match(
			content,
			/"commitCompare.initial"/,
		)
		assert.match(
			content,
			/"commitCompare.final"/,
		)
	}
})
