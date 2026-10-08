import type {
	GitCommitComparisonData,
	GitCommitSummary,
} from "../../domain/gitCommitComparison.js"
import type { Locale } from "../../domain/locale.js"

function formatDate(locale: Locale, value: string): string {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ?
		value :
		date.toLocaleString(locale, {
			dateStyle: "medium",
			timeStyle: "medium",
		})
}

function describeCommit(locale: Locale, label: string, commit: GitCommitSummary): string[] {
	const authorLabel = locale === "pt-BR" ?
		"Autor" :
		"Author"
	const dateLabel = locale === "pt-BR" ?
		"Data e horário" :
		"Date and time"
	const subjectLabel = locale === "pt-BR" ?
		"Mensagem" :
		"Message"
	return [
		label,
		`Hash: ${commit.hash}`,
		`${subjectLabel}: ${commit.subject}`,
		`${authorLabel}: ${commit.author}`,
		`${dateLabel}: ${formatDate(
			locale,
			commit.authoredAt,
		)}`,
	]
}

export function formatGitCommitComparison(locale: Locale, result: GitCommitComparisonData): string {
	const isPt = locale === "pt-BR"
	const lines = [
		isPt ?
			"===== ORQETO DEV: COMPARAÇÃO DE COMMITS =====" :
			"===== ORQETO DEV: COMMIT COMPARISON =====",
		isPt ?
			"Contexto de leitura: não aplicar este diff automaticamente." :
			"Read-only context: do not apply this diff automatically.",
		`${isPt ?
			"Projeto" :
			"Project"}: ${result.repositoryName}`,
		"",
		...describeCommit(
			locale,
			isPt ?
				"COMMIT INICIAL" :
				"INITIAL COMMIT",
			result.initial,
		),
		"",
		...describeCommit(
			locale,
			isPt ?
				"COMMIT FINAL" :
				"FINAL COMMIT",
			result.finalCommit,
		),
		"",
		`${isPt ?
			"Arquivos alterados" :
			"Changed files"}: ${result.fileCount}`,
		`${isPt ?
			"Linhas adicionadas" :
			"Added lines"}: ${result.addedLines}`,
		`${isPt ?
			"Linhas removidas" :
			"Deleted lines"}: ${result.deletedLines}`,
		isPt ?
			"Observação: arquivos binários não têm contagem de linhas." :
			"Note: binary files have no line counts.",
		"",
		"===== GIT DIFF =====",
		result.diff.length === 0 ?
			(isPt ?
				"Nenhuma diferença entre as versões." :
				"No differences between the versions.") :
			result.diff,
		"",
		isPt ?
			"===== FIM DA COMPARAÇÃO =====" :
			"===== END OF COMPARISON =====",
	]
	return `${lines.join("\n")}\n`
}
