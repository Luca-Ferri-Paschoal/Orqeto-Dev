import {
	FORMAT_SETTINGS,
	normalizeSource,
	rootDirectory,
} from "./config.mts"
import { applyEdits } from "./edits.mts"
import path from "node:path"
import ts from "typescript"

export function formatWithTypeScript(
	fileName: string,
	source: string,
): string {
	const absoluteFileName = path.resolve(fileName)
	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => ({ allowJs: false, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext }),
		getCurrentDirectory: () => rootDirectory,
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
		getScriptFileNames: () => [absoluteFileName],
		getScriptSnapshot: requestedFileName => {
			if (path.resolve(requestedFileName) === absoluteFileName)
				return ts.ScriptSnapshot.fromString(source)
			const librarySource = ts.sys.readFile(requestedFileName)
			return librarySource === undefined ?
				undefined :
				ts.ScriptSnapshot.fromString(librarySource)
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
		return normalizeSource(applyEdits(
			source,
			languageService.getFormattingEditsForDocument(
				absoluteFileName,
				FORMAT_SETTINGS,
			),
		))
	} finally {
		languageService.dispose()
	}
}
