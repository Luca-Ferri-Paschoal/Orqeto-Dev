use crate::project_ignore::ProjectIgnore;
use serde::{Deserialize, Serialize};
use std::{
	collections::{HashMap, HashSet},
	fs::{self, File, OpenOptions},
	io::{Read, Write},
	path::{Component, Path, PathBuf},
	sync::Mutex,
	time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use zip::ZipArchive;

const MAX_ZIP_ENTRIES: usize = 50_000;
const MAX_ZIP_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_PROJECT_SCAN_DIRECTORIES: usize = 100_000;
const MAX_AMBIGUOUS_DESTINATIONS: usize = 10;
const MAX_SOURCE_CONTEXT_SEGMENTS: usize = 8;
const ZIP_SOURCE_PREFIX_PENALTY_PER_SEGMENT: usize = 12;
const FINGERPRINT_BUFFER_SIZE: usize = 64 * 1024;
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;
const DELETE_MANIFEST_FILE_NAME: &str = ".orqeto-dev-delete.json";
const DELETE_MANIFEST_FORMAT: &str = "orqeto-dev-delete";
const DELETE_MANIFEST_VERSION: u32 = 1;
const MAX_DELETE_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_DELETE_MANIFEST_PATHS: usize = 10_000;
const MIN_UNDO_HISTORY_ENTRIES: usize = 1;
const MAX_UNDO_HISTORY_ENTRIES: usize = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayDestinationCandidate {
	destination_relative_path: String,
	source_prefix: String,
	matched_files: usize,
	matched_directories: usize,
	source_context_matches: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareProjectOverlayResult {
	file_count: usize,
	delete_count: usize,
	candidates: Vec<OverlayDestinationCandidate>,
	recommended_candidate_index: Option<usize>,
	candidate_count: usize,
	ambiguity_limit: usize,
	ambiguity_limit_exceeded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProjectOverlayResult {
	added_files: usize,
	replaced_files: usize,
	deleted_files: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoProjectOverlayResult {
	restored_files: usize,
	removed_files: usize,
	undone_batches: usize,
	remaining_history_entries: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayUndoHistoryEntry {
	steps: usize,
	added_files: usize,
	replaced_files: usize,
	deleted_files: usize,
	applied_at_unix_ms: u64,
}

struct ManifestFile {
	relative_path: PathBuf,
	source: ManifestFileSource,
}

enum ManifestFileSource {
	Directory(PathBuf),
	Zip(usize),
}

enum ManifestKind {
	Directory {
		source_root: PathBuf,
		source_context: Vec<String>,
		source_components: Vec<String>,
		source_name: String,
	},
	File {
		source_file: PathBuf,
		source_context: Vec<String>,
		source_components: Vec<String>,
		source_name: String,
	},
	Zip {
		archive_path: PathBuf,
	},
}

struct OverlayManifest {
	kind: ManifestKind,
	files: Vec<ManifestFile>,
	delete_paths: Vec<PathBuf>,
	common_directory_prefixes: Vec<PathBuf>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteManifestDocument {
	format: String,
	version: u32,
	delete: Vec<String>,
}

#[derive(Clone)]
struct CandidatePlan {
	candidate: OverlayDestinationCandidate,
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	score: usize,
	mapping_key: Vec<String>,
	is_named_destination: bool,
}

struct PlannedFile {
	destination_relative_path: PathBuf,
	source_index: usize,
	was_replaced: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileFingerprint {
	size: u64,
	hash: u64,
}

#[derive(Clone)]
enum UndoFileKind {
	Created,
	Replaced {
		backup_path: PathBuf,
	},
}

#[derive(Clone)]
struct UndoFile {
	destination_relative_path: PathBuf,
	kind: UndoFileKind,
	applied_fingerprint: Option<FileFingerprint>,
}

#[derive(Clone)]
struct UndoSnapshot {
	root: PathBuf,
	backup_directories: Vec<PathBuf>,
	files: Vec<UndoFile>,
	created_directories: Vec<PathBuf>,
	applied_at_unix_ms: u64,
}

pub struct OverlayUndoState {
	histories: Mutex<HashMap<PathBuf, Vec<UndoSnapshot>>>,
}

impl OverlayUndoState {
	pub fn new() -> Self {
		cleanup_stale_snapshots();

		Self {
			histories: Mutex::new(HashMap::new()),
		}
	}
}

impl Drop for OverlayUndoState {
	fn drop(&mut self) {
		let Ok(histories) = self.histories.get_mut() else {
			return;
		};

		for history in histories.values_mut() {
			for snapshot in history.drain(..) {
				discard_snapshot(snapshot);
			}
		}

		histories.clear();
	}
}

fn cleanup_stale_snapshots() {
	let base = std::env::temp_dir().join("orqeto-dev");
	let Ok(entries) = fs::read_dir(&base) else {
		return;
	};

	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().to_string();

		if name.starts_with("undo-") {
			let _ = fs::remove_dir_all(entry.path());
		}
	}
}

fn current_unix_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
		.unwrap_or(0)
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
	fs::canonicalize(path)
		.map_err(|error| format!("Não foi possível acessar {}: {error}", path.display()))
}

fn ensure_overlay_source_separate(
	root: &Path,
	source: &Path,
) -> Result<(), String> {
	if source.starts_with(root) || root.starts_with(source) {
		return Err(
			"A fonte usada para aplicação precisa estar fora da pasta configurada.".to_string(),
		);
	}

	Ok(())
}

fn normalize_relative_display(path: &Path) -> String {
	if path.as_os_str().is_empty() {
		return "./".to_string();
	}

	format!("./{}", path.to_string_lossy().replace('\\', "/"))
}

fn normalize_source_prefix(path: &Path) -> String {
	path.to_string_lossy().replace('\\', "/")
}

fn root_lookup_key(path: &Path) -> String {
	let normalized = path
		.to_string_lossy()
		.replace('\\', "/")
		.trim_end_matches('/')
		.to_string();

	#[cfg(target_os = "windows")]
	{
		let normalized = if let Some(value) = normalized.strip_prefix("//?/UNC/") {
			format!("//{value}")
		} else if let Some(value) = normalized.strip_prefix("//?/") {
			value.to_string()
		} else {
			normalized
		};

		return normalized.to_lowercase();
	}

	#[cfg(not(target_os = "windows"))]
	{
		normalized
	}
}

fn parse_relative_path(value: &str) -> Result<PathBuf, String> {
	let normalized = value
		.strip_prefix("./")
		.unwrap_or(value);
	let path = PathBuf::from(normalized);

	for component in path.components() {
		if !matches!(component, Component::Normal(_)) {
			return Err(format!("O caminho relativo {value} não é válido."));
		}
	}

	Ok(path)
}

fn parse_delete_manifest_content(
	root: &Path,
	content: &str,
) -> Result<Vec<PathBuf>, String> {
	let document = serde_json::from_str::<DeleteManifestDocument>(content)
		.map_err(|error| format!("O arquivo {DELETE_MANIFEST_FILE_NAME} não possui JSON válido: {error}"))?;

	if document.format != DELETE_MANIFEST_FORMAT || document.version != DELETE_MANIFEST_VERSION {
		return Err(format!(
			"O arquivo {DELETE_MANIFEST_FILE_NAME} não possui a identificação de formato esperada.",
		));
	}

	if document.delete.len() > MAX_DELETE_MANIFEST_PATHS {
		return Err(format!(
			"O arquivo {DELETE_MANIFEST_FILE_NAME} possui mais de {MAX_DELETE_MANIFEST_PATHS} caminhos e foi recusado.",
		));
	}

	let mut seen = HashSet::new();
	let mut paths = Vec::with_capacity(document.delete.len());

	for value in document.delete {
		let has_invalid_segment = value
			.split('/')
			.any(|segment| segment.is_empty() || segment == "." || segment == "..");

		if value.is_empty() || value.trim() != value || value.contains('\\') || has_invalid_segment {
			return Err(format!(
				"O arquivo {DELETE_MANIFEST_FILE_NAME} contém um caminho fora do formato esperado: {value}.",
			));
		}

		let relative_path = parse_relative_path(&value)?;

		if relative_path.as_os_str().is_empty() {
			return Err(format!(
				"O arquivo {DELETE_MANIFEST_FILE_NAME} contém um caminho vazio.",
			));
		}

		let normalized = value.to_lowercase();

		if !seen.insert(normalized) {
			return Err(format!(
				"O arquivo {DELETE_MANIFEST_FILE_NAME} repete o caminho {value}.",
			));
		}

		let exists = validate_destination_entry(
			root,
			&relative_path,
			false,
		)?;

		if !exists {
			return Err(format!(
				"O arquivo indicado para exclusão não existe no projeto: {value}.",
			));
		}

		let absolute = canonicalize_existing(&root.join(&relative_path))?;

		if !absolute.starts_with(root) || !absolute.is_file() {
			return Err(format!(
				"O caminho indicado para exclusão não é um arquivo seguro dentro do projeto: {value}.",
			));
		}

		paths.push(relative_path);
	}

	Ok(paths)
}

fn read_delete_manifest_file(
	root: &Path,
	path: &Path,
) -> Result<Vec<PathBuf>, String> {
	let metadata = fs::metadata(path)
		.map_err(|error| format!("Não foi possível ler {DELETE_MANIFEST_FILE_NAME}: {error}"))?;

	if metadata.len() > MAX_DELETE_MANIFEST_BYTES {
		return Err(format!(
			"O arquivo {DELETE_MANIFEST_FILE_NAME} ultrapassa {} KB e foi recusado.",
			MAX_DELETE_MANIFEST_BYTES / 1024,
		));
	}

	let content = fs::read_to_string(path)
		.map_err(|error| format!("Não foi possível ler {DELETE_MANIFEST_FILE_NAME} como UTF-8: {error}"))?;

	parse_delete_manifest_content(
		root,
		&content,
	)
}

fn normalize_zip_entry_path(path: &Path) -> Result<PathBuf, String> {
	let mut normalized = PathBuf::new();

	for component in path.components() {
		match component {
			Component::Normal(value) => normalized.push(value),
			Component::CurDir => {}
			Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
				return Err(format!(
					"O caminho {} não é válido dentro do ZIP.",
					path.display(),
				));
			}
		}
	}

	Ok(normalized)
}

fn validate_destination_entry(
	root: &Path,
	relative_path: &Path,
	is_directory: bool,
) -> Result<bool, String> {
	let mut current = root.to_path_buf();
	let mut components = relative_path.components().peekable();

	while let Some(component) = components.next() {
		let Component::Normal(name) = component else {
			return Err(format!(
				"O caminho {} não é válido para aplicação.",
				relative_path.display(),
			));
		};

		current.push(name);
		let is_last = components.peek().is_none();

		match fs::symlink_metadata(&current) {
			Ok(metadata) => {
				if metadata.file_type().is_symlink() {
					return Err(format!(
						"O destino {} usa um link simbólico ou junction e não pode ser sobrescrito.",
						current.display(),
					));
				}

				if is_last {
					if is_directory {
						if !metadata.is_dir() {
							return Err(format!(
								"O destino {} já existe como arquivo.",
								current.display(),
							));
						}

						return Ok(false);
					}

					if metadata.is_dir() {
						return Err(format!(
							"O destino {} já existe como pasta.",
							current.display(),
						));
					}

					return Ok(true);
				}

				if !metadata.is_dir() {
					return Err(format!(
						"O caminho {} bloqueia a criação da estrutura do patch.",
						current.display(),
					));
				}
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
			Err(error) => {
				return Err(format!(
					"Não foi possível validar o destino {}: {error}",
					current.display(),
				));
			}
		}
	}

	Ok(false)
}

fn collect_directory_manifest_files(
	source_root: &Path,
	current: &Path,
	files: &mut Vec<ManifestFile>,
) -> Result<(), String> {
	let canonical_path = canonicalize_existing(current)?;

	if !canonical_path.starts_with(source_root) {
		return Err(format!(
			"O item {} aponta para fora da pasta usada como fonte.",
			current.display(),
		));
	}

	let metadata = fs::symlink_metadata(current)
		.map_err(|error| format!("Não foi possível ler {}: {error}", current.display()))?;

	if metadata.file_type().is_symlink() {
		return Err(format!(
			"O item {} é um link simbólico ou junction e não pode ser aplicado.",
			current.display(),
		));
	}

	if metadata.is_file() {
		let relative_path = canonical_path
			.strip_prefix(source_root)
			.map_err(|_| "Não foi possível calcular o caminho relativo do patch.".to_string())?
			.to_path_buf();

		files.push(ManifestFile {
			relative_path,
			source: ManifestFileSource::Directory(canonical_path),
		});
		return Ok(());
	}

	if !metadata.is_dir() {
		return Err(format!(
			"O item {} não é um arquivo nem uma pasta suportada.",
			current.display(),
		));
	}

	let mut entries = fs::read_dir(current)
		.map_err(|error| format!("Não foi possível listar {}: {error}", current.display()))?
		.map(|entry| {
			entry
				.map(|value| value.path())
				.map_err(|error| format!("Não foi possível ler uma entrada da pasta: {error}"))
		})
		.collect::<Result<Vec<_>, _>>()?;

	entries.sort();

	for entry in entries {
		collect_directory_manifest_files(
			source_root,
			&entry,
			files,
		)?;
	}

	Ok(())
}

fn path_segments(path: &Path) -> Vec<String> {
	path.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_lowercase()),
			_ => None,
		})
		.collect()
}

fn normal_components(path: &Path) -> Vec<std::ffi::OsString> {
	path.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_os_string()),
			_ => None,
		})
		.collect()
}

