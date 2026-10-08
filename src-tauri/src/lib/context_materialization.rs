#[tauri::command]
async fn materialize_context_files(
	root_folder: String,
	relative_paths: Vec<String>,
	paths_only: bool,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<MaterializeContextResult, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		materialize_context_files_blocking(
			root_folder,
			relative_paths,
			paths_only,
		)
	})
	.await
	.map_err(|error| format!("Context update was interrupted: {error}"))?
}

fn resolve_context_removal_paths_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<Vec<ContextRemovalPath>, String> {
	if paths.len() > CONTEXT_MAX_REQUEST_PATHS ||
		context_path_payload_too_large(&paths) ||
		root_folder.len() > CONTEXT_MAX_PATH_BYTES ||
		paths.iter().any(|path| path.is_empty() || path.len() > CONTEXT_MAX_PATH_BYTES || path.contains('\0'))
	{
		return Err("The removal selection contains too many paths or an invalid path.".to_string());
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("The configured folder no longer exists.".to_string());
	}

	let mut canonical_paths = paths
		.into_iter()
		.map(|path| canonicalize_existing(Path::new(&path)))
		.collect::<Result<Vec<_>, _>>()?;

	canonical_paths.sort();
	canonical_paths.dedup();

	let mut resolved = Vec::with_capacity(canonical_paths.len());

	for path in canonical_paths {
		ensure_inside_root(
			&root,
			&path,
		)?;

		let metadata = fs::metadata(&path)
			.map_err(|error| format!("Could not read {}: {error}", path.display()))?;

		if !metadata.is_file() && !metadata.is_dir() {
			return Err(format!(
				"Item {} is neither a file nor a supported folder.",
				path.display(),
			));
		}

		resolved.push(ContextRemovalPath {
			relative_path: relative_path(
				&root,
				&path,
			)?,
			is_directory: metadata.is_dir(),
		});
	}

	Ok(resolved)
}

