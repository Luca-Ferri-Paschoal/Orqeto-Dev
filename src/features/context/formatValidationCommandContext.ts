import type {
	ProjectLintFixResult,
	ProjectValidationCommandKind,
	ProjectValidationCommandResult,
} from "./types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

function normalizeOutput(value: string): string {
	const normalized = value
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replace(/\n+$/, "")

	return normalized.length === 0 ?
		"(empty)" :
		normalized
}

function validationTitle(
	kind: ProjectValidationCommandKind,
	locale: Locale,
): string {
	return translate(
		locale,
		kind === "lintfix" ?
			"diagnostics.lintFix.title" :
			"diagnostics.test.title",
	)
}

export function formatProjectValidationCommandContext(
	result: ProjectValidationCommandResult,
	locale: Locale,
): string {
	return [
		`# ${validationTitle(
			result.kind,
			locale,
		)}`,
		"",
		`${translate(
			locale,
			"diagnostics.command.source",
		)}: ${translate(
			locale,
			"diagnostics.command.sourceProject",
		)}`,
		`${translate(
			locale,
			"diagnostics.command.command",
		)}: ${result.command}`,
		`${translate(
			locale,
			"diagnostics.command.exitCode",
		)}: ${result.exitCode ?? "?"}`,
		`${translate(
			locale,
			"diagnostics.command.duration",
		)}: ${result.durationMs} ms`,
		`${translate(
			locale,
			"diagnostics.command.status",
		)}: ${translate(
			locale,
			result.success ?
				"diagnostics.command.success" :
				"diagnostics.command.completedWithIssues",
		)}`,
		"",
		`===== ${translate(
			locale,
			"diagnostics.command.stdout",
		)} =====`,
		normalizeOutput(result.stdout),
		`===== ${translate(
			locale,
			"diagnostics.command.stdoutEnd",
		)} =====`,
		"",
		`===== ${translate(
			locale,
			"diagnostics.command.stderr",
		)} =====`,
		normalizeOutput(result.stderr),
		`===== ${translate(
			locale,
			"diagnostics.command.stderrEnd",
		)} =====`,
		"",
	].join("\n")
}

export function formatFallbackLintFixContext(
	result: ProjectLintFixResult,
	locale: Locale,
): string {
	return [
		`# ${translate(
			locale,
			"diagnostics.lintFix.title",
		)}`,
		"",
		`${translate(
			locale,
			"diagnostics.command.source",
		)}: ${translate(
			locale,
			"diagnostics.command.sourceFallback",
		)}`,
		`${translate(
			locale,
			"diagnostics.lintFix.changedFiles",
		)}: ${result.changedFileCount}`,
		`${translate(
			locale,
			"diagnostics.lintFix.remainingIssues",
		)}: ${result.remainingIssueCount}`,
		`${translate(
			locale,
			"diagnostics.errors",
		)}: ${result.remainingErrorCount}`,
		`${translate(
			locale,
			"diagnostics.warnings",
		)}: ${result.remainingWarningCount}`,
		`${translate(
			locale,
			"diagnostics.filesWithIssues",
		)}: ${result.remainingFilesWithIssues}`,
		"",
	].join("\n")
}
