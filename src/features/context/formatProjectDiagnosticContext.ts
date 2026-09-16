import { formatGeneratedContent } from "./formatGeneratedContent"
import type {
	AppNotice,
	GeneratedFile,
	ProjectDiagnosticContextData,
	WorkMode,
} from "./types"
import {
	type Locale,
	translate,
	translateCount,
} from "@/infra/i18n"

function escapeDiagnosticMessage(message: string): string {
	return message
		.replaceAll("`", "\\`")
		.replace(/\s*\r?\n\s*/g, " ")
}

function getDiagnosticTitle(
	data: ProjectDiagnosticContextData,
	locale: Locale,
): string {
	return translate(
		locale,
		data.kind === "typecheck" ?
			"diagnostics.typecheck.title" :
			"diagnostics.eslint.title",
	)
}

function getDiagnosticSummaryLabel(locale: Locale): string {
	return translate(
		locale,
		"diagnostics.issues",
	)
}

function getMessageSeverityLabel(
	severity: "error" | "warning",
	locale: Locale,
): string {
	return translate(
		locale,
		severity === "error" ?
			"diagnostics.error" :
			"diagnostics.warning",
	)
}

function getDiagnosticFindingSummary(
	data: ProjectDiagnosticContextData,
	locale: Locale,
): string {
	const findings: string[] = []

	if (data.errorCount > 0) {
		findings.push(translateCount(
			locale,
			data.errorCount,
			"diagnostics.errorCount.one",
			"diagnostics.errorCount.other",
		))
	}

	if (data.warningCount > 0) {
		findings.push(translateCount(
			locale,
			data.warningCount,
			"diagnostics.warningCount.one",
			"diagnostics.warningCount.other",
		))
	}

	return findings.join(" · ")
}

export function createProjectDiagnosticNotice(
	data: ProjectDiagnosticContextData,
	locale: Locale,
): AppNotice {
	if (data.issueCount === 0) {
		return {
			kind: "success",
			message: translate(
				locale,
				"workspace.diagnosticContextClean",
			),
		}
	}

	const affectedFiles = translateCount(
		locale,
		data.totalFilesWithIssues,
		"diagnostics.affectedFiles.one",
		"diagnostics.affectedFiles.other",
	)
	const includedFiles = data.selectedFileCount === 0 ?
		translate(
			locale,
			"diagnostics.contextFiles.none",
		) :
		translateCount(
			locale,
			data.selectedFileCount,
			"diagnostics.contextFiles.one",
			"diagnostics.contextFiles.other",
		)

	return {
		kind: "warning",
		message: translateCount(
			locale,
			data.issueCount,
			"workspace.diagnosticContextIssuesFound.one",
			"workspace.diagnosticContextIssuesFound.other",
			{
				findings: getDiagnosticFindingSummary(
					data,
					locale,
				),
				affectedFiles,
				includedFiles,
			},
		),
	}
}

export function formatProjectDiagnosticContext(
	data: ProjectDiagnosticContextData,
	locale: Locale,
	workMode: WorkMode,
): string {
	if (data.issueCount === 0) {
		return [
			`# ${getDiagnosticTitle(
				data,
				locale,
			)}`,
			"",
			translate(
				locale,
				"workspace.diagnosticContextClean",
			),
			"",
		].join("\n")
	}

	const diagnosticSummaryLabel = getDiagnosticSummaryLabel(locale)
	const blocks = [
		`# ${getDiagnosticTitle(
			data,
			locale,
		)}`,
		"",
		`${translate(
			locale,
			"diagnostics.errors",
		)}: ${data.errorCount}`,
		`${translate(
			locale,
			"diagnostics.warnings",
		)}: ${data.warningCount}`,
		`${translate(
			locale,
			"diagnostics.filesWithIssues",
		)}: ${data.totalFilesWithIssues}`,
		`${translate(
			locale,
			"diagnostics.selectedFiles",
		)}: ${data.selectedFileCount}`,
		"",
	]

	if (data.files.length > 0) {
		blocks.push(
			`## ${diagnosticSummaryLabel}`,
			"",
		)

		for (const file of data.files) {
			blocks.push(
				`### ${file.relativePath}`,
				"",
			)

			for (const message of file.messages) {
				const location = message.line === null ?
					"?" :
					`${message.line}:${message.column ?? "?"}`
				blocks.push(`- **${getMessageSeverityLabel(
					message.severity,
					locale,
				)}** \`${location}\` \`${message.code}\` — ${escapeDiagnosticMessage(message.message)}`)
			}

			blocks.push("")
		}
	}

	if (data.globalMessages.length > 0) {
		blocks.push(
			`### ${translate(
				locale,
				"diagnostics.global",
			)}`,
			"",
		)

		for (const message of data.globalMessages) {
			blocks.push(`- **${getMessageSeverityLabel(
				message.severity,
				locale,
			)}** \`${message.code}\` — ${escapeDiagnosticMessage(message.message)}`)
		}

		blocks.push("")
	}

	const generatedFiles: GeneratedFile[] = data.files.map(file => ({
		relativePath: file.relativePath,
		content: file.content,
	}))

	if (generatedFiles.length > 0) {
		blocks.push(formatGeneratedContent(
			generatedFiles,
			locale,
			workMode,
		))
	}

	return blocks.join("\n")
}
