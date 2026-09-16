import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
	"..",
)

async function readProjectFile(relativePath: string): Promise<string> {
	return readFile(
		path.join(
			rootDirectory,
			relativePath,
		),
		"utf8",
	)
}

void test(
	"Commit and Validation reuse prepared reports while validation tool buttons generate directly",
	async () => {
		const actions = await readProjectFile("src/features/context/components/ContextExportActions/index.tsx")
		const pane = await readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx")
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")

		assert.match(
			actions,
			/onGenerate\?: \(\) => void/,
		)
		assert.match(
			actions,
			/const exportDisabled = disabled \|\| busy \|\| !generated/,
		)
		assert.ok(
			actions.indexOf("onClick={onGenerate}") < actions.indexOf("onClick={onCopy}"),
			"Generate must be rendered before Copy",
		)
		assert.ok(
			actions.indexOf("onClick={onCopy}") < actions.indexOf("onClick={onDownload}"),
			"Copy must be rendered before Download",
		)

		assert.match(
			pane,
			/const hasGenerateStep = contextMode === "commit"/,
		)
		assert.match(
			pane,
			/workspace\.generateGitCommitContextReport\(\)/,
		)
		assert.match(
			pane,
			/generateValidation\("typecheck"\)/,
		)
		assert.match(
			pane,
			/generateValidation\("eslint"\)/,
		)
		assert.match(
			pane,
			/formatByteSize\(preparedContextByteCount\)/,
		)

		assert.match(
			workspace,
			/setPreparedGitCommitContext\(\{/,
		)
		assert.match(
			workspace,
			/setPreparedDiagnosticContexts\(current => \(\{/,
		)
		assert.match(
			workspace,
			/byteCount: getGeneratedContentByteCount\(content\)/,
		)
		assert.match(
			workspace,
			/byteCount: getGeneratedContentByteCount\(result\.content\)/,
		)

		const copyCommitStart = workspace.indexOf("const copyGitCommitContext = useCallback(")
		const downloadCommitStart = workspace.indexOf("const downloadGitCommitContext = useCallback(")
		const commitCopyBlock = workspace.slice(
			copyCommitStart,
			downloadCommitStart,
		)
		assert.match(
			commitCopyBlock,
			/writeText\(prepared\.content\)/,
		)
		assert.doesNotMatch(
			commitCopyBlock,
			/generateGitCommitContext\(/,
		)

		const copyDiagnosticStart = workspace.indexOf("const copyDiagnosticContext = useCallback(")
		const downloadDiagnosticStart = workspace.indexOf("const downloadDiagnosticContext = useCallback(")
		const diagnosticCopyBlock = workspace.slice(
			copyDiagnosticStart,
			downloadDiagnosticStart,
		)
		assert.match(
			diagnosticCopyBlock,
			/writeText\(prepared\.content\)/,
		)
		assert.doesNotMatch(
			diagnosticCopyBlock,
			/generateProjectDiagnosticContext\(/,
		)
	},
)

void test(
	"BR-CTX-008 manual Clear remains available when selected paths are unavailable",
	async () => {
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")
		const ptBR = await readProjectFile("src/infra/i18n/locales/pt-BR.ts")
		const en = await readProjectFile("src/infra/i18n/locales/en.ts")
		const clearStart = workspace.indexOf("const clearGeneratedContent = useCallback(")
		const clearEnd = workspace.indexOf("const invalidateMissingRootFolder = useCallback(")
		const clearBlock = workspace.slice(
			clearStart,
			clearEnd,
		)

		assert.ok(clearStart >= 0 && clearEnd > clearStart)
		assert.match(
			clearBlock,
			/const hasUnavailableItems = materialized !== null && materialized\.skippedFiles > 0/,
		)
		assert.match(
			clearBlock,
			/!hasUnavailableItems[\s\S]*?archiveContextSnapshot/,
		)
		assert.match(
			clearBlock,
			/replaceFiles\(\[\]\)/,
		)
		assert.match(
			clearBlock,
			/status:\s*hasUnavailableItems\s*\?\s*"partial"\s*:\s*"success"/,
		)
		assert.match(
			clearBlock,
			/"workspace\.contextClearedUnavailable"/,
		)
		assert.doesNotMatch(
			clearBlock,
			/contextClearBlockedUnavailable/,
		)
		assert.match(
			ptBR,
			/"workspace\.contextClearedUnavailable"/,
		)
		assert.match(
			en,
			/"workspace\.contextClearedUnavailable"/,
		)
	},
)
