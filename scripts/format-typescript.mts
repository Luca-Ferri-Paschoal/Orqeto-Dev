import { ESLint } from "eslint"
import {
	readdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

type FormatMode = "write" | "check"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
)
const formatEslintConfigPath = path.join(
	rootDirectory,
	"eslint.format.config.mts",
)

const ROOTS = [
	"src",
	"scripts",
	"integrations/vscode/src",
]

const ROOT_FILES = [
	"eslint.config.mts",
	"eslint.format.config.mts",
	"vite.config.ts",
]

const EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
])

const IGNORED_DIRECTORIES = new Set([
	".git",
	".lint-batch",
	".react-router",
	".turbo",
	".vite",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"src-tauri",
])

const MAX_FORMAT_PASSES = 8

const FORMAT_SETTINGS: ts.FormatCodeSettings = {
	baseIndentSize: 0,
	indentSize: 4,
	tabSize: 4,
	convertTabsToSpaces: false,
	indentStyle: ts.IndentStyle.Smart,
	newLineCharacter: "\n",
	trimTrailingWhitespace: true,
	insertSpaceAfterCommaDelimiter: true,
	insertSpaceAfterSemicolonInForStatements: true,
	insertSpaceBeforeAndAfterBinaryOperators: true,
	insertSpaceAfterKeywordsInControlFlowStatements: true,
	insertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
	insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: false,
	insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
	insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
	insertSpaceAfterTypeAssertion: false,
	insertSpaceBeforeFunctionParenthesis: false,
	placeOpenBraceOnNewLineForFunctions: false,
	placeOpenBraceOnNewLineForControlBlocks: false,
	insertSpaceBeforeTypeAnnotation: false,
	indentMultiLineObjectLiteralBeginningOnBlankLine: false,
	semicolons: ts.SemicolonPreference.Ignore,
	indentSwitchCase: true,
}

const eslintFormatter = new ESLint({
	cwd: rootDirectory,
	overrideConfigFile: formatEslintConfigPath,
	fix: true,
})

function getMode(): FormatMode {
	const mode = process.argv[2] ?? "write"

	if (
		mode !== "write" &&
		mode !== "check"
	)
		throw new Error('Expected formatter mode "write" or "check".')

	return mode
}

function normalizeSource(source: string): string {
	const normalized = source
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replace(/[\t ]+$/gm, "")
		.replace(/\n*$/, "")

	return `${normalized}\n`
}

async function collectFiles(directory: string): Promise<string[]> {
	let entries

	try {
		entries = await readdir(
			directory,
			{
				withFileTypes: true,
			},
		)
	} catch {
		return []
	}

	const files: string[] = []

	for (const entry of entries) {
		const entryPath = path.join(
			directory,
			entry.name,
		)

		if (entry.isDirectory()) {
			if (IGNORED_DIRECTORIES.has(entry.name))
				continue

			files.push(...await collectFiles(entryPath))
			continue
		}

		if (
			entry.isFile() &&
			EXTENSIONS.has(path.extname(entry.name))
		)
			files.push(entryPath)
	}

	return files
}

async function fileExists(fileName: string): Promise<boolean> {
	try {
		return (await stat(fileName)).isFile()
	} catch {
		return false
	}
}

async function getProjectFiles(): Promise<string[]> {
	const files = (
		await Promise.all(ROOTS.map(root => collectFiles(path.join(
			rootDirectory,
			root,
		))))
	).flat()

	for (const rootFile of ROOT_FILES) {
		const fileName = path.join(
			rootDirectory,
			rootFile,
		)

		if (await fileExists(fileName))
			files.push(fileName)
	}

	return [...new Set(files)].sort((left, right) =>
		left.localeCompare(right))
}