#[tauri::command]
async fn resolve_context_removal_paths(
	root_folder: String,
	paths: Vec<String>,
	undo_state: State<'_, overlay::OverlayUndoState>,
) -> Result<Vec<ContextRemovalPath>, String> {
	let _read_guard = undo_state.begin_project_read(&root_folder)?;
	tauri::async_runtime::spawn_blocking(move || {
		resolve_context_removal_paths_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("Path validation was interrupted: {error}"))?
}


#[derive(Default)]
struct ContextTreeNode {
	files: Vec<ContextTreeFile>,
	directories: BTreeMap<String, ContextTreeNode>,
}

struct ContextTreeFile {
	name: String,
	content: Option<String>,
}

struct ContextProtocol {
	header: &'static str,
	label: &'static str,
	work_mode_files: &'static str,
	files_patch_instruction: &'static str,
	work_mode_git: &'static str,
	git_patch_instruction: &'static str,
	git_patch_safety: &'static str,
	root_description: &'static str,
	folder_description: &'static str,
	back_description: &'static str,
	file_description: &'static str,
	content_description: &'static str,
	path_only_description: &'static str,
	redaction_description: &'static str,
	delete_manifest_description: &'static str,
	delete_manifest_format: &'static str,
	delete_manifest_paths: &'static str,
	delete_manifest_permanent: &'static str,
	delete_manifest_optional: &'static str,
	root: &'static str,
	folder: &'static str,
	back: &'static str,
	file: &'static str,
	content_start: &'static str,
	content_end: &'static str,
	end: &'static str,
}

fn context_protocol(locale: &str) -> Result<ContextProtocol, String> {
	match locale {
		"pt-BR" => Ok(ContextProtocol {
			header: "===== ORQETO DEV: CONTEXTO =====",
			label: "PROTOCOLO:",
			work_mode_files: "- MODO DE TRABALHO: ARQUIVOS.",
			files_patch_instruction: "- Ao propor alterações, entregue arquivos completos preservando os paths relativos à RAIZ. Para múltiplos arquivos, prefira um ZIP incremental contendo somente arquivos novos/alterados. Não gere .patch ou .diff.",
			work_mode_git: "- MODO DE TRABALHO: GIT.",
			git_patch_instruction: "- Ao propor alterações, entregue um único arquivo textual .patch ou .diff no formato Git unified diff compatível com git apply. Use somente paths relativos à RAIZ e / como separador.",
			git_patch_safety: "- Baseie cada hunk exclusivamente no conteúdo atual fornecido. Não use uma versão anterior, presumida ou memorizada do arquivo. O patch deve aplicar limpo e não deve conter binários, symlinks, submodules, operações Git de copy ou alterações de modo/permissão. Não dependa de --3way nem de tolerância de whitespace.",
			root_description: "- RAIZ representa a pasta selecionada no aplicativo.",
			folder_description: "- PASTA entra no caminho informado a partir da pasta atual.",
			back_description: "- VOLTAR retorna ao contexto de pasta anterior.",
			file_description: "- ARQUIVO pertence à pasta atual. O nome pode incluir subpastas quando esse ramo foi condensado.",
			content_description: "- Somente o texto entre INÍCIO DO CONTEÚDO e FIM DO CONTEÚDO pertence ao arquivo.",
			path_only_description: "- Quando um ARQUIVO não tiver delimitadores de conteúdo em seguida, ele representa somente o path do arquivo; não infira conteúdo ausente.",
			redaction_description: "- O conteúdo pode conter [REDACTED] aplicado automaticamente pelo Orqeto Dev a valores sensíveis. Em arquivos .env e variantes, valores não vazios são ocultados. Nunca tente inferir ou reconstruir um segredo redigido.",
			delete_manifest_description: "- Se a implementação remover ou renomear arquivos ou pastas existentes, inclua na raiz do ZIP/pasta do patch o arquivo reservado .orqeto-dev-delete.json.",
			delete_manifest_format: "- Formato exato: {\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/arquivo-antigo.ts\",\"src/pasta-antiga\"]}",
			delete_manifest_paths: "- delete contém somente paths relativos à RAIZ, usando /, de arquivos ou pastas existentes. Para remover uma pasta inteira, liste a pasta uma vez; não enumere os filhos. Não use paths absolutos, ./, .. ou barras invertidas.",
			delete_manifest_permanent: "- deletePermanent (opcional) aceita SOMENTE pastas geradas/recriáveis, como src-tauri/target ou node_modules; a IA propõe e o usuário confirma. Esses diretórios NÃO ficam no storage, histórico recuperável ou Desfazer. NUNCA marque código fonte, packages/lib com código, configurações, .env ou segredos como permanentes. delete e deletePermanent não podem sobrepor paths; liste os caminhos-fonte normais separadamente. As duas etapas podem resultar em aplicação parcial.",
			delete_manifest_optional: "- Omita .orqeto-dev-delete.json quando não houver exclusões. Esse arquivo é metadado de controle do patch e nunca deve virar arquivo do projeto.",
			root: "RAIZ",
			folder: "PASTA",
			back: "VOLTAR",
			file: "ARQUIVO",
			content_start: "INÍCIO DO CONTEÚDO",
			content_end: "FIM DO CONTEÚDO",
			end: "===== FIM DO ORQETO DEV: CONTEXTO =====",
		}),
		"en" => Ok(ContextProtocol {
			header: "===== ORQETO DEV: CONTEXT =====",
			label: "PROTOCOL:",
			work_mode_files: "- WORK MODE: FILES.",
			files_patch_instruction: "- When proposing changes, deliver complete files while preserving ROOT-relative paths. For multiple files, prefer an incremental ZIP containing only new/changed files. Do not generate .patch or .diff.",
			work_mode_git: "- WORK MODE: GIT.",
			git_patch_instruction: "- When proposing changes, deliver one textual .patch or .diff file as a Git unified diff compatible with git apply. Use only ROOT-relative paths and / as the separator.",
			git_patch_safety: "- Base every hunk exclusively on the current content provided. Do not use an older, assumed, or remembered version of the file. The patch must apply cleanly and must not contain binaries, symlinks, submodules, Git copy operations, or file mode/permission changes. Do not depend on --3way or whitespace tolerance.",
			root_description: "- ROOT represents the folder selected in the application.",
			folder_description: "- FOLDER enters the given path relative to the current folder.",
			back_description: "- BACK returns to the previous folder context.",
			file_description: "- FILE belongs to the current folder. Its name may include subfolders when that branch was condensed.",
			content_description: "- Only text between CONTENT START and CONTENT END belongs to the file.",
			path_only_description: "- When a FILE is not followed by content delimiters, it represents only that file path; do not infer missing content.",
			redaction_description: "- Content may contain [REDACTED] automatically applied by Orqeto Dev to sensitive values. In .env files and variants, non-empty values are hidden. Never infer or reconstruct a redacted secret.",
			delete_manifest_description: "- If the implementation removes or renames existing files or folders, include the reserved .orqeto-dev-delete.json file at the root of the patch ZIP/folder.",
			delete_manifest_format: "- Exact format: {\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/old-file.ts\",\"src/old-folder\"]}",
			delete_manifest_paths: "- delete contains only ROOT-relative paths using / for existing files or folders. To remove a whole folder, list the folder once instead of enumerating its children. Do not use absolute paths, ./, .., or backslashes.",
			delete_manifest_permanent: "- Optional deletePermanent accepts ONLY generated/rebuildable folders such as src-tauri/target or node_modules; AI proposes and the user confirms. Those folders are NOT retained in internal storage, recoverable history or Undo. NEVER mark source code, source packages/lib, configuration, .env or secrets for permanent deletion. delete and deletePermanent cannot overlap; enumerate normal source paths separately. The two stages may leave a partial Apply if either fails.",
			delete_manifest_optional: "- Omit .orqeto-dev-delete.json when there are no deletions. This file is patch control metadata and must never become a project file.",
			root: "ROOT",
			folder: "FOLDER",
			back: "BACK",
			file: "FILE",
			content_start: "CONTENT START",
			content_end: "CONTENT END",
			end: "===== END OF ORQETO DEV: CONTEXT =====",
		}),
		_ => Err("The requested context language is invalid.".to_string()),
	}
}

fn context_path_parts(relative_path: &str) -> Vec<&str> {
	relative_path
		.trim_start_matches("./")
		.split(|character| character == '/' || character == '\\')
		.filter(|part| !part.is_empty())
		.collect()
}

fn insert_context_tree_file(root: &mut ContextTreeNode, file: GeneratedFile) {
	let parts = context_path_parts(&file.relative_path);
	let Some(file_name) = parts.last() else {
		return;
	};
	let mut current = root;
	for directory in &parts[..parts.len().saturating_sub(1)] {
		current = current.directories.entry((*directory).to_string()).or_default();
	}
	current.files.push(ContextTreeFile {
		name: (*file_name).to_string(),
		content: file.content,
	});
}

fn compressed_context_directory(
	name: String,
	mut node: ContextTreeNode,
) -> (String, ContextTreeNode) {
	let mut path = name;
	while node.files.is_empty() && node.directories.len() == 1 {
		let Some((next_name, next_node)) = node.directories.pop_first() else {
			break;
		};
		path.push('/');
		path.push_str(&next_name);
		node = next_node;
	}
	(path, node)
}

fn format_context_file(
	name: &str,
	content: Option<String>,
	protocol: &ContextProtocol,
) -> String {
	let marker = format!("===== {}: {} =====", protocol.file, name);
	let Some(mut content) = content else {
		return marker;
	};
	if !content.ends_with('\n') {
		content.push('\n');
	}
	format!(
		"{marker}\n===== {} =====\n{content}===== {} =====",
		protocol.content_start,
		protocol.content_end,
	)
}