fn common_directory_prefixes(files: &[ManifestFile]) -> Vec<PathBuf> {
	let Some(first_file) = files.first() else {
		return Vec::new();
	};
	let first_parent = first_file
		.relative_path
		.parent()
		.unwrap_or_else(|| Path::new(""));
	let common = normal_components(first_parent);
	let mut common_length = common.len();

	for file in &files[1..] {
		let parent = file
			.relative_path
			.parent()
			.unwrap_or_else(|| Path::new(""));
		let segments = normal_components(parent);
		let shared_length = common
			.iter()
			.take(common_length)
			.zip(segments.iter())
			.take_while(|(left, right)| {
				left
					.to_string_lossy()
					.eq_ignore_ascii_case(&right.to_string_lossy())
			})
			.count();

		common_length = shared_length;

		if common_length == 0 {
			break;
		}
	}

	let mut prefixes = Vec::new();
	let mut current = PathBuf::new();

	for segment in common.into_iter().take(common_length) {
		current.push(segment);
		prefixes.push(current.clone());
	}

	prefixes
}

fn build_directory_manifest(
	root: &Path,
	source_path: &Path,
) -> Result<OverlayManifest, String> {
	let source = canonicalize_existing(source_path)?;
	ensure_overlay_source_separate(
		root,
		&source,
	)?;

	let metadata = fs::symlink_metadata(source_path)
		.map_err(|error| format!("Não foi possível ler {}: {error}", source_path.display()))?;

	if metadata.file_type().is_symlink() {
		return Err("Links simbólicos e junctions não podem ser usados como fonte.".to_string());
	}

	if !metadata.is_dir() {
		return Err("A fonte selecionada não é uma pasta.".to_string());
	}

	let mut files = Vec::new();
	collect_directory_manifest_files(
		&source,
		&source,
		&mut files,
	)?;
	let mut delete_paths = Vec::new();
	let mut patch_files = Vec::with_capacity(files.len());

	for file in files {
		let is_delete_manifest = file
			.relative_path
			.file_name()
			.is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME));

		if !is_delete_manifest {
			patch_files.push(file);
			continue;
		}

		if normal_components(&file.relative_path).len() != 1 {
			return Err(format!(
				"O arquivo reservado {DELETE_MANIFEST_FILE_NAME} precisa ficar na raiz da pasta aplicada.",
			));
		}

		let ManifestFileSource::Directory(manifest_path) = &file.source else {
			return Err("O manifesto de exclusão foi interpretado com um tipo inválido.".to_string());
		};

		delete_paths = read_delete_manifest_file(
			root,
			manifest_path,
		)?;
	}

	let mut files = patch_files;
	files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

	let source_name = source
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.ok_or_else(|| "Não foi possível determinar o nome da pasta aplicada.".to_string())?;
	let source_components = source
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_string()),
			_ => None,
		})
		.collect::<Vec<_>>();
	let source_context = source_components
		.iter()
		.map(|component| component.to_lowercase())
		.collect::<Vec<_>>();

	Ok(OverlayManifest {
		kind: ManifestKind::Directory {
			source_root: source,
			source_context,
			source_components,
			source_name,
		},
		delete_paths,
		common_directory_prefixes: Vec::new(),
		files,
	})
}

fn build_file_manifest(
	root: &Path,
	source_path: &Path,
) -> Result<OverlayManifest, String> {
	let source = canonicalize_existing(source_path)?;
	ensure_overlay_source_separate(
		root,
		&source,
	)?;

	let metadata = fs::symlink_metadata(source_path)
		.map_err(|error| format!("Não foi possível ler {}: {error}", source_path.display()))?;

	if metadata.file_type().is_symlink() {
		return Err("Links simbólicos e junctions não podem ser usados como fonte.".to_string());
	}

	if !metadata.is_file() {
		return Err("A fonte selecionada não é um arquivo.".to_string());
	}

	let source_name = source
		.file_name()
		.map(|value| value.to_string_lossy().to_string())
		.ok_or_else(|| "Não foi possível determinar o nome do arquivo aplicado.".to_string())?;

	if source_name.eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME) {
		let delete_paths = read_delete_manifest_file(
			root,
			&source,
		)?;

		return Ok(OverlayManifest {
			kind: ManifestKind::File {
				source_file: source,
				source_context: Vec::new(),
				source_components: Vec::new(),
				source_name,
			},
			delete_paths,
			common_directory_prefixes: Vec::new(),
			files: Vec::new(),
		});
	}
	let source_components = source
		.parent()
		.unwrap_or_else(|| Path::new(""))
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => Some(value.to_string_lossy().to_string()),
			_ => None,
		})
		.collect::<Vec<_>>();
	let source_context = source_components
		.iter()
		.map(|component| component.to_lowercase())
		.collect::<Vec<_>>();
	let relative_path = PathBuf::from(&source_name);

	Ok(OverlayManifest {
		kind: ManifestKind::File {
			source_file: source.clone(),
			source_context,
			source_components,
			source_name,
		},
		delete_paths: Vec::new(),
		common_directory_prefixes: Vec::new(),
		files: vec![ManifestFile {
			relative_path,
			source: ManifestFileSource::Directory(source),
		}],
	})
}

fn find_virtual_zip_source(path: &Path) -> Option<(PathBuf, PathBuf)> {
	let mut current = path.parent();

	while let Some(candidate) = current {
		let is_zip = candidate
			.extension()
			.and_then(|extension| extension.to_str())
			.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

		if is_zip && candidate.is_file() {
			let internal_path = path
				.strip_prefix(candidate)
				.ok()?
				.to_path_buf();

			if !internal_path.as_os_str().is_empty() {
				return Some((
					candidate.to_path_buf(),
					internal_path,
				));
			}
		}

		current = candidate.parent();
	}

	None
}

fn path_starts_with_case_insensitive(
	path: &Path,
	prefix: &Path,
) -> bool {
	let path_values = path_segments(path);
	let prefix_values = path_segments(prefix);

	!prefix_values.is_empty() &&
		prefix_values.len() <= path_values.len() &&
		path_values[..prefix_values.len()] == prefix_values
}

fn path_ends_with_case_insensitive(
	path: &Path,
	suffix: &Path,
) -> bool {
	let path_values = path_segments(path);
	let suffix_values = path_segments(suffix);

	if suffix_values.is_empty() || suffix_values.len() > path_values.len() {
		return false;
	}

	path_values[path_values.len() - suffix_values.len()..] == suffix_values
}

fn zip_selection_candidates(files: &[ManifestFile]) -> Vec<PathBuf> {
	let mut values = HashSet::<PathBuf>::new();

	for file in files {
		values.insert(file.relative_path.clone());

		let mut current = file.relative_path.parent();

		while let Some(parent) = current {
			if parent.as_os_str().is_empty() {
				break;
			}

			values.insert(parent.to_path_buf());
			current = parent.parent();
		}
	}

	let mut sorted = values.into_iter().collect::<Vec<_>>();
	sorted.sort();
	sorted
}

fn resolve_zip_selection_prefix(
	files: &[ManifestFile],
	requested_prefix: &Path,
) -> Result<PathBuf, String> {
	let normalized = normalize_zip_entry_path(requested_prefix)?;

	if normalized.as_os_str().is_empty() {
		return Err("A subpasta selecionada dentro do ZIP não possui um caminho válido.".to_string());
	}

	let has_exact_match = files.iter().any(|file| path_starts_with_case_insensitive(
		&file.relative_path,
		&normalized,
	));

	if has_exact_match {
		return Ok(normalized);
	}

	let suffix_matches = zip_selection_candidates(files)
		.into_iter()
		.filter(|candidate| path_ends_with_case_insensitive(
			candidate,
			&normalized,
		))
		.collect::<Vec<_>>();

	match suffix_matches.as_slice() {
		[only] => Ok(only.clone()),
		[] => Err(format!(
			"A subpasta {} não foi encontrada dentro do ZIP.",
			requested_prefix.display(),
		)),
		_ => Err(format!(
			"A subpasta {} corresponde a mais de um caminho dentro do ZIP. Selecione um nível mais específico.",
			requested_prefix.display(),
		)),
	}
}

