import type {
	GitCommitContextData,
	WorkMode,
} from "./types"
import type { Locale } from "@/infra/i18n"

function getEmptyLabel(locale: Locale): string {
	return locale === "pt-BR" ?
		"(nenhuma alteração)" :
		"(no changes)"
}

function getOmittedUntrackedLabel(
	locale: Locale,
	sizeBytes: number,
): string {
	const formattedSize = new Intl.NumberFormat(locale).format(sizeBytes)

	return locale === "pt-BR" ?
		`[conteúdo não incluído: arquivo binário, não textual ou maior que 256 KiB · ${formattedSize} bytes]` :
		`[content not included: binary, non-text, or larger than 256 KiB · ${formattedSize} bytes]`
}

function formatUntrackedFiles(
	data: GitCommitContextData,
	locale: Locale,
): string {
	if (data.untrackedFiles.length === 0)
		return getEmptyLabel(locale)

	return data.untrackedFiles
		.map(file => {
			const heading = locale === "pt-BR" ?
				`===== ARQUIVO NÃO RASTREADO: ${file.relativePath} =====` :
				`===== UNTRACKED FILE: ${file.relativePath} =====`
			const content = file.content ?? getOmittedUntrackedLabel(
				locale,
				file.sizeBytes,
			)

			return `${heading}\n${content}`
		})
		.join("\n\n")
}

export function formatGitCommitContext(
	data: GitCommitContextData,
	locale: Locale,
	workMode: WorkMode,
): string {
	const emptyLabel = getEmptyLabel(locale)
	const status = data.status.length > 0 ?
		data.status :
		emptyLabel
	const stagedDiff = data.stagedDiff.length > 0 ?
		data.stagedDiff :
		emptyLabel
	const unstagedDiff = data.unstagedDiff.length > 0 ?
		data.unstagedDiff :
		emptyLabel
	const untrackedFiles = formatUntrackedFiles(
		data,
		locale,
	)

	if (locale === "pt-BR") {
		const deliveryInstruction = workMode === "git" ?
			"- Se sugerir correções adicionais, baseie cada hunk exclusivamente no estado atual mostrado neste relatório/contexto e entregue um único arquivo textual UTF-8 .patch ou .diff em Git unified diff compatível com git apply, usando paths relativos à RAIZ do Orqeto Dev. Não use versão anterior presumida, binários, symlinks, submodules, operações Git de copy ou alterações de modo/permissão." :
			"- Se sugerir correções adicionais, entregue arquivos completos preservando os paths relativos; para múltiplos arquivos, prefira um ZIP incremental do Orqeto Dev. Para exclusões/renomes use .orqeto-dev-delete.json e não use Git diff/patch."

		return [
			"===== ORQETO DEV: CONTEXTO DE COMMIT =====",
			"INSTRUÇÕES PARA A IA:",
			"- Analise somente as alterações Git apresentadas neste relatório.",
			"- Gere uma mensagem de commit clara e objetiva que resuma o propósito das mudanças.",
			"- Prefira Conventional Commits (feat:, fix:, docs:, refactor:, chore:, etc.) quando fizer sentido.",
			"- Não invente alterações que não estejam representadas abaixo.",
			"- Se houver mudanças sem relação entre si, avise antes de sugerir a mensagem de commit.",
			"- Ao final, entregue um título de commit e, se necessário, um corpo curto explicativo.",
			deliveryInstruction,
			`REPOSITÓRIO: ${data.repositoryName}`,
			`BRANCH: ${data.branch}`,
			"",
			"===== STATUS GIT =====",
			status,
			"",
			"===== DIFF STAGED =====",
			stagedDiff,
			"",
			"===== DIFF NÃO STAGED =====",
			unstagedDiff,
			"",
			"===== ARQUIVOS NÃO RASTREADOS =====",
			untrackedFiles,
			"",
			"===== FIM DO ORQETO DEV: CONTEXTO DE COMMIT =====",
		].join("\n")
	}

	const deliveryInstruction = workMode === "git" ?
		"- If you suggest additional fixes, base every hunk exclusively on the current state shown in this report/context and deliver one textual UTF-8 .patch or .diff file as a Git unified diff compatible with git apply, using paths relative to the Orqeto Dev ROOT. Do not use an assumed older version, binaries, symlinks, submodules, Git copy operations, or file mode/permission changes." :
		"- If you suggest additional fixes, deliver complete files preserving relative paths; for multiple files, prefer an incremental Orqeto Dev ZIP. Use .orqeto-dev-delete.json for deletions/renames and do not use Git diff/patch."

	return [
		"===== ORQETO DEV: COMMIT CONTEXT =====",
		"INSTRUCTIONS FOR THE AI:",
		"- Analyze only the Git changes presented in this report.",
		"- Generate a clear, concise commit message that summarizes the purpose of the changes.",
		"- Prefer Conventional Commits (feat:, fix:, docs:, refactor:, chore:, etc.) when appropriate.",
		"- Do not invent changes that are not represented below.",
		"- If unrelated changes are mixed together, say so before suggesting the commit message.",
		"- Finish with a commit title and, when useful, a short explanatory body.",
		deliveryInstruction,
		`REPOSITORY: ${data.repositoryName}`,
		`BRANCH: ${data.branch}`,
		"",
		"===== GIT STATUS =====",
		status,
		"",
		"===== STAGED DIFF =====",
		stagedDiff,
		"",
		"===== UNSTAGED DIFF =====",
		unstagedDiff,
		"",
		"===== UNTRACKED FILES =====",
		untrackedFiles,
		"",
		"===== END OF ORQETO DEV: COMMIT CONTEXT =====",
	].join("\n")
}
