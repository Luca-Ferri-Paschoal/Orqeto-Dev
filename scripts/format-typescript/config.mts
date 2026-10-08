import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

export type FormatMode = "write" | "check"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
	"..",
)
export const formatEslintConfigPath = path.join(
	rootDirectory,
	"eslint.format.config.mts",
)
export const ROOTS = ["src", "scripts", "integrations/vscode/src"]
export const ROOT_FILES = ["eslint.config.mts", "eslint.format.config.mts", "vite.config.ts"]
export const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"])
export const IGNORED_DIRECTORIES = new Set([
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
export const MAX_FORMAT_PASSES = 8
export const FORMAT_SETTINGS: ts.FormatCodeSettings = {
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

export function getMode(): FormatMode {
	const mode = process.argv[2] ?? "write"
	if (mode !== "write" && mode !== "check")
		throw new Error('Expected formatter mode "write" or "check".')
	return mode
}

export function normalizeSource(source: string): string {
	const normalized = source
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replace(/[\t ]+$/gm, "")
		.replace(/\n*$/, "")
	return `${normalized}\n`
}