fn build_zip_manifest(
	root: &Path,
	archive_path: &Path,
	selected_internal_path: Option<&Path>,
) -> Result<OverlayManifest, String> {
	let archive_canonical = canonicalize_existing(archive_path)?;

	if archive_canonical.starts_with(root) {
		return Err("O arquivo ZIP usado como fonte precisa estar fora da pasta configurada.".to_string());
	}

	let archive_file = File::open(&archive_canonical)
		.map_err(|error| format!("Não foi possível abrir {}: {error}", archive_canonical.display()))?;
	let mut archive = ZipArchive::new(archive_file)
		.map_err(|error| format!("O arquivo {} não é um ZIP válido: {error}", archive_canonical.display()))?;

	if archive.len() > MAX_ZIP_ENTRIES {
		return Err(format!(
			"O ZIP possui mais de {MAX_ZIP_ENTRIES} entradas e foi recusado.",
		));
	}

	let mut total_uncompressed_bytes = 0_u64;
	let mut seen_paths = HashSet::new();
	let mut file_paths = HashSet::new();
	let mut files = Vec::new();
	let mut delete_paths = Vec::new();

	for index in 0..archive.len() {
		let mut entry = archive
			.by_index(index)
			.map_err(|error| format!("Não foi possível ler uma entrada do ZIP: {error}"))?;
		let enclosed_path = entry
			.enclosed_name()
			.ok_or_else(|| format!("O ZIP contém um caminho inseguro: {}", entry.name()))?;
		let relative_path = normalize_zip_entry_path(&enclosed_path)?;

		if relative_path.as_os_str().is_empty() {
			if entry.is_dir() {
				continue;
			}

			return Err(format!(
				"O ZIP contém uma entrada sem caminho válido: {}",
				entry.name(),
			));
		}

		let normalized_path = relative_path
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if seen_paths.contains(&normalized_path) {
			return Err(format!(
				"O ZIP contém o mesmo caminho mais de uma vez: {}",
				entry.name(),
			));
		}

		if entry.encrypted() {
			return Err(format!(
				"O ZIP contém uma entrada criptografada e não pode ser aplicado: {}",
				entry.name(),
			));
		}

		if entry.is_symlink() {
			return Err(format!(
				"O ZIP contém um link simbólico e não pode ser aplicado: {}",
				entry.name(),
			));
		}

		let mut ancestor = normalized_path.as_str();

		while let Some(separator_index) = ancestor.rfind('/') {
			ancestor = &ancestor[..separator_index];

			if file_paths.contains(ancestor) {
				return Err(format!(
					"O ZIP contém uma estrutura conflitante em {}.",
					entry.name(),
				));
			}
		}

		if entry.is_file() {
			let descendant_prefix = format!("{normalized_path}/");

			if seen_paths
				.iter()
				.any(|path: &String| path.starts_with(&descendant_prefix))
			{
				return Err(format!(
					"O ZIP contém uma estrutura conflitante em {}.",
					entry.name(),
				));
			}
		}

		seen_paths.insert(normalized_path.clone());

		if entry.is_file() {
			file_paths.insert(normalized_path);
		}

		if entry.is_dir() {
			continue;
		}

		if !entry.is_file() {
			return Err(format!(
				"O ZIP contém uma entrada não suportada: {}",
				entry.name(),
			));
		}

		let is_delete_manifest = relative_path
			.file_name()
			.is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(DELETE_MANIFEST_FILE_NAME));

		if is_delete_manifest {
			if normal_components(&relative_path).len() != 1 {
				return Err(format!(
					"O arquivo reservado {DELETE_MANIFEST_FILE_NAME} precisa ficar na raiz do ZIP.",
				));
			}

			if selected_internal_path.is_none() {
				if entry.size() > MAX_DELETE_MANIFEST_BYTES {
					return Err(format!(
						"O arquivo {DELETE_MANIFEST_FILE_NAME} ultrapassa {} KB e foi recusado.",
						MAX_DELETE_MANIFEST_BYTES / 1024,
					));
				}

				let mut content = String::new();
				entry
					.read_to_string(&mut content)
					.map_err(|error| format!("Não foi possível ler {DELETE_MANIFEST_FILE_NAME} como UTF-8: {error}"))?;
				delete_paths = parse_delete_manifest_content(
					root,
					&content,
				)?;
			}

			continue;
		}

		total_uncompressed_bytes = total_uncompressed_bytes
			.checked_add(entry.size())
			.ok_or_else(|| "O tamanho descompactado do ZIP é inválido.".to_string())?;

		if total_uncompressed_bytes > MAX_ZIP_UNCOMPRESSED_BYTES {
			return Err("O ZIP ultrapassa 1 GB descompactado e foi recusado.".to_string());
		}

		files.push(ManifestFile {
			relative_path,
			source: ManifestFileSource::Zip(index),
		});
	}

	files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

	if let Some(selected_internal_path) = selected_internal_path {
		let selected_prefix = resolve_zip_selection_prefix(
			&files,
			selected_internal_path,
		)?;

		files.retain(|file| path_starts_with_case_insensitive(
			&file.relative_path,
			&selected_prefix,
		));

		if files.is_empty() {
			return Err(format!(
				"A seleção {} dentro do ZIP não contém arquivos para aplicar.",
				selected_internal_path.display(),
			));
		}
	}

	let prefixes = common_directory_prefixes(&files);

	Ok(OverlayManifest {
		kind: ManifestKind::Zip {
			archive_path: archive_canonical,
		},
		delete_paths,
		common_directory_prefixes: prefixes,
		files,
	})
}

fn build_manifest(
	root_folder: &str,
	paths: &[String],
) -> Result<(PathBuf, OverlayManifest), String> {
	if paths.len() != 1 {
		return Err("Cada item da aplicação precisa ser analisado separadamente.".to_string());
	}

	let root = canonicalize_existing(Path::new(root_folder))?;

	if !root.is_dir() {
		return Err("A pasta configurada não existe mais.".to_string());
	}

	let source_path = PathBuf::from(&paths[0]);

	if let Some((archive_path, internal_path)) = find_virtual_zip_source(&source_path) {
		return Ok((
			root.clone(),
			build_zip_manifest(
				&root,
				&archive_path,
				Some(&internal_path),
			)?,
		));
	}

	let metadata = fs::symlink_metadata(&source_path)
		.map_err(|error| format!("Não foi possível ler {}: {error}", source_path.display()))?;

	if metadata.file_type().is_symlink() {
		return Err("Links simbólicos e junctions não podem ser usados como fonte.".to_string());
	}

	if metadata.is_dir() {
		return Ok((
			root.clone(),
			build_directory_manifest(
				&root,
				&source_path,
			)?,
		));
	}

	if !metadata.is_file() {
		return Err("A área de aplicação aceita somente arquivos, pastas ou ZIPs.".to_string());
	}

	let is_zip = source_path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

	if is_zip {
		return Ok((
			root.clone(),
			build_zip_manifest(
				&root,
				&source_path,
				None,
			)?,
		));
	}

	Ok((
		root.clone(),
		build_file_manifest(
			&root,
			&source_path,
		)?,
	))
}

fn collect_project_directories_by_name(
	root: &Path,
	target_names: &HashSet<String>,
	project_ignore: &ProjectIgnore,
) -> Result<HashMap<String, Vec<PathBuf>>, String> {
	let mut matches = HashMap::<String, Vec<PathBuf>>::new();
	let mut pending = vec![root.to_path_buf()];
	let mut scanned = 0_usize;

	while let Some(directory) = pending.pop() {
		if scanned >= MAX_PROJECT_SCAN_DIRECTORIES {
			break;
		}

		scanned += 1;
		let entries = match fs::read_dir(&directory) {
			Ok(entries) => entries,
			Err(error) if directory == root => {
				return Err(format!(
					"Não foi possível analisar {}: {error}",
					directory.display(),
				));
			}
			Err(_) => continue,
		};

		for entry in entries {
			let Ok(entry) = entry else {
				continue;
			};
			let path = entry.path();
			let Ok(metadata) = fs::symlink_metadata(&path) else {
				continue;
			};

			if metadata.file_type().is_symlink() || !metadata.is_dir() {
				continue;
			}

			if project_ignore.is_ignored(
				&path,
				true,
			) {
				continue;
			}

			let name = entry.file_name().to_string_lossy().to_string();
			let normalized_name = name.to_lowercase();

			if target_names.contains(&normalized_name) {
				let relative = path
					.strip_prefix(root)
					.map_err(|_| "Não foi possível calcular um destino relativo do projeto.".to_string())?
					.to_path_buf();

				matches
					.entry(normalized_name)
					.or_default()
					.push(relative);
			}

			pending.push(path);
		}
	}

	for paths in matches.values_mut() {
		paths.sort();
	}

	Ok(matches)
}

fn collect_project_files_by_name(
	root: &Path,
	target_name: &str,
	project_ignore: &ProjectIgnore,
) -> Result<Vec<PathBuf>, String> {
	let mut matches = Vec::new();
	let mut pending = vec![root.to_path_buf()];
	let mut scanned = 0_usize;

	while let Some(directory) = pending.pop() {
		if scanned >= MAX_PROJECT_SCAN_DIRECTORIES {
			break;
		}

		scanned += 1;
		let entries = match fs::read_dir(&directory) {
			Ok(entries) => entries,
			Err(error) if directory == root => {
				return Err(format!(
					"Não foi possível analisar {}: {error}",
					directory.display(),
				));
			}
			Err(_) => continue,
		};

		for entry in entries.flatten() {
			let path = entry.path();
			let Ok(metadata) = fs::symlink_metadata(&path) else {
				continue;
			};

			if metadata.file_type().is_symlink() {
				continue;
			}

			if metadata.is_dir() {
				if !project_ignore.is_ignored(
					&path,
					true,
				) {
					pending.push(path);
				}

				continue;
			}

			if !metadata.is_file() || project_ignore.is_ignored(
				&path,
				false,
			) {
				continue;
			}

			let matches_name = entry
				.file_name()
				.to_string_lossy()
				.eq_ignore_ascii_case(target_name);

			if !matches_name {
				continue;
			}

			let relative = path
				.strip_prefix(root)
				.map_err(|_| "Não foi possível calcular um arquivo relativo do projeto.".to_string())?
				.to_path_buf();
			matches.push(relative);
		}
	}

	matches.sort();
	Ok(matches)
}

fn tail_match_count(
	left: &[String],
	right: &[String],
) -> usize {
	left.iter()
		.rev()
		.zip(right.iter().rev())
		.take_while(|(left_value, right_value)| left_value == right_value)
		.count()
}

fn strip_source_prefix<'a>(
	path: &'a Path,
	prefix: &Path,
) -> Option<&'a Path> {
	if prefix.as_os_str().is_empty() {
		return Some(path);
	}

	path.strip_prefix(prefix).ok()
}

fn candidate_mapping_key(
	manifest: &OverlayManifest,
	destination_relative_path: &Path,
	source_prefix: &Path,
) -> Option<Vec<String>> {
	let mut destinations = Vec::with_capacity(manifest.files.len());

	for file in &manifest.files {
		let stripped = strip_source_prefix(
			&file.relative_path,
			source_prefix,
		)?;

		if stripped.as_os_str().is_empty() {
			return None;
		}

		let destination = destination_relative_path.join(stripped);
		destinations.push(
			destination
				.to_string_lossy()
				.replace('\\', "/")
				.to_lowercase(),
		);
	}

	Some(destinations)
}

fn count_existing_directory_depth(
	root: &Path,
	destination_relative_path: &Path,
	file_relative_path: &Path,
	project_ignore: &ProjectIgnore,
) -> usize {
	let mut current = root.join(destination_relative_path);
	let Some(parent) = file_relative_path.parent() else {
		return 0;
	};
	let mut count = 0_usize;

	for component in parent.components() {
		let Component::Normal(name) = component else {
			break;
		};

		current.push(name);

		if project_ignore.is_ignored(
			&current,
			true,
		) {
			break;
		}

		match fs::symlink_metadata(&current) {
			Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => count += 1,
			_ => break,
		}
	}

	count
}

