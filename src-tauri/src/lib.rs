mod external_integration;
mod native_drop;
mod overlay;
mod project_ignore;

use crate::project_ignore::ProjectIgnore;
use serde::Serialize;
use std::{
	collections::HashSet,
	fs,
	path::{Path, PathBuf},
	process::Command,
};
#[cfg(target_os = "windows")]
use std::{os::windows::process::CommandExt, process::Stdio};
use tauri::{path::BaseDirectory, AppHandle, Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:orqeto-dev.db";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedFile {
	relative_path: String,
	content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkippedFile {
	relative_path: String,
	reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessDropResult {
	files: Vec<GeneratedFile>,
	skipped_files: Vec<SkippedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextRemovalPath {
	relative_path: String,
	is_directory: bool,
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
	fs::canonicalize(path)
		.map_err(|error| format!("Não foi possível acessar {}: {error}", path.display()))
}

fn ensure_inside_root(
	root: &Path,
	path: &Path,
) -> Result<(), String> {
	if path.starts_with(root) {
		return Ok(());
	}

	Err(format!(
		"O item {} não faz parte da pasta do projeto.",
		path.display(),
	))
}

fn collect_files(
	root: &Path,
	current: &Path,
	project_ignore: &ProjectIgnore,
	visited_directories: &mut HashSet<PathBuf>,
	files: &mut Vec<PathBuf>,
) -> Result<(), String> {
	let canonical_path = canonicalize_existing(current)?;

	ensure_inside_root(
		root,
		&canonical_path,
	)?;

	let metadata = fs::metadata(&canonical_path)
		.map_err(|error| format!("Não foi possível ler {}: {error}", canonical_path.display()))?;

	if project_ignore.is_ignored(
		&canonical_path,
		metadata.is_dir(),
	) {
		return Ok(());
	}

	if metadata.is_file() {
		files.push(canonical_path);
		return Ok(());
	}

	if !metadata.is_dir() {
		return Err(format!(
			"O item {} não é um arquivo nem uma pasta suportada.",
			canonical_path.display(),
		));
	}

	if !visited_directories.insert(canonical_path.clone()) {
		return Ok(());
	}

	let mut entries = fs::read_dir(&canonical_path)
		.map_err(|error| format!("Não foi possível listar {}: {error}", canonical_path.display()))?
		.map(|entry| {
			entry
				.map(|value| value.path())
				.map_err(|error| format!("Não foi possível ler uma entrada da pasta: {error}"))
		})
		.collect::<Result<Vec<_>, _>>()?;

	entries.sort();

	for entry in entries {
		collect_files(
			root,
			&entry,
			project_ignore,
			visited_directories,
			files,
		)?;
	}

	Ok(())
}

fn decode_utf16(
	bytes: &[u8],
	little_endian: bool,
) -> Result<String, String> {
	if bytes.len() % 2 != 0 {
		return Err("O arquivo UTF-16 possui tamanho inválido.".to_string());
	}

	let code_units = bytes
		.chunks_exact(2)
		.map(|chunk| {
			let pair = [chunk[0], chunk[1]];

			if little_endian {
				u16::from_le_bytes(pair)
			} else {
				u16::from_be_bytes(pair)
			}
		})
		.collect::<Vec<_>>();

	String::from_utf16(&code_units)
		.map_err(|_| "O arquivo contém uma sequência UTF-16 inválida.".to_string())
}

fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
	let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
		String::from_utf8(bytes[3..].to_vec())
			.map_err(|_| "O arquivo não contém texto UTF-8 válido.".to_string())?
	} else if bytes.starts_with(&[0xFF, 0xFE]) {
		decode_utf16(
			&bytes[2..],
			true,
		)?
	} else if bytes.starts_with(&[0xFE, 0xFF]) {
		decode_utf16(
			&bytes[2..],
			false,
		)?
	} else {
		String::from_utf8(bytes)
			.map_err(|_| "O arquivo não contém texto UTF-8 válido.".to_string())?
	};

	if content.contains('\0') {
		return Err("O arquivo parece ser binário e foi ignorado.".to_string());
	}

	Ok(content)
}

fn relative_path(
	root: &Path,
	path: &Path,
) -> Result<String, String> {
	let relative = path
		.strip_prefix(root)
		.map_err(|_| "Não foi possível calcular o caminho relativo do arquivo.".to_string())?;
	let normalized = relative
		.to_string_lossy()
		.replace('\\', "/");

	Ok(format!("./{normalized}"))
}

#[tauri::command]
fn folder_exists(path: String) -> bool {
	Path::new(&path).is_dir()
}

fn canonical_project_roots(root_folders: &[String]) -> Vec<Option<PathBuf>> {
	root_folders
		.iter()
		.map(|root_folder| {
			canonicalize_existing(Path::new(root_folder))
				.ok()
				.filter(|root| root.is_dir())
		})
		.collect()
}

#[tauri::command]
fn find_project_for_root(
	root_folders: Vec<String>,
	path: String,
) -> Result<Option<usize>, String> {
	let requested = canonicalize_existing(Path::new(&path))?;

	if !requested.is_dir() {
		return Ok(None);
	}

	Ok(canonical_project_roots(&root_folders)
		.into_iter()
		.position(|root| root.is_some_and(|root| root == requested)))
}

#[tauri::command]
fn find_project_for_paths(
	root_folders: Vec<String>,
	paths: Vec<String>,
) -> Result<Option<usize>, String> {
	if paths.is_empty() {
		return Ok(None);
	}

	let canonical_paths = paths
		.iter()
		.map(|path| canonicalize_existing(Path::new(path)))
		.collect::<Result<Vec<_>, _>>()?;
	let roots = canonical_project_roots(&root_folders);
	let mut best_match: Option<(usize, usize)> = None;

	for (index, root) in roots.into_iter().enumerate() {
		let Some(root) = root else {
			continue;
		};

		if !canonical_paths.iter().all(|path| path.starts_with(&root)) {
			continue;
		}

		let depth = root.components().count();

		if best_match.is_none_or(|(_, best_depth)| depth > best_depth) {
			best_match = Some((index, depth));
		}
	}

	Ok(best_match.map(|(index, _)| index))
}

#[cfg(target_os = "windows")]
const WINDOWS_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn vscode_cli_candidates() -> Vec<PathBuf> {
	let mut candidates = Vec::new();

	if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
		let install_root = PathBuf::from(local_app_data)
			.join("Programs")
			.join("Microsoft VS Code");

		candidates.push(install_root.join("bin").join("code.cmd"));
	}

	for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
		if let Some(program_files) = std::env::var_os(variable) {
			let install_root = PathBuf::from(program_files)
				.join("Microsoft VS Code");

			candidates.push(install_root.join("bin").join("code.cmd"));
		}
	}

	candidates.push(PathBuf::from("code.cmd"));

	let mut seen = HashSet::new();
	candidates.retain(|candidate| seen.insert(candidate.clone()));
	candidates
}

