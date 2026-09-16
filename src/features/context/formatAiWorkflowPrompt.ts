import type { WorkMode } from "./types"
import type { Locale } from "@/infra/i18n"

export function formatAiWorkflowPrompt(
	locale: Locale,
	workMode: WorkMode,
): string {
	if (locale === "pt-BR") {
		if (workMode === "git") {
			return [
				"Você está trabalhando em um projeto mantido com o Orqeto Dev no Modo Git.",
				"",
				"Regras de trabalho:",
				"- Trate o contexto enviado pelo Orqeto Dev como a fonte atual do código para a tarefa.",
				"- Baseie cada alteração no conteúdo atual fornecido. Não reutilize uma versão antiga, presumida ou lembrada do arquivo.",
				"- Quando eu pedir alterações de código, entregue um único arquivo textual UTF-8 com extensão .patch ou .diff, no formato Git unified diff compatível com `git apply`.",
				"- Use paths relativos à RAIZ informada pelo contexto e `/` como separador.",
				"- O patch deve representar somente as mudanças necessárias e aplicar de forma limpa ao conteúdo atual.",
				"- Não dependa de `--3way`, tolerância de whitespace ou qualquer aplicação forçada.",
				"- Não inclua patches binários, symlinks, submodules, operações Git de copy ou mudanças de modo/permissão.",
				"- Não execute nem proponha como parte do patch `git add`, `commit`, `reset`, `checkout`, `restore` ou `clean`.",
				"- Se o contexto for insuficiente para produzir um patch seguro, peça os arquivos ou trechos atuais necessários em vez de adivinhar.",
				"- Explique brevemente o que foi alterado, mas mantenha o arquivo .patch/.diff como o artefato aplicável.",
				"",
				"O Orqeto Dev validará o patch contra o estado atual do projeto, exibirá uma prévia e o aplicará apenas se a validação estrita passar.",
			].join("\n")
		}

		return [
			"Você está trabalhando em um projeto mantido com o Orqeto Dev no Modo Arquivos.",
			"",
			"Regras de trabalho:",
			"- Trate o contexto enviado pelo Orqeto Dev como a fonte atual do código para a tarefa.",
			"- Baseie cada alteração no conteúdo atual fornecido. Não reutilize uma versão antiga, presumida ou lembrada do arquivo.",
			"- Quando eu pedir alterações, entregue os arquivos completos que foram criados ou modificados, preservando exatamente os paths relativos à RAIZ informada no contexto.",
			"- Para múltiplos arquivos, prefira um ZIP incremental contendo somente arquivos novos ou alterados e preservando a estrutura relativa.",
			"- Para exclusões ou renomes de arquivos existentes, use o manifesto `.orqeto-dev-delete.json` no formato definido pelo contexto do Orqeto Dev.",
			"- Não gere .patch ou .diff para aplicação no Modo Arquivos.",
			"- Não inclua arquivos não relacionados à tarefa e não altere paths por conveniência.",
			"- Se o contexto for insuficiente para produzir arquivos completos com segurança, peça os arquivos atuais necessários em vez de adivinhar.",
			"- Explique brevemente o que foi alterado e entregue os arquivos/ZIP como artefato aplicável.",
			"",
			"O Orqeto Dev resolverá os destinos com base nos paths e na estrutura do projeto, pedindo confirmação sempre que houver ambiguidade.",
		].join("\n")
	}

	if (workMode === "git") {
		return [
			"You are working on a project maintained with Orqeto Dev in Git Mode.",
			"",
			"Working rules:",
			"- Treat the context sent by Orqeto Dev as the current source of code for the task.",
			"- Base every change on the current content provided. Do not reuse an older, assumed, or remembered version of a file.",
			"- When I request code changes, deliver one textual UTF-8 file with a .patch or .diff extension, using Git unified diff format compatible with `git apply`.",
			"- Use paths relative to the ROOT declared by the context and `/` as the path separator.",
			"- The patch must contain only the required changes and apply cleanly to the current content.",
			"- Do not depend on `--3way`, whitespace tolerance, or any forced application behavior.",
			"- Do not include binary patches, symlinks, submodules, Git copy operations, or file mode/permission changes.",
			"- Do not run or make `git add`, `commit`, `reset`, `checkout`, `restore`, or `clean` part of the patch workflow.",
			"- If the context is insufficient to produce a safe patch, ask for the required current files or sections instead of guessing.",
			"- Briefly explain what changed, while keeping the .patch/.diff file as the applicable artifact.",
			"",
			"Orqeto Dev will validate the patch against the project's current state, show a preview, and apply it only when strict validation succeeds.",
		].join("\n")
	}

	return [
		"You are working on a project maintained with Orqeto Dev in Files Mode.",
		"",
		"Working rules:",
		"- Treat the context sent by Orqeto Dev as the current source of code for the task.",
		"- Base every change on the current content provided. Do not reuse an older, assumed, or remembered version of a file.",
		"- When I request changes, deliver the complete files that were created or modified, preserving exactly the ROOT-relative paths declared by the context.",
		"- For multiple files, prefer an incremental ZIP containing only new or changed files while preserving the relative directory structure.",
		"- For deletions or renames of existing files, use `.orqeto-dev-delete.json` in the format defined by the Orqeto Dev context.",
		"- Do not generate .patch or .diff files for application in Files Mode.",
		"- Do not include files unrelated to the task and do not change paths for convenience.",
		"- If the context is insufficient to safely produce complete files, ask for the required current files instead of guessing.",
		"- Briefly explain what changed and deliver the files/ZIP as the applicable artifact.",
		"",
		"Orqeto Dev will resolve destinations from the paths and project structure, asking for confirmation whenever the destination is ambiguous.",
	].join("\n")
}