fn build_candidate_plan(
	root: &Path,
	manifest: &OverlayManifest,
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	project_ignore: &ProjectIgnore,
	source_context_matches_override: Option<usize>,
	is_named_destination: bool,
) -> Option<CandidatePlan> {
	let mapping_key = candidate_mapping_key(
		manifest,
		&destination_relative_path,
		&source_prefix,
	)?;
	let mut matched_files = 0_usize;
	let mut matched_directories = 0_usize;

	for file in &manifest.files {
		let stripped = strip_source_prefix(
			&file.relative_path,
			&source_prefix,
		)?;
		let destination_relative = destination_relative_path.join(stripped);

		if validate_destination_entry(
			root,
			&destination_relative,
			false,
		)
		.is_err()
		{
			return None;
		}

		let destination = root.join(&destination_relative);

		if !project_ignore.is_ignored(
			&destination,
			false,
		) && destination.is_file()
		{
			matched_files += 1;
		}

		matched_directories += count_existing_directory_depth(
			root,
			&destination_relative_path,
			stripped,
			project_ignore,
		);
	}

	let destination_segments = path_segments(&root.join(&destination_relative_path));
	let source_context_matches = source_context_matches_override.unwrap_or_else(|| {
		match &manifest.kind {
			ManifestKind::Directory { source_context, .. } |
			ManifestKind::File { source_context, .. } => tail_match_count(
				source_context,
				&destination_segments,
			),
			ManifestKind::Zip { .. } => {
				let source_segments = path_segments(&source_prefix);
				tail_match_count(
					&source_segments,
					&destination_segments,
				)
			}
		}
	});
	let directory_score = matched_directories.min(24);
	let named_destination_score = if is_named_destination {
		20
	} else {
		0
	};
	let source_prefix_penalty = normal_components(&source_prefix).len() * ZIP_SOURCE_PREFIX_PENALTY_PER_SEGMENT;
	let score = (
		matched_files * 100 +
			directory_score * 8 +
			source_context_matches * 30 +
			named_destination_score
	)
	.saturating_sub(source_prefix_penalty);

	Some(CandidatePlan {
		candidate: OverlayDestinationCandidate {
			destination_relative_path: normalize_relative_display(&destination_relative_path),
			source_prefix: normalize_source_prefix(&source_prefix),
			matched_files,
			matched_directories,
			source_context_matches,
		},
		destination_relative_path,
		source_prefix,
		score,
		mapping_key,
		is_named_destination,
	})
}

fn candidate_target_names(manifest: &OverlayManifest) -> HashSet<String> {
	let mut names = HashSet::new();

	match &manifest.kind {
		ManifestKind::Directory {
			source_context,
			source_name,
			..
		} => {
			names.insert(source_name.to_lowercase());

			let start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for name in &source_context[start..] {
				names.insert(name.clone());
			}
		}
		ManifestKind::File { source_context, .. } => {
			let start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for name in &source_context[start..] {
				names.insert(name.clone());
			}
		}
		ManifestKind::Zip { .. } => {
			for prefix in &manifest.common_directory_prefixes {
				if let Some(name) = prefix.file_name() {
					names.insert(name.to_string_lossy().to_lowercase());
				}
			}
		}
	}

	names
}

fn deduplicate_candidates(candidates: Vec<CandidatePlan>) -> Vec<CandidatePlan> {
	let mut by_mapping = HashMap::<Vec<String>, CandidatePlan>::new();

	for candidate in candidates {
		match by_mapping.get(&candidate.mapping_key) {
			Some(existing) => {
				let existing_is_exact_root = existing.destination_relative_path.as_os_str().is_empty() &&
					existing.source_prefix.as_os_str().is_empty();
				let candidate_is_exact_root = candidate.destination_relative_path.as_os_str().is_empty() &&
					candidate.source_prefix.as_os_str().is_empty();
				let should_replace = if candidate_is_exact_root {
					!existing_is_exact_root
				} else if existing_is_exact_root {
					false
				} else {
					candidate.score > existing.score
				};

				if should_replace {
					by_mapping.insert(
						candidate.mapping_key.clone(),
						candidate,
					);
				}
			}
			None => {
				by_mapping.insert(
					candidate.mapping_key.clone(),
					candidate,
				);
			}
		}
	}

	let mut values = by_mapping.into_values().collect::<Vec<_>>();
	values.sort_by(|left, right| {
		right
			.score
			.cmp(&left.score)
			.then_with(|| right.candidate.matched_files.cmp(&left.candidate.matched_files))
			.then_with(|| {
				left
					.candidate
					.destination_relative_path
					.cmp(&right.candidate.destination_relative_path)
			})
	});
	values
}

fn is_exact_root_candidate(candidate: &CandidatePlan) -> bool {
	candidate.destination_relative_path.as_os_str().is_empty() &&
		candidate.source_prefix.as_os_str().is_empty()
}

fn prune_weak_candidates(candidates: Vec<CandidatePlan>) -> Vec<CandidatePlan> {
	let strongest_context = candidates
		.iter()
		.filter(|candidate| !is_exact_root_candidate(candidate))
		.map(|candidate| candidate.candidate.source_context_matches)
		.max()
		.unwrap_or(0);
	let minimum_context = if strongest_context >= 3 {
		strongest_context.saturating_sub(1)
	} else {
		strongest_context
	};
	let has_non_root_evidence = candidates.iter().any(|candidate| {
		!is_exact_root_candidate(candidate) &&
			(
				candidate.is_named_destination ||
				candidate.candidate.matched_files > 0 ||
				candidate.candidate.matched_directories > 0 ||
				candidate.candidate.source_context_matches > 0
			)
	});

	candidates
		.into_iter()
		.filter(|candidate| {
			if is_exact_root_candidate(candidate) {
				return candidate.candidate.matched_files > 0 ||
					candidate.candidate.matched_directories > 0 ||
					!has_non_root_evidence;
			}

			if candidate.candidate.matched_files > 0 {
				return true;
			}

			if strongest_context >= 2 {
				return candidate.candidate.source_context_matches >= minimum_context.max(2);
			}

			candidate.is_named_destination ||
				candidate.candidate.source_context_matches > 0 ||
				candidate.candidate.matched_directories > 0
		})
		.collect()
}

fn build_candidates(
	root: &Path,
	manifest: &OverlayManifest,
) -> Result<Vec<CandidatePlan>, String> {
	let target_names = candidate_target_names(manifest);
	let project_ignore = ProjectIgnore::load(root)?;
	let project_matches = collect_project_directories_by_name(
		root,
		&target_names,
		&project_ignore,
	)?;
	let mut candidates = Vec::new();

	if let Some(candidate) = build_candidate_plan(
		root,
		manifest,
		PathBuf::new(),
		PathBuf::new(),
		&project_ignore,
		None,
		false,
	) {
		candidates.push(candidate);
	}

	match &manifest.kind {
		ManifestKind::Directory {
			source_context,
			source_components,
			source_name,
			..
		} => {
			if let Some(destinations) = project_matches.get(&source_name.to_lowercase()) {
				for destination in destinations {
					if let Some(candidate) = build_candidate_plan(
						root,
						manifest,
						destination.clone(),
						PathBuf::new(),
						&project_ignore,
						None,
						true,
					) {
						candidates.push(candidate);
					}
				}
			}

			let source_end = source_context.len().saturating_sub(1);
			let source_start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for source_index in source_start..source_end {
				let ancestor_name = &source_context[source_index];
				let Some(destinations) = project_matches.get(ancestor_name) else {
					continue;
				};

				for destination in destinations {
					let project_context = path_segments(&root.join(destination));
					let context_matches = tail_match_count(
						&source_context[..=source_index],
						&project_context,
					);

					if context_matches < 2 {
						continue;
					}

					let mut derived_destination = destination.clone();

					for component in &source_components[source_index + 1..] {
						derived_destination.push(component);
					}

					if let Some(candidate) = build_candidate_plan(
						root,
						manifest,
						derived_destination,
						PathBuf::new(),
						&project_ignore,
						Some(context_matches),
						false,
					) {
						candidates.push(candidate);
					}
				}
			}
		}
		ManifestKind::File {
			source_context,
			source_components,
			source_name,
			..
		} => {
			let file_matches = collect_project_files_by_name(
				root,
				source_name,
				&project_ignore,
			)?;

			for file_match in file_matches {
				let destination = file_match
					.parent()
					.unwrap_or_else(|| Path::new(""))
					.to_path_buf();
				let project_context = path_segments(&root.join(&destination));
				let context_matches = tail_match_count(
					source_context,
					&project_context,
				);

				if let Some(candidate) = build_candidate_plan(
					root,
					manifest,
					destination,
					PathBuf::new(),
					&project_ignore,
					Some(context_matches),
					true,
				) {
					candidates.push(candidate);
				}
			}

			let source_start = source_context
				.len()
				.saturating_sub(MAX_SOURCE_CONTEXT_SEGMENTS);

			for source_index in source_start..source_context.len() {
				let ancestor_name = &source_context[source_index];
				let Some(destinations) = project_matches.get(ancestor_name) else {
					continue;
				};

				for destination in destinations {
					let project_context = path_segments(&root.join(destination));
					let context_matches = tail_match_count(
						&source_context[..=source_index],
						&project_context,
					);

					if context_matches < 2 {
						continue;
					}

					let mut derived_destination = destination.clone();

					for component in &source_components[source_index + 1..] {
						derived_destination.push(component);
					}

					if let Some(candidate) = build_candidate_plan(
						root,
						manifest,
						derived_destination,
						PathBuf::new(),
						&project_ignore,
						Some(context_matches),
						false,
					) {
						candidates.push(candidate);
					}
				}
			}
		}
		ManifestKind::Zip { .. } => {
			for prefix in &manifest.common_directory_prefixes {
				if let Some(candidate) = build_candidate_plan(
					root,
					manifest,
					PathBuf::new(),
					prefix.clone(),
					&project_ignore,
					None,
					false,
				) {
					candidates.push(candidate);
				}

				let prefix_components = normal_components(prefix);
				let prefix_context = prefix_components
					.iter()
					.map(|component| component.to_string_lossy().to_lowercase())
					.collect::<Vec<_>>();
				let prefix_depth = prefix_context.len();

				let Some(name) = prefix.file_name() else {
					continue;
				};
				let normalized_name = name.to_string_lossy().to_lowercase();

				if let Some(destinations) = project_matches.get(&normalized_name) {
					for destination in destinations {
						if let Some(candidate) = build_candidate_plan(
							root,
							manifest,
							destination.clone(),
							prefix.clone(),
							&project_ignore,
							None,
							true,
						) {
							let has_enough_context = prefix_depth <= 1 ||
								candidate.candidate.source_context_matches >= 2 ||
								candidate.candidate.matched_files > 0 ||
								candidate.candidate.matched_directories >= 2;

							if has_enough_context {
								candidates.push(candidate);
							}
						}
					}
				}

				for source_index in 0..prefix_context.len() {
					let ancestor_name = &prefix_context[source_index];
					let Some(destinations) = project_matches.get(ancestor_name) else {
						continue;
					};

					for destination in destinations {
						let project_context = path_segments(&root.join(destination));
						let context_matches = tail_match_count(
							&prefix_context[..=source_index],
							&project_context,
						);

						if context_matches < 2 {
							continue;
						}

						let mut derived_destination = destination.clone();

						for component in &prefix_components[source_index + 1..] {
							derived_destination.push(component);
						}

						if let Some(candidate) = build_candidate_plan(
							root,
							manifest,
							derived_destination,
							prefix.clone(),
							&project_ignore,
							Some(context_matches),
							source_index + 1 == prefix_context.len(),
						) {
							candidates.push(candidate);
						}
					}
				}
			}
		}
	}

	Ok(prune_weak_candidates(deduplicate_candidates(candidates)))
}

