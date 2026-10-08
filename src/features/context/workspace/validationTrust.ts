import type {
	ProjectDiagnosticKind,
	ProjectValidationCommandKind,
} from "../../../domain/contextContracts.ts"

export interface ValidationTrustCommand {
	kind: ProjectValidationCommandKind
	command: string
}

export function createValidationCommandTrustKey(
	rootFolder: string,
	command: string,
	kind: ProjectValidationCommandKind | null = null,
): string {
	return kind === null ?
		`${rootFolder}\n${command}` :
		`${rootFolder}\n${kind}\n${command}`
}

export function hasValidationExecutionTrust(
	rootFolder: string,
	customValidation: ValidationTrustCommand | null,
	trustedRoots: ReadonlySet<string>,
	trustedCommands: ReadonlySet<string>,
	diagnosticKind: ProjectDiagnosticKind | "lintfix" | null = null,
): boolean {
	if (customValidation === null) {
		return trustedRoots.has(diagnosticKind === null ?
			rootFolder :
			`${rootFolder}\n${diagnosticKind}`)
	}

	return trustedCommands.has(createValidationCommandTrustKey(
		rootFolder,
		customValidation.command,
		customValidation.kind,
	))
}

export function recordValidationExecutionTrust(
	rootFolder: string,
	customValidation: ValidationTrustCommand | null,
	trustedRoots: Set<string>,
	trustedCommands: Set<string>,
	diagnosticKind: ProjectDiagnosticKind | "lintfix" | null = null,
): void {
	trustedRoots.add(rootFolder)

	if (customValidation === null) {
		if (diagnosticKind !== null)
			trustedRoots.add(`${rootFolder}\n${diagnosticKind}`)
		return
	}

	trustedCommands.add(createValidationCommandTrustKey(
		rootFolder,
		customValidation.command,
		customValidation.kind,
	))
}