#[cfg(target_os = "windows")]
fn install_vscode_extension_blocking(vsix_path: &Path) -> Result<(), String> {
	let mut last_error: Option<String> = None;

	for cli_path in vscode_cli_candidates() {
		let output = Command::new(&cli_path)
			.arg("--install-extension")
			.arg(vsix_path)
			.arg("--force")
			.stdin(Stdio::null())
			.creation_flags(WINDOWS_NO_WINDOW)
			.output();

		let output = match output {
			Ok(output) => output,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
			Err(error) => {
				last_error = Some(format!(
					"Não foi possível executar {}: {error}",
					cli_path.display(),
				));
				continue;
			}
		};

		if output.status.success() {
			return Ok(());
		}

		let stderr = String::from_utf8_lossy(&output.stderr);
		let stdout = String::from_utf8_lossy(&output.stdout);
		let details = if !stderr.trim().is_empty() {
			stderr.trim()
		} else {
			stdout.trim()
		};

		last_error = Some(if details.is_empty() {
			format!(
				"O VS Code recusou a instalação da extensão usando {}.",
				cli_path.display(),
			)
		} else {
			format!(
				"O VS Code recusou a instalação da extensão usando {}: {details}",
				cli_path.display(),
			)
		});
	}

	Err(last_error.unwrap_or_else(|| {
		"Não foi possível localizar uma instalação do Visual Studio Code.".to_string()
	}))
}

#[cfg(not(target_os = "windows"))]
fn install_vscode_extension_blocking(_vsix_path: &Path) -> Result<(), String> {
	Err("A instalação automática da extensão do VS Code está disponível apenas no Windows.".to_string())
}

