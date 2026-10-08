import type {
	GitCommitContextData,
	ProjectDiagnosticCapabilities,
	ProjectDiagnosticContextData,
	ProjectDiagnosticKind,
	ProjectLintFixResult,
	ProjectValidationCommandKind,
	ProjectValidationCommandResult,
} from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export const generateGitCommitContext = (rootFolder: string) => invoke<GitCommitContextData>(
	"generate_git_commit_context",
	{ rootFolder },
)
export const getProjectDiagnosticCapabilities = (rootFolder: string) => invoke<ProjectDiagnosticCapabilities>(
	"get_project_diagnostic_capabilities",
	{ rootFolder },
)
export async function approveProjectDiagnostics(rootFolder: string): Promise<void> {
	await invoke(
		"approve_project_diagnostics",
		{ rootFolder },
	)
}
export async function approveProjectValidationCommand(rootFolder: string, kind: ProjectValidationCommandKind, expectedCommand: string): Promise<void> {
	await invoke(
		"approve_project_validation_command",
		{ rootFolder, kind, expectedCommand },
	)
}
export const generateProjectDiagnosticContext = (
	rootFolder: string,
	kind: ProjectDiagnosticKind,
	fileLimit: number,
) => invoke<ProjectDiagnosticContextData>(
	"generate_project_diagnostic_context",
	{ rootFolder, kind, fileLimit },
)
export const runProjectValidationCommand = (
	rootFolder: string,
	kind: ProjectValidationCommandKind,
	operationId: string,
) => invoke<ProjectValidationCommandResult>(
	"run_project_validation_command",
	{ rootFolder, kind, operationId },
)
export const fixProjectEslint = (
	rootFolder: string,
	operationId: string,
) => invoke<ProjectLintFixResult>(
	"fix_project_eslint",
	{ rootFolder, operationId },
)
export const cancelProjectValidationOperation = (
	rootFolder: string,
	kind: ProjectValidationCommandKind,
	operationId: string,
) => invoke<boolean>(
	"cancel_project_validation_operation",
	{ rootFolder, kind, operationId },
)
