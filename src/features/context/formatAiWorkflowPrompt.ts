import type { WorkMode } from "./types"
import type { Locale } from "@/infra/i18n"

function validationIntegrationRules(locale: Locale): string[] {
	if (locale === "pt-BR") {
		return [
			"- O Orqeto Dev pode descobrir comandos opcionais do projeto pelo `package.json`, em `orqetoDev.validation`: `lintFix` aponta para o comando exato de correção de lint/formatação e `test` aponta para o comando exato de testes.",
			"- Não adicione nem altere `orqetoDev.validation` apenas porque essa integração existe; preserve a configuração atual quando ela não fizer parte do pedido.",
			"- Somente quando eu pedir testes explicitamente e a solução realmente incluir testes que o Orqeto Dev deva poder executar, adicione ou ajuste `orqetoDev.validation.test` para o comando real do projeto (por exemplo, `npm test`). Não invente testes, não introduza um framework de testes só para preencher essa chave e não acrescente essa integração quando testes não forem solicitados.",
			"- Quando a tarefa pedir integração de correção de lint/formatação, `orqetoDev.validation.lintFix` pode ser adicionado ou ajustado para o comando exato correspondente do projeto.",
		]
	}

	return [
		"- Orqeto Dev can discover optional project commands from `package.json` under `orqetoDev.validation`: `lintFix` points to the exact lint/format-fix command and `test` points to the exact test command.",
		"- Do not add or change `orqetoDev.validation` merely because this integration exists; preserve the current configuration when it is outside the request.",
		"- Only when I explicitly request tests and the solution actually includes tests that Orqeto Dev should be able to run, add or update `orqetoDev.validation.test` to the project's real command (for example, `npm test`). Do not invent tests, do not introduce a test framework just to populate this key, and do not add this integration when tests were not requested.",
		"- When the task requests lint/format-fix integration, `orqetoDev.validation.lintFix` may be added or updated to the project's exact corresponding command.",
	]
}

function redactionRules(locale: Locale): string[] {
	if (locale === "pt-BR") {
		return [
			"- O Orqeto Dev aplica redação automática antes de enviar conteúdo para IA: arquivos `.env` e variantes ocultam todos os valores não vazios, enquanto outros textos usam chaves sensíveis, credenciais em URLs e padrões de segredo de alta confiança.",
			"- Quando o contexto contiver `[REDACTED]`, trate esse marcador como intencional. Nunca tente inferir, reconstruir, completar ou substituir o segredo original.",
			"- Arquivos cujo conteúdo fornecido contenha valores redigidos ou material sensível são somente informativos. Não crie, edite, substitua, renomeie nem exclua esses arquivos no artefato entregue; omita-os do ZIP/.patch e explique que a alteração precisa ser feita localmente pelo usuário sem expor a chave.",
			"- O Apply do Orqeto Dev também protege arquivos com chaves/segredos detectados. Se um artefato tentar alterá-los, esses arquivos serão bloqueados em Modo Arquivos e o patch inteiro será recusado em Modo Git.",
		]
	}

	return [
		"- Orqeto Dev automatically redacts sensitive values before sending content to AI: `.env` files and variants hide every non-empty value, while other text uses sensitive keys, URL credentials, and high-confidence secret patterns.",
		"- When the context contains `[REDACTED]`, treat that marker as intentional. Never infer, reconstruct, complete, or replace the original secret.",
		"- Files whose supplied content contains redacted values or sensitive material are informational only. Do not create, edit, replace, rename, or delete those files in the delivered artifact; omit them from the ZIP/.patch and explain that the user must make that change locally without exposing the key.",
		"- Orqeto Dev Apply also protects files with detected keys/secrets. If an artifact tries to change them, those files are blocked in Files Mode and the whole patch is rejected in Git Mode.",
	]
}

