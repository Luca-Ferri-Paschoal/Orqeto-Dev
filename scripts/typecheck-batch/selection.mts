import type { TypeScriptDiagnostic } from "./model.mts"

export type FileDiagnostic = TypeScriptDiagnostic & {
	filePath: string
}

export function splitDiagnostics(diagnostics: readonly TypeScriptDiagnostic[]): {
	fileDiagnostics: FileDiagnostic[]
	globalDiagnostics: TypeScriptDiagnostic[]
} {
	return {
		fileDiagnostics: diagnostics.filter((diagnostic): diagnostic is FileDiagnostic => diagnostic.filePath !== null),
		globalDiagnostics: diagnostics.filter(diagnostic => diagnostic.filePath === null),
	}
}

export function getSelectedFiles(
	diagnostics: readonly FileDiagnostic[],
	fileLimit: number,
): string[] {
	const files: string[] = []
	const seen = new Set<string>()

	for (const diagnostic of diagnostics) {
		if (seen.has(diagnostic.filePath))
			continue

		seen.add(diagnostic.filePath)
		files.push(diagnostic.filePath)

		if (files.length >= fileLimit)
			break
	}

	return files
}