#[tauri::command]
async fn install_vscode_extension(app: AppHandle) -> Result<(), String> {
	let vsix_path = app
		.path()
		.resolve(
			"vscode/orqeto-dev-vscode.vsix",
			BaseDirectory::Resource,
		)
		.map_err(|error| format!("Não foi possível localizar a extensão empacotada: {error}"))?;

	if !vsix_path.is_file() {
		return Err("A extensão do VS Code não foi encontrada no pacote do Orqeto Dev.".to_string());
	}

	tauri::async_runtime::spawn_blocking(move || install_vscode_extension_blocking(&vsix_path))
		.await
		.map_err(|error| format!("A instalação da extensão foi interrompida: {error}"))?
}

#[cfg(target_os = "windows")]
const WINDOWS_OPEN_OR_FOCUS_EXPLORER_SCRIPT: &str = r#"
$ErrorActionPreference = "Stop"
$requested = $env:ORQETO_DEV_EXPLORER_PATH
$target = [System.IO.Path]::GetFullPath($requested).TrimEnd([char]92)
$shell = New-Object -ComObject Shell.Application
$windows = $shell.Windows()
$match = $null

for ($index = 0; $index -lt $windows.Count; $index++) {
	$candidate = $windows.Item($index)

	try {
		$candidatePath = [System.IO.Path]::GetFullPath([string]$candidate.Document.Folder.Self.Path).TrimEnd([char]92)

		if ($candidatePath -ieq $target) {
			$match = $candidate
			break
		}
	} catch {}
}

if ($null -ne $match) {
	if (-not ("OrqetoDev.NativeWindow" -as [type])) {
		Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace OrqetoDev {
	public static class NativeWindow {
		[DllImport("user32.dll")]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool IsIconic(IntPtr hWnd);

		[DllImport("user32.dll")]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

		[DllImport("user32.dll")]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool SetForegroundWindow(IntPtr hWnd);
	}
}
"@
	}

	$handle = [IntPtr][long]$match.HWND

	if ([OrqetoDev.NativeWindow]::IsIconic($handle)) {
		[OrqetoDev.NativeWindow]::ShowWindowAsync($handle, 9) | Out-Null
	}

	[OrqetoDev.NativeWindow]::SetForegroundWindow($handle) | Out-Null
	exit 0
}

$shell.Explore($requested)
"#;

#[cfg(target_os = "windows")]
const WINDOWS_CLOSE_EXPLORER_SCRIPT: &str = r#"
$ErrorActionPreference = "Stop"
$target = [System.IO.Path]::GetFullPath($env:ORQETO_DEV_EXPLORER_PATH).TrimEnd([char]92)
$shell = New-Object -ComObject Shell.Application
$windows = $shell.Windows()

for ($index = $windows.Count - 1; $index -ge 0; $index--) {
	$candidate = $windows.Item($index)

	try {
		$candidatePath = [System.IO.Path]::GetFullPath([string]$candidate.Document.Folder.Self.Path).TrimEnd([char]92)

		if ($candidatePath -ieq $target) {
			$candidate.Quit()
		}
	} catch {}
}
"#;

#[cfg(target_os = "windows")]
fn run_windows_explorer_script(
	path: &Path,
	script: &str,
) -> Result<(), String> {
	let output = Command::new("powershell.exe")
		.args([
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-WindowStyle",
			"Hidden",
			"-Command",
			script,
		])
		.env(
			"ORQETO_DEV_EXPLORER_PATH",
			path,
		)
		.stdin(Stdio::null())
		.creation_flags(WINDOWS_NO_WINDOW)
		.output()
		.map_err(|error| format!("Não foi possível controlar o Explorer: {error}"))?;

	if output.status.success() {
		return Ok(());
	}

	let stderr = String::from_utf8_lossy(&output.stderr);
	let details = stderr.trim();

	if details.is_empty() {
		return Err("O Windows não conseguiu controlar a janela do Explorer.".to_string());
	}

	Err(format!("O Windows não conseguiu controlar a janela do Explorer: {details}"))
}

#[cfg(target_os = "windows")]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	run_windows_explorer_script(
		path,
		WINDOWS_OPEN_OR_FOCUS_EXPLORER_SCRIPT,
	)
}

#[cfg(target_os = "macos")]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	Command::new("open")
		.arg(path)
		.spawn()
		.map_err(|error| format!("Não foi possível abrir o explorador de arquivos: {error}"))?;

	Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	Command::new("xdg-open")
		.arg(path)
		.spawn()
		.map_err(|error| format!("Não foi possível abrir o explorador de arquivos: {error}"))?;

	Ok(())
}