function applyEdits(
	source: string,
	edits: readonly ts.TextChange[],
): string {
	let formatted = source

	for (
		const edit of [...edits].sort((left, right) =>
			right.span.start - left.span.start)
	) {
		const start = edit.span.start
		const end = start + edit.span.length

		formatted = formatted.slice(
			0,
			start,
		) +
			edit.newText +
			formatted.slice(end)
	}

	return formatted
}

function isSimpleJsxAttributeExpression(expression: ts.Expression): boolean {
	if (
		ts.isIdentifier(expression) ||
		ts.isPropertyAccessExpression(expression) ||
		ts.isElementAccessExpression(expression) ||
		ts.isStringLiteralLike(expression) ||
		ts.isNumericLiteral(expression) ||
		expression.kind === ts.SyntaxKind.TrueKeyword ||
		expression.kind === ts.SyntaxKind.FalseKeyword ||
		expression.kind === ts.SyntaxKind.NullKeyword ||
		expression.kind === ts.SyntaxKind.ThisKeyword
	)
		return true

	if (
		ts.isParenthesizedExpression(expression) ||
		ts.isNonNullExpression(expression) ||
		ts.isAsExpression(expression) ||
		ts.isSatisfiesExpression(expression)
	)
		return isSimpleJsxAttributeExpression(expression.expression)

	return false
}

function formatSimpleJsxAttributeExpressions(
	fileName: string,
	source: string,
): string {
	if (path.extname(fileName) !== ".tsx")
		return source

	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	)
	const edits: ts.TextChange[] = []

	function visit(node: ts.Node): void {
		if (ts.isJsxAttribute(node)) {
			const initializer = node.initializer

			if (
				initializer !== undefined &&
				ts.isJsxExpression(initializer)
			) {
				const expression = initializer.expression

				if (
					expression !== undefined &&
					isSimpleJsxAttributeExpression(expression)
				) {
					const initializerStart = initializer.getStart(sourceFile)
					const initializerEnd = initializer.end
					const expressionStart = expression.getStart(sourceFile)
					const expressionEnd = expression.end
					const beforeExpression = source.slice(
						initializerStart + 1,
						expressionStart,
					)
					const afterExpression = source.slice(
						expressionEnd,
						initializerEnd - 1,
					)
					const expressionText = source.slice(
						expressionStart,
						expressionEnd,
					)

					if (
						!expressionText.includes("\n") &&
						/^\s*$/.test(beforeExpression) &&
						/^\s*$/.test(afterExpression) &&
						(
							beforeExpression.includes("\n") ||
							afterExpression.includes("\n")
						)
					) {
						edits.push({
							span: {
								start: initializerStart,
								length: initializerEnd - initializerStart,
							},
							newText: `{${expressionText}}`,
						})
					}
				}
			}
		}

		ts.forEachChild(
			node,
			visit,
		)
	}

	visit(sourceFile)

	return applyEdits(
		source,
		edits,
	)
}

function formatWithTypeScript(
	fileName: string,
	source: string,
): string {
	const absoluteFileName = path.resolve(fileName)
	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => ({
			allowJs: false,
			jsx: ts.JsxEmit.ReactJSX,
			target: ts.ScriptTarget.ESNext,
		}),
		getCurrentDirectory: () => rootDirectory,
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
		getScriptFileNames: () => [
			absoluteFileName,
		],
		getScriptSnapshot: requestedFileName => {
			if (path.resolve(requestedFileName) === absoluteFileName)
				return ts.ScriptSnapshot.fromString(source)

			const librarySource = ts.sys.readFile(requestedFileName)

			if (librarySource === undefined)
				return undefined

			return ts.ScriptSnapshot.fromString(librarySource)
		},
		getScriptVersion: () => "1",
		fileExists: requestedFileName => ts.sys.fileExists(requestedFileName),
		readFile: requestedFileName => ts.sys.readFile(requestedFileName),
		readDirectory: (
			rootDir,
			extensions,
			excludes,
			includes,
			depth,
		) => ts.sys.readDirectory(
			rootDir,
			extensions,
			excludes,
			includes,
			depth,
		),
	}
	const languageService = ts.createLanguageService(host)

	try {
		const edits = languageService.getFormattingEditsForDocument(
			absoluteFileName,
			FORMAT_SETTINGS,
		)

		return normalizeSource(applyEdits(
			source,
			edits,
		))
	} finally {
		languageService.dispose()
	}
}