fn expected_parent_directory_matches(manifest: &OverlayManifest) -> usize {
	manifest
		.files
		.iter()
		.map(|file| {
			file.relative_path
				.parent()
				.map(normal_components)
				.map_or(0, |components| components.len())
		})
		.sum()
}

fn recommended_candidate_index(
	candidates: &[CandidatePlan],
	manifest: &OverlayManifest,
) -> Option<usize> {
	if matches!(&manifest.kind, ManifestKind::Zip { .. }) && !manifest.files.is_empty() {
		let expected_directory_matches = expected_parent_directory_matches(manifest);
		let exact_root_index = candidates.iter().position(|candidate| {
			is_exact_root_candidate(candidate) &&
				(
					candidate.candidate.matched_files == manifest.files.len() ||
					(
						expected_directory_matches >= 2 &&
						candidate.candidate.matched_directories == expected_directory_matches
					)
				)
		});

		if exact_root_index.is_some() {
			return exact_root_index;
		}
	}

	let top = candidates.first()?;
	let second = candidates.get(1);
	let has_evidence = top.candidate.matched_files > 0 ||
		top.candidate.matched_directories > 0 ||
		top.candidate.source_context_matches > 0 ||
		top.is_named_destination;

	if !has_evidence {
		return None;
	}

	let Some(second_candidate) = second else {
		return Some(0);
	};

	if top.candidate.source_context_matches >= 3 &&
		top.candidate.source_context_matches > second_candidate.candidate.source_context_matches
	{
		return Some(0);
	}

	if top.candidate.matched_files >= 2 &&
		top.candidate.matched_files > second_candidate.candidate.matched_files
	{
		return Some(0);
	}

	if top.is_named_destination &&
		!second_candidate.is_named_destination &&
		top.candidate.matched_files >= second_candidate.candidate.matched_files &&
		top.candidate.matched_directories >= second_candidate.candidate.matched_directories
	{
		return Some(0);
	}

	if top.score >= second_candidate.score.saturating_add(40) &&
		(
			top.candidate.matched_files > 0 ||
			top.candidate.source_context_matches >= 2
		)
	{
		return Some(0);
	}

	None
}

fn prepare_project_overlay_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<PrepareProjectOverlayResult, String> {
	let (root, manifest) = build_manifest(
		&root_folder,
		&paths,
	)?;

	if manifest.files.is_empty() {
		if manifest.delete_paths.is_empty() {
			return Err("Nenhum arquivo foi encontrado para aplicar ou excluir.".to_string());
		}

		return Ok(PrepareProjectOverlayResult {
			file_count: 0,
			delete_count: manifest.delete_paths.len(),
			candidates: vec![OverlayDestinationCandidate {
				destination_relative_path: "./".to_string(),
				source_prefix: String::new(),
				matched_files: 0,
				matched_directories: 0,
				source_context_matches: 0,
			}],
			recommended_candidate_index: Some(0),
			candidate_count: 1,
			ambiguity_limit: MAX_AMBIGUOUS_DESTINATIONS,
			ambiguity_limit_exceeded: false,
		});
	}

	let mut candidates = build_candidates(
		&root,
		&manifest,
	)?;
	if candidates.is_empty() {
		return Err("Nenhum destino seguro foi encontrado para a estrutura aplicada.".to_string());
	}

	let mut recommended = recommended_candidate_index(
		&candidates,
		&manifest,
	);

	if let Some(index) = recommended {
		if index != 0 {
			candidates.swap(
				0,
				index,
			);
			recommended = Some(0);
		}
	}

	let candidate_count = candidates.len();
	let ambiguity_limit_exceeded = recommended.is_none() &&
		candidate_count > MAX_AMBIGUOUS_DESTINATIONS;
	let serialized = if ambiguity_limit_exceeded {
		Vec::new()
	} else {
		candidates
			.into_iter()
			.take(MAX_AMBIGUOUS_DESTINATIONS)
			.map(|candidate| candidate.candidate)
			.collect::<Vec<_>>()
	};

	Ok(PrepareProjectOverlayResult {
		file_count: manifest.files.len(),
		delete_count: manifest.delete_paths.len(),
		candidates: serialized,
		recommended_candidate_index: recommended.filter(|index| *index < MAX_AMBIGUOUS_DESTINATIONS),
		candidate_count,
		ambiguity_limit: MAX_AMBIGUOUS_DESTINATIONS,
		ambiguity_limit_exceeded,
	})
}

fn planned_files(
	root: &Path,
	manifest: &OverlayManifest,
	destination_relative_path: &Path,
	source_prefix: &Path,
) -> Result<Vec<PlannedFile>, String> {
	let destination_base = root.join(destination_relative_path);

	if destination_relative_path.as_os_str().is_empty() {
		if destination_base != root {
			return Err("O destino raiz calculado é inválido.".to_string());
		}
	} else {
		validate_destination_entry(
			root,
			destination_relative_path,
			true,
		)?;
	}

	if !matches!(&manifest.kind, ManifestKind::Zip { .. }) && !source_prefix.as_os_str().is_empty() {
		return Err("Somente fontes ZIP aceitam prefixo interno.".to_string());
	}

	let mut seen_destinations = HashSet::new();
	let mut files = Vec::new();

	for (source_index, file) in manifest.files.iter().enumerate() {
		let stripped = strip_source_prefix(
			&file.relative_path,
			source_prefix,
		)
		.ok_or_else(|| "O destino escolhido não corresponde à estrutura da fonte.".to_string())?;

		if stripped.as_os_str().is_empty() {
			return Err("O destino escolhido gera um caminho de arquivo vazio.".to_string());
		}

		let destination_relative = destination_relative_path.join(stripped);
		let normalized = destination_relative
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if !seen_destinations.insert(normalized) {
			return Err("A aplicação geraria dois arquivos no mesmo caminho.".to_string());
		}

		let was_replaced = validate_destination_entry(
			root,
			&destination_relative,
			false,
		)?;

		files.push(PlannedFile {
			destination_relative_path: destination_relative,
			source_index,
			was_replaced,
		});
	}

	Ok(files)
}

fn planned_deletions(
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<Vec<PathBuf>, String> {
	let destinations = planned_files
		.iter()
		.map(|file| {
			file.destination_relative_path
				.to_string_lossy()
				.replace('\\', "/")
				.to_lowercase()
		})
		.collect::<HashSet<_>>();

	for delete_path in &manifest.delete_paths {
		let normalized = delete_path
			.to_string_lossy()
			.replace('\\', "/")
			.to_lowercase();

		if destinations.contains(&normalized) {
			return Err(format!(
				"O patch tenta aplicar e excluir o mesmo arquivo: {}.",
				normalize_relative_display(delete_path),
			));
		}
	}

	Ok(manifest.delete_paths.clone())
}

fn collect_missing_parent_directories(
	root: &Path,
	files: &[PlannedFile],
) -> Result<Vec<PathBuf>, String> {
	let mut directories = HashSet::new();

	for file in files {
		let Some(parent) = file.destination_relative_path.parent() else {
			continue;
		};
		let mut current = PathBuf::new();

		for component in parent.components() {
			let Component::Normal(name) = component else {
				return Err("A estrutura de destino contém um caminho inválido.".to_string());
			};

			current.push(name);
			let absolute = root.join(&current);

			match fs::symlink_metadata(&absolute) {
				Ok(metadata) => {
					if metadata.file_type().is_symlink() || !metadata.is_dir() {
						return Err(format!(
							"O caminho {} não pode receber o patch.",
							absolute.display(),
						));
					}
				}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					directories.insert(current.clone());
				}
				Err(error) => {
					return Err(format!(
						"Não foi possível validar {}: {error}",
						absolute.display(),
					));
				}
			}
		}
	}

	let mut values = directories.into_iter().collect::<Vec<_>>();
	values.sort_by_key(|path| path.components().count());
	Ok(values)
}

fn create_backup_directory() -> Result<PathBuf, String> {
	let timestamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_err(|error| format!("Não foi possível criar o snapshot de desfazer: {error}"))?
		.as_nanos();
	let directory = std::env::temp_dir()
		.join("orqeto-dev")
		.join(format!("undo-{}-{timestamp}", std::process::id()));

	fs::create_dir_all(&directory)
		.map_err(|error| format!("Não foi possível criar o snapshot de desfazer: {error}"))?;
	Ok(directory)
}

fn file_fingerprint(path: &Path) -> Result<FileFingerprint, String> {
	let mut file = File::open(path)
		.map_err(|error| format!("Não foi possível verificar {}: {error}", path.display()))?;
	let mut buffer = vec![0_u8; FINGERPRINT_BUFFER_SIZE];
	let mut size = 0_u64;
	let mut hash = FNV_OFFSET_BASIS;

	loop {
		let read = file
			.read(&mut buffer)
			.map_err(|error| format!("Não foi possível verificar {}: {error}", path.display()))?;

		if read == 0 {
			break;
		}

		size = size
			.checked_add(read as u64)
			.ok_or_else(|| "O tamanho do arquivo verificado é inválido.".to_string())?;

		for byte in &buffer[..read] {
			hash ^= u64::from(*byte);
			hash = hash.wrapping_mul(FNV_PRIME);
		}
	}

	Ok(FileFingerprint {
		size,
		hash,
	})
}

fn backup_replaced_files(
	root: &Path,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
	backup_directory: &Path,
) -> Result<(), String> {
	let replaced_paths = planned_files
		.iter()
		.filter(|file| file.was_replaced)
		.map(|file| file.destination_relative_path.clone())
		.chain(delete_paths.iter().cloned());

	for relative_path in replaced_paths {
		let source = root.join(&relative_path);
		let backup = backup_directory
			.join("replaced")
			.join(&relative_path);
		let parent = backup
			.parent()
			.ok_or_else(|| "Não foi possível determinar a pasta do snapshot.".to_string())?;

		fs::create_dir_all(parent)
			.map_err(|error| format!("Não foi possível preparar o snapshot: {error}"))?;
		fs::copy(
			&source,
			&backup,
		)
		.map_err(|error| format!("Não foi possível salvar {} no snapshot: {error}", source.display()))?;
	}

	Ok(())
}

fn delete_manifest_files(
	root: &Path,
	delete_paths: &[PathBuf],
) -> Result<(), String> {
	for relative_path in delete_paths {
		let destination = root.join(relative_path);

		fs::remove_file(&destination)
			.map_err(|error| format!("Não foi possível excluir {}: {error}", destination.display()))?;
	}

	Ok(())
}

fn write_directory_manifest_file(
	manifest: &OverlayManifest,
	planned: &PlannedFile,
	destination: &Path,
) -> Result<(), String> {
	let file = manifest
		.files
		.get(planned.source_index)
		.ok_or_else(|| "O arquivo de origem do patch não está mais disponível.".to_string())?;
	let ManifestFileSource::Directory(source) = &file.source else {
		return Err("A fonte do patch foi interpretada com um tipo inválido.".to_string());
	};

	fs::copy(
		source,
		destination,
	)
	.map_err(|error| {
		format!(
			"Não foi possível aplicar {} em {}: {error}",
			source.display(),
			destination.display(),
		)
	})?;
	Ok(())
}