#[cfg(target_os = "windows")]
fn close_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	run_windows_explorer_script(
		path,
		WINDOWS_CLOSE_EXPLORER_SCRIPT,
	)
}

#[cfg(not(target_os = "windows"))]
fn close_folder_in_explorer_blocking(_path: &Path) -> Result<(), String> {
	Ok(())
}

#[tauri::command]
async fn open_folder_in_explorer(path: String) -> Result<(), String> {
	let folder = PathBuf::from(path);

	if !folder.is_dir() {
		return Err("A pasta configurada não existe mais.".to_string());
	}

	tauri::async_runtime::spawn_blocking(move || open_folder_in_explorer_blocking(&folder))
		.await
		.map_err(|error| format!("A abertura do Explorer foi interrompida: {error}"))?
}

#[tauri::command]
async fn close_folder_in_explorer(path: String) -> Result<(), String> {
	let folder = PathBuf::from(path);

	tauri::async_runtime::spawn_blocking(move || close_folder_in_explorer_blocking(&folder))
		.await
		.map_err(|error| format!("O fechamento do Explorer foi interrompido: {error}"))?
}

fn process_drop_blocking(
	root_folder: String,
	paths: Vec<String>,
	paths_only: bool,
) -> Result<ProcessDropResult, String> {
	if paths.is_empty() {
		return Ok(ProcessDropResult {
			files: Vec::new(),
			skipped_files: Vec::new(),
		});
	}

	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("A pasta configurada não existe mais.".to_string());
	}

	let project_ignore = ProjectIgnore::load(&root)?;
	let mut collected_files = Vec::new();
	let mut visited_directories = HashSet::new();

	let mut dropped_paths = paths
		.into_iter()
		.map(PathBuf::from)
		.collect::<Vec<_>>();

	dropped_paths.sort();

	for dropped_path in dropped_paths {
		collect_files(
			&root,
			&dropped_path,
			&project_ignore,
			&mut visited_directories,
			&mut collected_files,
		)?;
	}

	collected_files.sort();
	collected_files.dedup();

	let mut generated_files = Vec::new();
	let mut skipped_files = Vec::new();

	for file_path in collected_files {
		let relative_path = relative_path(
			&root,
			&file_path,
		)?;
		let is_zip = file_path
			.extension()
			.and_then(|extension| extension.to_str())
			.is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));

		if is_zip {
			skipped_files.push(SkippedFile {
				relative_path,
				reason: "Arquivos ZIP não entram no contexto. Use a área Aplicar código.".to_string(),
			});
			continue;
		}

		if paths_only {
			generated_files.push(GeneratedFile {
				relative_path,
				content: None,
			});
			continue;
		}

		let bytes = fs::read(&file_path)
			.map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;

		match decode_text(bytes) {
			Ok(content) => generated_files.push(GeneratedFile {
				relative_path,
				content: Some(content),
			}),
			Err(reason) => skipped_files.push(SkippedFile {
				relative_path,
				reason,
			}),
		}
	}

	Ok(ProcessDropResult {
		files: generated_files,
		skipped_files,
	})
}

#[tauri::command]
async fn process_drop(
	root_folder: String,
	paths: Vec<String>,
	paths_only: bool,
) -> Result<ProcessDropResult, String> {
	tauri::async_runtime::spawn_blocking(move || {
		process_drop_blocking(
			root_folder,
			paths,
			paths_only,
		)
	})
	.await
	.map_err(|error| format!("A leitura dos arquivos foi interrompida: {error}"))?
}

