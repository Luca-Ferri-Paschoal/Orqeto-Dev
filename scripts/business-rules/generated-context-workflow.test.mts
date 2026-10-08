import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import { test } from "node:test"

void test(
	"Commit and Validation reuse prepared reports while validation tool buttons generate directly",
	async () => {
		const actions = await readProjectFile("src/features/context/components/ContextExportActions/index.tsx")
		const pane = await readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx")
		const gitActions = await readProjectFile("src/features/context/workspace/actions/useGitContextActions.ts")
		const diagnosticGenerate = await readProjectFile("src/features/context/workspace/actions/useDiagnosticGenerateActions.ts")
		const diagnosticExport = await readProjectFile("src/features/context/workspace/actions/useDiagnosticExportActions.ts")

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
			/const hasGenerateStep = contextMode === "project" \|\| contextMode === "commit"/,
		)
		assert.match(
			pane,
			/workspace\.generateGitCommitContextReport\(\)/,
		)
		assert.match(
			pane,
			/generateDiagnosticContextReport\(kind\)/,
		)
		assert.match(
			pane,
			/onGenerateDiagnostic\("eslint"\)/,
		)
		assert.match(
			pane,
			/formatByteSize\(preparedContextByteCount\)/,
		)

		assert.match(
			gitActions,
			/setPreparedGitCommitContext\(\{/,
		)
		assert.match(
			diagnosticGenerate,
			/setPreparedDiagnosticContexts\(current => \(\{/,
		)
		assert.match(
			gitActions,
			/byteCount: getGeneratedContentByteCount\(content\)/,
		)
		assert.match(
			diagnosticGenerate,
			/byteCount: getGeneratedContentByteCount\(result\.content\)/,
		)

		assert.match(
			gitActions,
			/const copyGitCommitContext = useCallback\([\s\S]*writeText\(prepared\.content\)/,
		)
		assert.doesNotMatch(
			gitActions.slice(gitActions.indexOf("const copyGitCommitContext")),
			/generateGitCommitContext\(/,
		)
		assert.match(
			diagnosticExport,
			/const copyDiagnosticContext = useCallback\([\s\S]*writeText\(prepared\.content\)/,
		)
		assert.doesNotMatch(
			diagnosticExport,
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

void test(
	"BR-CTX-009 generated Commit/TypeScript/ESLint reports auto-copy by default without removing manual Copy",
	async () => {
		const types = await readProjectFile("src/domain/appSettings.ts")
		const database = await readProjectFile("src/infra/configDatabase.ts")
		const settings = await readProjectFile("src/features/context/components/SettingsDrawer/index.tsx")
		const gitActions = await readProjectFile("src/features/context/workspace/actions/useGitContextActions.ts")
		const diagnosticGenerate = await readProjectFile("src/features/context/workspace/actions/useDiagnosticGenerateActions.ts")
		const diagnosticExport = await readProjectFile("src/features/context/workspace/actions/useDiagnosticExportActions.ts")

		assert.match(
			types,
			/DEFAULT_AUTO_COPY_GENERATED_REPORTS = true/,
		)
		assert.match(
			database,
			/auto_copy_generated_reports/,
		)
		assert.match(
			settings,
			/settings\.autoCopyGeneratedReports/,
		)

		assert.match(
			gitActions,
			/const generateGitCommitContextReport = useCallback\([\s\S]*if \(autoCopyGeneratedReports\)[\s\S]*?await writeText\(content\)/,
		)
		assert.match(
			diagnosticGenerate,
			/const generateDiagnosticContextReport = useCallback\([\s\S]*if \(autoCopyGeneratedReports\)[\s\S]*?await writeText\(result\.content\)/,
		)
		assert.match(
			gitActions,
			/const copyGitCommitContext = useCallback/,
		)
		assert.match(
			diagnosticExport,
			/const copyDiagnosticContext = useCallback/,
		)
	},
)

void test(
	"BR-CTX-010 full-project context scans only on explicit request and reuses the scanned path set for export",
	async () => {
		const pane = await readProjectFile("src/features/context/components/ProjectWorkspacePane/index.tsx")
		const projectMode = await readProjectFile("src/features/context/components/ProjectWorkspacePane/sections/ProjectModeContent.tsx")
		const contextActions = await readProjectFile("src/features/context/components/ProjectWorkspacePane/hooks/useWorkspaceContextActions.ts")
		const actions = await readProjectFile("src/features/context/components/ContextExportActions/index.tsx")
		const scanActions = await readProjectFile("src/features/context/workspace/actions/useFullProjectScanActions.ts")
		const exportActions = await readProjectFile("src/features/context/workspace/actions/useFullProjectExportActions.ts")
		const ptBR = await readProjectFile("src/infra/i18n/locales/pt-BR.ts")
		const en = await readProjectFile("src/infra/i18n/locales/en.ts")

		assert.doesNotMatch(
			pane,
			/setTimeout\([\s\S]*?refreshFullProjectContextSummary/,
			"Selecting Full project must not start a delayed automatic scan",
		)
		assert.match(
			projectMode,
			/generateAction="scan"[\s\S]*?onGenerate=\{onGenerate\}/,
		)
		assert.match(
			contextActions,
			/contextMode === "project" \?[\s\S]*?workspace\.fullProjectContextSummary !== null/,
		)
		assert.match(
			actions,
			/generateAction\?: "generate" \| "scan"/,
		)
		assert.match(
			ptBR,
			/"folder\.contextExport\.scan": "Escanear"/,
		)
		assert.match(
			en,
			/"folder\.contextExport\.scan": "Scan"/,
		)

		assert.match(
			scanActions,
			/const refreshFullProjectContextSummary = useCallback\([\s\S]*selection: ProcessDropResult = await processDrop\([\s\S]*relativePaths: filteredFiles\.map\(file => file\.relativePath\)/,
		)
		assert.match(
			scanActions,
			/const getScannedFullProjectContextFiles = useCallback\([\s\S]*const loadFullProjectContext = useCallback\([\s\S]*getScannedFullProjectContextFiles\(\)/,
		)
		assert.doesNotMatch(
			scanActions.slice(scanActions.indexOf("const loadFullProjectContext")),
			/processDrop\(/,
		)
		assert.match(
			exportActions,
			/const downloadFullProjectContext = useCallback\([\s\S]*getScannedFullProjectContextFiles\(\)/,
		)
		assert.doesNotMatch(
			exportActions,
			/processDrop\(/,
		)
	},
)