fn write_zip_manifest_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<(), String> {
	let ManifestKind::Zip { archive_path } = &manifest.kind else {
		return Err("A fonte ZIP foi interpretada com um tipo inválido.".to_string());
	};
	let archive_file = File::open(archive_path)
		.map_err(|error| format!("Não foi possível reabrir {}: {error}", archive_path.display()))?;
	let mut archive = ZipArchive::new(archive_file)
		.map_err(|error| format!("Não foi possível reabrir o ZIP: {error}"))?;

	for planned in planned_files {
		let manifest_file = manifest
			.files
			.get(planned.source_index)
			.ok_or_else(|| "O arquivo de origem do ZIP não está mais disponível.".to_string())?;
		let ManifestFileSource::Zip(index) = &manifest_file.source else {
			return Err("A fonte ZIP foi interpretada com um tipo inválido.".to_string());
		};
		let destination = root.join(&planned.destination_relative_path);
		let parent = destination
			.parent()
			.ok_or_else(|| "Não foi possível determinar a pasta de destino.".to_string())?;

		fs::create_dir_all(parent)
			.map_err(|error| format!("Não foi possível criar {}: {error}", parent.display()))?;

		let mut source = archive
			.by_index(*index)
			.map_err(|error| format!("Não foi possível reler uma entrada do ZIP: {error}"))?;
		let mut destination_file = File::create(&destination)
			.map_err(|error| format!("Não foi possível criar {}: {error}", destination.display()))?;

		std::io::copy(
			&mut source,
			&mut destination_file,
		)
		.map_err(|error| format!("Não foi possível escrever {}: {error}", destination.display()))?;
		destination_file
			.flush()
			.map_err(|error| format!("Não foi possível finalizar {}: {error}", destination.display()))?;
	}

	Ok(())
}

fn write_manifest_files(
	root: &Path,
	manifest: &OverlayManifest,
	planned_files: &[PlannedFile],
) -> Result<(), String> {
	match &manifest.kind {
		ManifestKind::Directory { source_root, .. } => {
			if !source_root.is_dir() {
				return Err("A pasta usada como fonte não está mais disponível.".to_string());
			}

			for planned in planned_files {
				let destination = root.join(&planned.destination_relative_path);
				let parent = destination
					.parent()
					.ok_or_else(|| "Não foi possível determinar a pasta de destino.".to_string())?;

				fs::create_dir_all(parent)
					.map_err(|error| format!("Não foi possível criar {}: {error}", parent.display()))?;
				write_directory_manifest_file(
					manifest,
					planned,
					&destination,
				)?;
			}
		}
		ManifestKind::File { source_file, .. } => {
			if !source_file.is_file() {
				return Err("O arquivo usado como fonte não está mais disponível.".to_string());
			}

			for planned in planned_files {
				let destination = root.join(&planned.destination_relative_path);
				let parent = destination
					.parent()
					.ok_or_else(|| "Não foi possível determinar a pasta de destino.".to_string())?;

				fs::create_dir_all(parent)
					.map_err(|error| format!("Não foi possível criar {}: {error}", parent.display()))?;
				write_directory_manifest_file(
					manifest,
					planned,
					&destination,
				)?;
			}
		}
		ManifestKind::Zip { .. } => write_zip_manifest_files(
			root,
			manifest,
			planned_files,
		)?,
	}

	Ok(())
}

fn build_undo_snapshot(
	root: &Path,
	planned_files: &[PlannedFile],
	delete_paths: &[PathBuf],
	created_directories: Vec<PathBuf>,
	backup_directory: PathBuf,
) -> Result<UndoSnapshot, String> {
	let mut files = Vec::new();

	for planned in planned_files {
		let destination = root.join(&planned.destination_relative_path);
		let applied_fingerprint = Some(file_fingerprint(&destination)?);
		let kind = if planned.was_replaced {
			UndoFileKind::Replaced {
				backup_path: backup_directory
					.join("replaced")
					.join(&planned.destination_relative_path),
			}
		} else {
			UndoFileKind::Created
		};

		files.push(UndoFile {
			destination_relative_path: planned.destination_relative_path.clone(),
			kind,
			applied_fingerprint,
		});
	}

	for delete_path in delete_paths {
		files.push(UndoFile {
			destination_relative_path: delete_path.clone(),
			kind: UndoFileKind::Replaced {
				backup_path: backup_directory
					.join("replaced")
					.join(delete_path),
			},
			applied_fingerprint: None,
		});
	}

	Ok(UndoSnapshot {
		root: root.to_path_buf(),
		backup_directories: vec![backup_directory],
		files,
		created_directories,
		applied_at_unix_ms: current_unix_ms(),
	})
}

fn remove_empty_created_directories(
	root: &Path,
	created_directories: &[PathBuf],
) {
	let mut directories = created_directories.to_vec();
	directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

	for relative in directories {
		let absolute = root.join(relative);
		let _ = fs::remove_dir(absolute);
	}
}

fn rollback_snapshot(snapshot: &UndoSnapshot) {
	for file in snapshot.files.iter().rev() {
		let destination = snapshot.root.join(&file.destination_relative_path);

		match &file.kind {
			UndoFileKind::Created => {
				let _ = fs::remove_file(&destination);
			}
			UndoFileKind::Replaced { backup_path } => {
				let _ = fs::copy(
					backup_path,
					destination,
				);
			}
		}
	}

	remove_empty_created_directories(
		&snapshot.root,
		&snapshot.created_directories,
	);
}

fn discard_snapshot(snapshot: UndoSnapshot) {
	for directory in snapshot.backup_directories {
		let _ = fs::remove_dir_all(directory);
	}
}

fn apply_project_overlay_blocking(
	root_folder: String,
	paths: Vec<String>,
	destination_relative_path: String,
	source_prefix: String,
) -> Result<(ApplyProjectOverlayResult, UndoSnapshot), String> {
	let (root, manifest) = build_manifest(
		&root_folder,
		&paths,
	)?;
	let destination_relative = parse_relative_path(&destination_relative_path)?;
	let prefix = parse_relative_path(&source_prefix)?;
	let planned = planned_files(
		&root,
		&manifest,
		&destination_relative,
		&prefix,
	)?;
	let delete_paths = planned_deletions(
		&manifest,
		&planned,
	)?;

	if planned.is_empty() && delete_paths.is_empty() {
		return Err("Nenhum arquivo foi encontrado para aplicar ou excluir.".to_string());
	}

	let added_files = planned
		.iter()
		.filter(|file| !file.was_replaced)
		.count();
	let replaced_files = planned.len() - added_files;
	let deleted_files = delete_paths.len();
	let created_directories = collect_missing_parent_directories(
		&root,
		&planned,
	)?;
	let backup_directory = create_backup_directory()?;

	if let Err(error) = backup_replaced_files(
		&root,
		&planned,
		&delete_paths,
		&backup_directory,
	) {
		let _ = fs::remove_dir_all(&backup_directory);
		return Err(error);
	}

	let mut placeholder_files = planned
		.iter()
		.map(|file| UndoFile {
			destination_relative_path: file.destination_relative_path.clone(),
			kind: if file.was_replaced {
				UndoFileKind::Replaced {
					backup_path: backup_directory
						.join("replaced")
						.join(&file.destination_relative_path),
				}
			} else {
				UndoFileKind::Created
			},
			applied_fingerprint: Some(FileFingerprint {
				size: 0,
				hash: 0,
			}),
		})
		.collect::<Vec<_>>();

	placeholder_files.extend(delete_paths.iter().map(|delete_path| UndoFile {
		destination_relative_path: delete_path.clone(),
		kind: UndoFileKind::Replaced {
			backup_path: backup_directory
				.join("replaced")
				.join(delete_path),
		},
		applied_fingerprint: None,
	}));

	let placeholder_snapshot = UndoSnapshot {
		root: root.clone(),
		backup_directories: vec![backup_directory.clone()],
		files: placeholder_files,
		created_directories: created_directories.clone(),
		applied_at_unix_ms: current_unix_ms(),
	};

	if let Err(error) = write_manifest_files(
		&root,
		&manifest,
		&planned,
	) {
		rollback_snapshot(&placeholder_snapshot);
		let _ = fs::remove_dir_all(&backup_directory);
		return Err(error);
	}

	if let Err(error) = delete_manifest_files(
		&root,
		&delete_paths,
	) {
		rollback_snapshot(&placeholder_snapshot);
		let _ = fs::remove_dir_all(&backup_directory);
		return Err(error);
	}

	let snapshot = match build_undo_snapshot(
		&root,
		&planned,
		&delete_paths,
		created_directories,
		backup_directory.clone(),
	) {
		Ok(snapshot) => snapshot,
		Err(error) => {
			rollback_snapshot(&placeholder_snapshot);
			let _ = fs::remove_dir_all(&backup_directory);
			return Err(error);
		}
	};

	Ok((
		ApplyProjectOverlayResult {
			added_files,
			replaced_files,
			deleted_files,
		},
		snapshot,
	))
}

fn merge_undo_snapshots(
	mut previous: UndoSnapshot,
	current: UndoSnapshot,
) -> UndoSnapshot {
	if previous.root != current.root {
		discard_snapshot(previous);
		return current;
	}

	let mut file_indexes = previous
		.files
		.iter()
		.enumerate()
		.map(|(index, file)| (file.destination_relative_path.clone(), index))
		.collect::<HashMap<_, _>>();

	for current_file in current.files {
		if let Some(index) = file_indexes.get(&current_file.destination_relative_path).copied() {
			previous.files[index].applied_fingerprint = current_file.applied_fingerprint;
			continue;
		}

		file_indexes.insert(
			current_file.destination_relative_path.clone(),
			previous.files.len(),
		);
		previous.files.push(current_file);
	}

	previous
		.created_directories
		.extend(current.created_directories);
	previous.created_directories.sort();
	previous.created_directories.dedup();
	previous
		.backup_directories
		.extend(current.backup_directories);
	previous.applied_at_unix_ms = current.applied_at_unix_ms;

	previous
}

fn validate_undo_history_limit(limit: usize) -> Result<usize, String> {
	if !(MIN_UNDO_HISTORY_ENTRIES..=MAX_UNDO_HISTORY_ENTRIES).contains(&limit) {
		return Err(format!(
			"O limite do histórico de aplicações deve ficar entre {MIN_UNDO_HISTORY_ENTRIES} e {MAX_UNDO_HISTORY_ENTRIES}.",
		));
	}

	Ok(limit)
}

fn trim_undo_history(
	history: &mut Vec<UndoSnapshot>,
	history_limit: usize,
) {
	while history.len() > history_limit {
		let expired = history.remove(0);
		discard_snapshot(expired);
	}
}

fn record_undo_snapshot(
	history: &mut Vec<UndoSnapshot>,
	snapshot: UndoSnapshot,
	append_undo: bool,
	history_limit: usize,
) {
	if append_undo {
		if let Some(previous) = history.pop() {
			history.push(merge_undo_snapshots(
				previous,
				snapshot,
			));
		} else {
			history.push(snapshot);
		}
	} else {
		history.push(snapshot);
	}

	trim_undo_history(
		history,
		history_limit,
	);
}