fn resolve_context_removal_paths_blocking(
	root_folder: String,
	paths: Vec<String>,
) -> Result<Vec<ContextRemovalPath>, String> {
	let root = canonicalize_existing(Path::new(&root_folder))?;

	if !root.is_dir() {
		return Err("A pasta configurada não existe mais.".to_string());
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
			.map_err(|error| format!("Não foi possível ler {}: {error}", path.display()))?;

		if !metadata.is_file() && !metadata.is_dir() {
			return Err(format!(
				"O item {} não é um arquivo nem uma pasta suportada.",
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
) -> Result<Vec<ContextRemovalPath>, String> {
	tauri::async_runtime::spawn_blocking(move || {
		resolve_context_removal_paths_blocking(
			root_folder,
			paths,
		)
	})
	.await
	.map_err(|error| format!("A validação dos caminhos foi interrompida: {error}"))?
}

#[tauri::command]
async fn write_export_file(
	path: String,
	content: String,
) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || {
		fs::write(
			&path,
			content,
		)
		.map_err(|error| format!("Não foi possível salvar o arquivo: {error}"))
	})
	.await
	.map_err(|error| format!("A gravação do arquivo foi interrompida: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let migrations = vec![
		Migration {
			version: 1,
			description: "create_app_settings",
			sql: "
				CREATE TABLE IF NOT EXISTS app_settings (
					key TEXT PRIMARY KEY NOT NULL,
					value TEXT NOT NULL
				);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 2,
			description: "create_context_filter_history",
			sql: "
				CREATE TABLE IF NOT EXISTS context_filter_history (
					root_folder TEXT NOT NULL,
					pattern TEXT NOT NULL,
					target TEXT NOT NULL,
					mode TEXT NOT NULL,
					last_used_at INTEGER NOT NULL,
					PRIMARY KEY (root_folder, pattern, target, mode)
				);

				CREATE INDEX IF NOT EXISTS context_filter_history_recent
				ON context_filter_history (root_folder, last_used_at DESC);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 3,
			description: "create_project_tabs",
			sql: "
				CREATE TABLE IF NOT EXISTS project_tabs (
					id TEXT PRIMARY KEY NOT NULL,
					root_folder TEXT,
					position INTEGER NOT NULL
				);

				CREATE UNIQUE INDEX IF NOT EXISTS project_tabs_root_unique
					ON project_tabs (root_folder);

				INSERT OR IGNORE INTO project_tabs (id, root_folder, position)
				SELECT 'legacy-root', value, 0
				FROM app_settings
				WHERE key = 'root_folder';

				DELETE FROM app_settings WHERE key = 'root_folder';
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 4,
			description: "create_context_export_history",
			sql: "
				CREATE TABLE IF NOT EXISTS context_export_history (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					root_folder TEXT NOT NULL,
					content TEXT NOT NULL,
					file_count INTEGER NOT NULL,
					byte_count INTEGER NOT NULL,
					created_at INTEGER NOT NULL
				);

				CREATE INDEX IF NOT EXISTS context_export_history_recent
					ON context_export_history (root_folder, created_at DESC, id DESC);
			",
			kind: MigrationKind::Up,
		},
		Migration {
			version: 5,
			description: "persist_project_section_expansion",
			sql: "
				ALTER TABLE project_tabs
					ADD COLUMN folder_section_expanded INTEGER NOT NULL DEFAULT 1;
				ALTER TABLE project_tabs
					ADD COLUMN context_section_expanded INTEGER NOT NULL DEFAULT 1;
				ALTER TABLE project_tabs
					ADD COLUMN apply_section_expanded INTEGER NOT NULL DEFAULT 1;
			",
			kind: MigrationKind::Up,
		},
	];

	let builder = tauri::Builder::default()
		.manage(external_integration::PendingExternalActions::from_current_process())
		.manage(overlay::OverlayUndoState::new())
		.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
			external_integration::handle_second_instance(
				app,
				&args,
			)
		}))
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_clipboard_manager::init())
		.plugin(
			tauri_plugin_sql::Builder::default()
				.add_migrations(
					DATABASE_URL,
					migrations,
				)
				.build(),
		)
		.setup(|app| {
			if external_integration::is_forward_only_process() {
				app.handle().cleanup_before_exit();
				std::process::exit(0);
			}

			if let Err(error) = external_integration::register_system_integrations() {
				eprintln!("{error}");
			}

			if let Some(window) = app.get_webview_window("main") {
				if let Err(error) = native_drop::install(&window) {
					eprintln!("{error}");
				}

				let native_window = window.clone();
				window.on_window_event(move |event| {
					if matches!(
						event,
						WindowEvent::Focused(true) | WindowEvent::Resized(_)
					) {
						let _ = native_drop::refresh(&native_window);
					}
				});
			}

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			external_integration::peek_external_actions,
			external_integration::take_external_actions,
			folder_exists,
			find_project_for_root,
			find_project_for_paths,
			open_folder_in_explorer,
			close_folder_in_explorer,
			install_vscode_extension,
			native_drop::cleanup_native_drop,
			process_drop,
			resolve_context_removal_paths,
			overlay::prepare_project_overlay,
			overlay::apply_project_overlay,
			overlay::project_overlay_undo_history,
			overlay::undo_project_overlay,
			overlay::discard_project_overlay_undo,
			write_export_file,
		]);

	builder
		.run(tauri::generate_context!())
		.expect("error while running Orqeto Dev");
}