function filesDeletionRules(locale: Locale): string[] {
	if (locale === "pt-BR") {
		return [
			"- Para excluir ou renomear arquivos ou pastas existentes, use `.orqeto-dev-delete.json` na raiz do ZIP/pasta do patch, com `format: \"orqeto-dev-delete\"`, `version: 1` e `delete` contendo paths relativos à RAIZ.",
			"- Cada item de `delete` pode ser um arquivo ou uma pasta existente. Para remover uma pasta inteira, informe somente o path da pasta; não enumere todos os filhos. O Orqeto Dev expande a árvore com as mesmas proteções de path e ignore.",
			"- O manifesto de exclusão aceita no máximo 10.000 entradas e 256 KiB. Não use paths absolutos, `./`, `..`, barras invertidas, symlinks/junctions nem alvos protegidos por `.orqeto-devignore`.",
			"- Para excluir permanentemente SOMENTE pastas de artefatos gerados/recriáveis, use a chave opcional `deletePermanent` no mesmo manifesto, por exemplo `\"deletePermanent\":[\"src-tauri/target\",\"node_modules\"]`. A IA propõe os caminhos, mas o Orqeto só permite nomes de pastas geradas reconhecidos e solicita confirmação explícita ao usuário.",
			"- IMPORTANTE: `deletePermanent` não cria snapshot, cópia de segurança, recuperação nem Desfazer para esses diretórios. É irreversível. Use somente para build/cache/dependências geradas e verificáveis; NUNCA para `src`, bibliotecas-fonte, `packages`, `lib`, configurações, dados pessoais, `.env` ou arquivos com chaves/segredos.",
			"- `delete` e `deletePermanent` não podem ter caminhos iguais, ancestrais ou descendentes uns dos outros. Para excluir `src-tauri/target` permanentemente e o restante de `src-tauri` com Undo, enumere os caminhos-fonte normais separadamente em `delete` (não liste `src-tauri` inteiro). O Orqeto executa as duas etapas separadamente; uma falha pode deixar aplicação parcial.",
			"- Omita `.orqeto-dev-delete.json` quando não houver exclusões; ele é metadado do patch e nunca deve virar arquivo do projeto.",
		]
	}

	return [
		"- To delete or rename existing files or folders, use `.orqeto-dev-delete.json` at the root of the patch ZIP/folder, with `format: \"orqeto-dev-delete\"`, `version: 1`, and ROOT-relative paths in `delete`.",
		"- Each `delete` item may name an existing file or folder. To remove a whole folder, list only the folder path; do not enumerate every child. Orqeto Dev expands the tree under the same path and ignore protections.",
		"- The deletion manifest accepts at most 10,000 entries and 256 KiB. Do not use absolute paths, `./`, `..`, backslashes, symlinks/junctions, or targets protected by `.orqeto-devignore`.",
		"- For irreversible deletion of generated/rebuildable folders ONLY, use the optional `deletePermanent` array in that manifest, for example `\"deletePermanent\":[\"src-tauri/target\",\"node_modules\"]`. AI proposes the paths, but Orqeto accepts only recognized generated-folder names and asks the user to confirm explicitly.",
		"- IMPORTANT: `deletePermanent` creates NO backup, recoverable history, snapshot or Undo for those folders. It is irreversible. Use it only for verifiable build/cache/generated dependencies, NEVER for `src`, source libraries, `packages`, `lib`, configuration, personal data, `.env` or files with keys/secrets.",
		"- `delete` and `deletePermanent` may not contain identical, ancestor or descendant paths. To permanently delete `src-tauri/target` and remove the rest of `src-tauri` with Undo, enumerate normal source paths separately under `delete` (do NOT list the whole `src-tauri` folder). Orqeto runs these as separate steps; failures can leave a partial Apply.",
		"- Omit `.orqeto-dev-delete.json` when there are no deletions; it is patch metadata and must never become a project file.",
	]
}

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
				...redactionRules(locale),
				...validationIntegrationRules(locale),
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
			...filesDeletionRules(locale),
			"- Não gere .patch ou .diff para aplicação no Modo Arquivos.",
			"- Não inclua arquivos não relacionados à tarefa e não altere paths por conveniência.",
			"- Se o contexto for insuficiente para produzir arquivos completos com segurança, peça os arquivos atuais necessários em vez de adivinhar.",
			...redactionRules(locale),
			...validationIntegrationRules(locale),
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
			...redactionRules(locale),
			...validationIntegrationRules(locale),
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
		...filesDeletionRules(locale),
		"- Do not generate .patch or .diff files for application in Files Mode.",
		"- Do not include files unrelated to the task and do not change paths for convenience.",
		"- If the context is insufficient to safely produce complete files, ask for the required current files instead of guessing.",
		...redactionRules(locale),
		...validationIntegrationRules(locale),
		"- Briefly explain what changed and deliver the files/ZIP as the applicable artifact.",
		"",
		"Orqeto Dev will resolve destinations from the paths and project structure, asking for confirmation whenever the destination is ambiguous.",
	].join("\n")
}