fn validate_undo_snapshot(snapshot: &UndoSnapshot) -> Result<(), String> {
	for file in &snapshot.files {
		let destination = snapshot.root.join(&file.destination_relative_path);

		match file.applied_fingerprint {
			Some(expected) => {
				let current = file_fingerprint(&destination)
					.map_err(|_| {
						format!(
							"Não é seguro desfazer: {} não está mais como o patch deixou.",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?;

				if current != expected {
					return Err(format!(
						"Não é seguro desfazer: {} foi alterado depois da aplicação.",
						normalize_relative_display(&file.destination_relative_path),
					));
				}

				OpenOptions::new()
					.write(true)
					.open(&destination)
					.map_err(|error| {
						format!(
							"Não é seguro desfazer enquanto {} não puder ser alterado: {error}",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?;
			}
			None => match fs::symlink_metadata(&destination) {
				Ok(_) => {
					return Err(format!(
						"Não é seguro desfazer: {} foi recriado depois da aplicação.",
						normalize_relative_display(&file.destination_relative_path),
					));
				}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					if let Some(parent) = file.destination_relative_path.parent() {
						if !parent.as_os_str().is_empty() && !validate_destination_entry(
							&snapshot.root,
							parent,
							true,
						)? {
							return Err(format!(
								"Não é seguro desfazer: a pasta de {} não está mais como o patch deixou.",
								normalize_relative_display(&file.destination_relative_path),
							));
						}
					}
				}
				Err(error) => {
					return Err(format!(
						"Não foi possível validar {} antes de desfazer: {error}",
						normalize_relative_display(&file.destination_relative_path),
					));
				}
			},
		}

		if let UndoFileKind::Replaced { backup_path } = &file.kind {
			if !backup_path.is_file() {
				return Err(format!(
					"O snapshot necessário para restaurar {} não está mais disponível.",
					normalize_relative_display(&file.destination_relative_path),
				));
			}
		}
	}

	Ok(())
}

fn undo_project_overlay_blocking(
	root_folder: String,
	snapshot: &UndoSnapshot,
) -> Result<UndoProjectOverlayResult, String> {
	let root = canonicalize_existing(Path::new(&root_folder))?;

	if root != snapshot.root {
		return Err("O último patch pertence a outra pasta do projeto e não pode ser desfeito aqui.".to_string());
	}

	validate_undo_snapshot(snapshot)?;
	let mut restored_files = 0_usize;
	let mut removed_files = 0_usize;

	for file in snapshot.files.iter().rev() {
		let destination = snapshot.root.join(&file.destination_relative_path);

		match &file.kind {
			UndoFileKind::Created => {
				if file.applied_fingerprint.is_some() {
					fs::remove_file(&destination)
						.map_err(|error| format!("Não foi possível remover {}: {error}", destination.display()))?;
					removed_files += 1;
				}
			}
			UndoFileKind::Replaced { backup_path } => {
				fs::copy(
					backup_path,
					&destination,
				)
				.map_err(|error| format!("Não foi possível restaurar {}: {error}", destination.display()))?;
				restored_files += 1;
			}
		}
	}

	remove_empty_created_directories(
		&snapshot.root,
		&snapshot.created_directories,
	);

	Ok(UndoProjectOverlayResult {
		restored_files,
		removed_files,
		undone_batches: 1,
		remaining_history_entries: 0,
	})
}

#[tauri::command]
pub async fn prepare_project_overlay(
	root_folder: String,
	paths: Vec<String>,
) -> Result<PrepareProjectOverlayResult, String> {
	tauri::async_runtime::spawn_blocking(move || {
		prepare_project_overlay_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("A análise do patch foi interrompida: {error}"))?
}

#[tauri::command]
pub async fn apply_project_overlay(
	root_folder: String,
	paths: Vec<String>,
	destination_relative_path: String,
	source_prefix: String,
	append_undo: bool,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<ApplyProjectOverlayResult, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let (result, snapshot) = tauri::async_runtime::spawn_blocking(move || {
		apply_project_overlay_blocking(
			root_folder,
			paths,
			destination_relative_path,
			source_prefix,
		)
	})
	.await
	.map_err(|error| format!("A aplicação dos arquivos foi interrompida: {error}"))??;
	let root = snapshot.root.clone();
	let mut histories = undo_state
		.histories
		.lock()
		.map_err(|_| "O estado de desfazer ficou indisponível.".to_string())?;
	let history = histories.entry(root).or_default();

	record_undo_snapshot(
		history,
		snapshot,
		append_undo,
		undo_history_limit,
	);

	Ok(result)
}

#[tauri::command]
pub fn project_overlay_undo_history(
	root_folder: String,
	undo_history_limit: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<Vec<OverlayUndoHistoryEntry>, String> {
	let undo_history_limit = validate_undo_history_limit(undo_history_limit)?;
	let root = canonicalize_existing(Path::new(&root_folder))?;
	let mut histories = undo_state
		.histories
		.lock()
		.map_err(|_| "O estado de desfazer ficou indisponível.".to_string())?;
	let Some(history) = histories.get_mut(&root) else {
		return Ok(Vec::new());
	};

	trim_undo_history(
		history,
		undo_history_limit,
	);

	Ok(history
		.iter()
		.rev()
		.enumerate()
		.map(|(index, snapshot)| {
			let added_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Created) &&
						file.applied_fingerprint.is_some()
				})
				.count();
			let replaced_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Replaced { .. }) &&
						file.applied_fingerprint.is_some()
				})
				.count();
			let deleted_files = snapshot
				.files
				.iter()
				.filter(|file| {
					matches!(&file.kind, UndoFileKind::Replaced { .. }) &&
						file.applied_fingerprint.is_none()
				})
				.count();

			OverlayUndoHistoryEntry {
				steps: index + 1,
				added_files,
				replaced_files,
				deleted_files,
				applied_at_unix_ms: snapshot.applied_at_unix_ms,
			}
		})
		.collect())
}

struct UndoSequenceExecution {
	restored_files: usize,
	removed_files: usize,
	completed_batches: usize,
	error: Option<String>,
}

fn validate_undo_sequence(
	root_folder: &str,
	snapshots: &[UndoSnapshot],
) -> Result<(), String> {
	let root = canonicalize_existing(Path::new(root_folder))?;
	let mut virtual_states = HashMap::<PathBuf, Option<FileFingerprint>>::new();

	for snapshot in snapshots.iter().rev() {
		if snapshot.root != root {
			return Err(
				"Uma das aplicações do histórico pertence a outra pasta do projeto.".to_string(),
			);
		}

		for file in &snapshot.files {
			let is_virtual = virtual_states.contains_key(&file.destination_relative_path);
			let current_state = match virtual_states.get(&file.destination_relative_path) {
				Some(state) => *state,
				None => {
					let exists = validate_destination_entry(
						&root,
						&file.destination_relative_path,
						false,
					)?;

					if exists {
						Some(file_fingerprint(&root.join(&file.destination_relative_path))?)
					} else {
						None
					}
				}
			};

			if current_state != file.applied_fingerprint {
				return Err(match (file.applied_fingerprint, current_state) {
					(None, Some(_)) => format!(
						"Não é seguro desfazer: {} foi recriado depois da aplicação.",
						normalize_relative_display(&file.destination_relative_path),
					),
					(Some(_), _) => format!(
						"Não é seguro desfazer: {} foi alterado depois da aplicação.",
						normalize_relative_display(&file.destination_relative_path),
					),
					(None, None) => unreachable!(),
				});
			}

			if !is_virtual && current_state.is_some() {
				OpenOptions::new()
					.write(true)
					.open(root.join(&file.destination_relative_path))
					.map_err(|error| {
						format!(
							"Não é seguro desfazer enquanto {} não puder ser alterado: {error}",
							normalize_relative_display(&file.destination_relative_path),
						)
					})?;
			}

			let state_after_undo = match &file.kind {
				UndoFileKind::Created => None,
				UndoFileKind::Replaced { backup_path } => {
					if !backup_path.is_file() {
						return Err(format!(
							"O snapshot necessário para restaurar {} não está mais disponível.",
							normalize_relative_display(&file.destination_relative_path),
						));
					}

					Some(file_fingerprint(backup_path)?)
				}
			};

			virtual_states.insert(
				file.destination_relative_path.clone(),
				state_after_undo,
			);
		}
	}

	Ok(())
}

fn undo_project_overlays_blocking(
	root_folder: String,
	snapshots: &[UndoSnapshot],
) -> UndoSequenceExecution {
	let mut restored_files = 0_usize;
	let mut removed_files = 0_usize;
	let mut completed_batches = 0_usize;

	if let Err(error) = validate_undo_sequence(
		&root_folder,
		snapshots,
	) {
		return UndoSequenceExecution {
			restored_files,
			removed_files,
			completed_batches,
			error: Some(error),
		};
	}

	for snapshot in snapshots.iter().rev() {
		match undo_project_overlay_blocking(
			root_folder.clone(),
			snapshot,
		) {
			Ok(result) => {
				restored_files += result.restored_files;
				removed_files += result.removed_files;
				completed_batches += 1;
			}
			Err(error) => {
				return UndoSequenceExecution {
					restored_files,
					removed_files,
					completed_batches,
					error: Some(error),
				};
			}
		}
	}

	UndoSequenceExecution {
		restored_files,
		removed_files,
		completed_batches,
		error: None,
	}
}

#[tauri::command]
pub async fn undo_project_overlay(
	root_folder: String,
	steps: usize,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<UndoProjectOverlayResult, String> {
	if steps == 0 || steps > MAX_UNDO_HISTORY_ENTRIES {
		return Err(format!(
			"A quantidade de aplicações para desfazer deve ficar entre 1 e {MAX_UNDO_HISTORY_ENTRIES}.",
		));
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;
	let snapshots = {
		let mut histories = undo_state
			.histories
			.lock()
			.map_err(|_| "O estado de desfazer ficou indisponível.".to_string())?;
		let history = histories
			.get_mut(&root)
			.ok_or_else(|| "Não há aplicações no histórico deste projeto para desfazer.".to_string())?;

		if history.len() < steps {
			return Err("Não há aplicações suficientes no histórico para desfazer.".to_string());
		}

		let start = history.len() - steps;
		history.split_off(start)
	};
	let snapshots_for_task = snapshots.clone();
	let execution = tauri::async_runtime::spawn_blocking(move || {
		undo_project_overlays_blocking(
			root_folder,
			&snapshots_for_task,
		)
	})
	.await;

	match execution {
		Ok(execution) => {
			let completed_start = snapshots.len() - execution.completed_batches;

			for snapshot in snapshots[completed_start..].iter().cloned() {
				discard_snapshot(snapshot);
			}

			let mut histories = undo_state
				.histories
				.lock()
				.map_err(|_| "O estado de desfazer ficou indisponível.".to_string())?;
			let history = histories.entry(root.clone()).or_default();
			history.extend(snapshots[..completed_start].iter().cloned());
			let remaining_history_entries = history.len();

			if let Some(error) = execution.error {
				if execution.completed_batches > 0 {
					return Err(format!(
						"{error} {completed} aplicação(ões) mais recente(s) já foram desfeitas antes da falha.",
						completed = execution.completed_batches,
					));
				}

				return Err(error);
			}

			Ok(UndoProjectOverlayResult {
				restored_files: execution.restored_files,
				removed_files: execution.removed_files,
				undone_batches: execution.completed_batches,
				remaining_history_entries,
			})
		}
		Err(error) => {
			let mut histories = undo_state
				.histories
				.lock()
				.map_err(|_| "O estado de desfazer ficou indisponível.".to_string())?;
			histories
				.entry(root)
				.or_default()
				.extend(snapshots);
			Err(format!("O desfazer foi interrompido: {error}"))
		}
	}
}

#[tauri::command]
pub fn discard_project_overlay_undo(
	root_folder: String,
	undo_state: State<'_, OverlayUndoState>,
) -> Result<(), String> {
	let requested_root = PathBuf::from(&root_folder);
	let canonical_root = canonicalize_existing(&requested_root).ok();
	let snapshots = {
		let mut histories = undo_state
			.histories
			.lock()
			.map_err(|_| "O estado de desfazer ficou indisponível.".to_string())?;
		let requested_key = root_lookup_key(&requested_root);
		let matching_root = canonical_root
			.as_ref()
			.and_then(|root| histories.contains_key(root).then(|| root.clone()))
			.or_else(|| {
				histories
					.keys()
					.find(|root| root_lookup_key(root) == requested_key)
					.cloned()
			});

		matching_root
			.and_then(|root| histories.remove(&root))
			.unwrap_or_default()
	};

	for snapshot in snapshots {
		discard_snapshot(snapshot);
	}

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write as _;
	use zip::{write::SimpleFileOptions, ZipWriter};

	struct TestDirectory {
		path: PathBuf,
	}

	impl TestDirectory {
		fn new() -> Self {
			let identifier = SystemTime::now()
				.duration_since(UNIX_EPOCH)
				.expect("test clock should be valid")
				.as_nanos();
			let path = std::env::temp_dir().join(format!(
				"orqeto-dev-overlay-test-{}-{identifier}",
				std::process::id(),
			));

			fs::create_dir_all(&path).expect("test directory should be created");
			Self { path }
		}
	}

	impl Drop for TestDirectory {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.path);
		}
	}

	fn write_test_file(
		path: &Path,
		content: &str,
	) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).expect("test parent directory should be created");
		}

		fs::write(
			path,
			content,
		)
		.expect("test file should be written");
	}

	fn write_test_zip(
		path: &Path,
		entries: &[(&str, &str)],
	) {
		let file = File::create(path).expect("test zip should be created");
		let mut archive = ZipWriter::new(file);

		for (name, content) in entries {
			archive
				.start_file(
					*name,
					SimpleFileOptions::default(),
				)
				.expect("test zip entry should be started");
			archive
				.write_all(content.as_bytes())
				.expect("test zip entry should be written");
		}

		archive.finish().expect("test zip should be finalized");
	}

	#[test]
	fn long_directory_overlay_keeps_every_nested_file() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let source_root = test_directory
			.path
			.join("patch")
			.join("apis")
			.join("api")
			.join("source");
		let project_destination = project_root
			.join("apps")
			.join("api")
			.join("source");

		fs::create_dir_all(project_destination.join("modules/flow"))
			.expect("project destination should be created");
		write_test_file(
			&source_root.join("main.ts"),
			"main",
		);
		for (name, content) in [
			("factory.ts", "factory"),
			("module.ts", "module"),
			("service.ts", "service"),
			("types.ts", "types"),
		] {
			write_test_file(
				&source_root.join("modules/flow").join(name),
				content,
			);
		}

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
		)
		.expect("overlay should be prepared");

		assert_eq!(prepared.file_count, 5);
		let recommended_index = prepared
			.recommended_candidate_index
			.expect("long source path should resolve to the existing project branch");
		let candidate = prepared
			.candidates
			.get(recommended_index)
			.expect("recommended candidate should exist")
			.clone();
		assert_eq!(candidate.destination_relative_path, "./apps/api/source");

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![source_root.to_string_lossy().into_owned()],
			candidate.destination_relative_path,
			candidate.source_prefix,
		)
		.expect("overlay should be applied");

		assert_eq!(result.added_files, 5);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 0);
		assert_eq!(
			fs::read_to_string(project_destination.join("main.ts"))
				.expect("main file should exist"),
			"main",
		);
		for (name, content) in [
			("factory.ts", "factory"),
			("module.ts", "module"),
			("service.ts", "service"),
			("types.ts", "types"),
		] {
			assert_eq!(
				fs::read_to_string(project_destination.join("modules/flow").join(name))
					.expect("nested file should exist"),
				content,
			);
		}

		discard_snapshot(snapshot);
	}

	#[test]
	fn undo_history_respects_configured_limit_and_merges_one_drop() {
		let test_directory = TestDirectory::new();
		let root = test_directory.path.join("project");
		fs::create_dir_all(&root).expect("project root should be created");
		let mut history = Vec::new();

		for index in 0..=MAX_UNDO_HISTORY_ENTRIES {
			record_undo_snapshot(
				&mut history,
				UndoSnapshot {
					root: root.clone(),
					backup_directories: Vec::new(),
					files: Vec::new(),
					created_directories: Vec::new(),
					applied_at_unix_ms: index as u64,
				},
				false,
				10,
			);
		}

		assert_eq!(history.len(), 10);
		assert_eq!(history[0].applied_at_unix_ms, 91);

		record_undo_snapshot(
			&mut history,
			UndoSnapshot {
				root: root.clone(),
				backup_directories: Vec::new(),
				files: Vec::new(),
				created_directories: Vec::new(),
				applied_at_unix_ms: 99,
			},
			true,
			10,
		);

		assert_eq!(history.len(), 10);
		let latest = history.last().expect("latest history entry should exist");
		assert_eq!(latest.applied_at_unix_ms, 99);

		for snapshot in history {
			discard_snapshot(snapshot);
		}
	}

	#[test]
	fn multi_undo_restores_sequential_replacements_to_original_state() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let first_patch = test_directory.path.join("first/state.ts");
		let second_patch = test_directory.path.join("second/state.ts");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("state.ts"),
			"original",
		);
		write_test_file(
			&first_patch,
			"first",
		);
		write_test_file(
			&second_patch,
			"second",
		);

		let (_, first_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![first_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("first overlay should be applied");
		let (_, second_snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![second_patch.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("second overlay should be applied");
		let snapshots = vec![first_snapshot, second_snapshot];

		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("latest file should exist"),
			"second",
		);

		let execution = undo_project_overlays_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshots,
		);

		assert!(execution.error.is_none());
		assert_eq!(execution.completed_batches, 2);
		assert_eq!(execution.restored_files, 2);
		assert_eq!(execution.removed_files, 0);
		assert_eq!(
			fs::read_to_string(project_root.join("state.ts"))
				.expect("original file should be restored"),
			"original",
		);

		for snapshot in snapshots {
			discard_snapshot(snapshot);
		}
	}

	#[test]
	fn zip_delete_manifest_deletes_files_and_participates_in_undo() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("patch.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/old.ts"),
			"old",
		);
		write_test_zip(
			&archive_path,
			&[
				(
					DELETE_MANIFEST_FILE_NAME,
					"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/old.ts\"]}",
				),
				("src/new.ts", "new"),
			],
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("zip overlay should be prepared");

		assert_eq!(prepared.file_count, 1);
		assert_eq!(prepared.delete_count, 1);

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("zip overlay should be applied");

		assert_eq!(result.added_files, 1);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/old.ts").exists());
		assert_eq!(
			fs::read_to_string(project_root.join("src/new.ts"))
				.expect("new file should exist"),
			"new",
		);
		assert!(!project_root.join(DELETE_MANIFEST_FILE_NAME).exists());

		let undo = undo_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			&snapshot,
		)
		.expect("overlay should be undoable");

		assert_eq!(undo.restored_files, 1);
		assert_eq!(undo.removed_files, 1);
		assert_eq!(
			fs::read_to_string(project_root.join("src/old.ts"))
				.expect("deleted file should be restored"),
			"old",
		);
		assert!(!project_root.join("src/new.ts").exists());
		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_only_zip_is_valid() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("delete-only.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/obsolete.ts"),
			"obsolete",
		);
		write_test_zip(
			&archive_path,
			&[(
				DELETE_MANIFEST_FILE_NAME,
				"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/obsolete.ts\"]}",
			)],
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.expect("delete-only overlay should be prepared");

		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 1);
		assert_eq!(prepared.recommended_candidate_index, Some(0));

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("delete-only overlay should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/obsolete.ts").exists());

		discard_snapshot(snapshot);
	}

	#[test]
	fn standalone_delete_manifest_is_applied_as_delete_only_item() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let manifest_path = test_directory.path.join(DELETE_MANIFEST_FILE_NAME);

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/obsolete.ts"),
			"obsolete",
		);
		write_test_file(
			&manifest_path,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/obsolete.ts\"]}",
		);

		let prepared = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
		)
		.expect("standalone delete manifest should be prepared");

		assert_eq!(prepared.file_count, 0);
		assert_eq!(prepared.delete_count, 1);
		assert_eq!(prepared.recommended_candidate_index, Some(0));

		let (result, snapshot) = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![manifest_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.expect("standalone delete manifest should be applied");

		assert_eq!(result.added_files, 0);
		assert_eq!(result.replaced_files, 0);
		assert_eq!(result.deleted_files, 1);
		assert!(!project_root.join("src/obsolete.ts").exists());

		discard_snapshot(snapshot);
	}

	#[test]
	fn delete_manifest_rejects_missing_project_file() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("invalid-delete.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_zip(
			&archive_path,
			&[(
				DELETE_MANIFEST_FILE_NAME,
				"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/missing.ts\"]}",
			)],
		);

		let error = prepare_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
		)
		.err()
		.expect("missing deletion target should be rejected");

		assert!(error.contains("não existe no projeto"));
	}

	#[test]
	fn delete_manifest_rejects_invalid_format_and_traversal() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");

		fs::create_dir_all(&project_root).expect("project root should be created");

		let invalid_format = parse_delete_manifest_content(
			&project_root,
			"{\"format\":\"other\",\"version\":1,\"delete\":[]}",
		)
		.err()
		.expect("wrong manifest format should be rejected");
		assert!(invalid_format.contains("identificação de formato"));

		let traversal = parse_delete_manifest_content(
			&project_root,
			"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"../outside.ts\"]}",
		)
		.err()
		.expect("path traversal should be rejected");
		assert!(traversal.contains("fora do formato esperado"));
	}

	#[test]
	fn delete_manifest_rejects_apply_delete_conflict() {
		let test_directory = TestDirectory::new();
		let project_root = test_directory.path.join("project");
		let archive_path = test_directory.path.join("conflict.zip");

		fs::create_dir_all(&project_root).expect("project root should be created");
		write_test_file(
			&project_root.join("src/same.ts"),
			"old",
		);
		write_test_zip(
			&archive_path,
			&[
				(
					DELETE_MANIFEST_FILE_NAME,
					"{\"format\":\"orqeto-dev-delete\",\"version\":1,\"delete\":[\"src/same.ts\"]}",
				),
				("src/same.ts", "new"),
			],
		);

		let error = apply_project_overlay_blocking(
			project_root.to_string_lossy().into_owned(),
			vec![archive_path.to_string_lossy().into_owned()],
			"./".to_string(),
			String::new(),
		)
		.err()
		.expect("same file cannot be applied and deleted");

		assert!(error.contains("aplicar e excluir o mesmo arquivo"));
		assert_eq!(
			fs::read_to_string(project_root.join("src/same.ts"))
				.expect("project file should be untouched"),
			"old",
		);
	}
}