async function formatWithEslint(
	fileName: string,
	source: string,
): Promise<string> {
	const [result] = await eslintFormatter.lintText(
		source,
		{
			filePath: fileName,
		},
	)

	if (!result)
		throw new Error(`ESLint did not return a formatter result for ${fileName}.`)

	const fatalMessages = result.messages.filter(message => message.fatal)

	if (fatalMessages.length > 0) {
		const details = fatalMessages
			.map(message => `${message.line}:${message.column} ${message.message}`)
			.join("\n")

		throw new Error(`Formatting parse error in ${fileName}:\n${details}`)
	}

	return normalizeSource(result.output ?? source)
}

async function formatToStable(
	fileName: string,
	source: string,
): Promise<string> {
	let current = normalizeSource(source)
	const seen = new Set<string>()

	for (
		let pass = 1;
		pass <= MAX_FORMAT_PASSES;
		pass++
	) {
		if (seen.has(current)) {
			throw new Error(`Formatter cycle detected for ${path.relative(
				rootDirectory,
				fileName,
			)}.`)
		}

		seen.add(current)

		const typeScriptFormatted = formatWithTypeScript(
			fileName,
			current,
		)
		const jsxAttributeFormatted = formatSimpleJsxAttributeExpressions(
			fileName,
			typeScriptFormatted,
		)
		const next = await formatWithEslint(
			fileName,
			jsxAttributeFormatted,
		)

		if (next === current)
			return current

		current = next
	}

	throw new Error(`Formatter did not converge after ${MAX_FORMAT_PASSES} passes for ${path.relative(
		rootDirectory,
		fileName,
	)}.`)
}

async function assertStable(
	fileName: string,
	formatted: string,
): Promise<void> {
	const formattedAgain = await formatToStable(
		fileName,
		formatted,
	)

	if (formattedAgain !== formatted) {
		throw new Error(`Formatter is not idempotent for ${path.relative(
			rootDirectory,
			fileName,
		)}.`)
	}
}

async function writeFormattedFiles(files: readonly string[]): Promise<void> {
	let changedCount = 0

	for (const fileName of files) {
		const source = await readFile(
			fileName,
			"utf8",
		)
		const formatted = await formatToStable(
			fileName,
			source,
		)

		await assertStable(
			fileName,
			formatted,
		)

		if (formatted === source)
			continue

		await writeFile(
			fileName,
			formatted,
			"utf8",
		)
		changedCount++
	}

	console.log(`Processed ${files.length} TypeScript files.`)
	console.log(`Changed ${changedCount} TypeScript files.`)
}

async function checkFormattedFiles(files: readonly string[]): Promise<void> {
	const changedFiles: string[] = []

	for (const fileName of files) {
		const source = await readFile(
			fileName,
			"utf8",
		)
		const formatted = await formatToStable(
			fileName,
			source,
		)

		await assertStable(
			fileName,
			formatted,
		)

		if (formatted !== source) {
			changedFiles.push(path.relative(
				rootDirectory,
				fileName,
			))
		}
	}

	console.log(`Checked ${files.length} TypeScript files.`)

	if (changedFiles.length === 0) {
		console.log("Formatting is stable.")
		return
	}

	console.error("Formatting changes are required in:")

	for (const fileName of changedFiles)
		console.error(`- ${fileName}`)

	throw new Error("Formatting is not stable. Run npm run format:ts.")
}

const mode = getMode()
const files = await getProjectFiles()

if (mode === "check")
	await checkFormattedFiles(files)
else
	await writeFormattedFiles(files)
