use serde::Serialize;
use std::path::{Path, PathBuf};

const NATIVE_DROP_EVENT: &str = "native-drag-drop";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DropPosition {
	x: i32,
	y: i32,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum NativeDropEvent {
	Enter {
		position: DropPosition,
	},
	Over {
		position: DropPosition,
	},
	Leave,
	Drop {
		position: DropPosition,
		paths: Vec<String>,
		temporary_root: Option<String>,
	},
}

fn native_drop_base_directory() -> PathBuf {
	std::env::temp_dir()
		.join("orqeto-dev")
		.join("native-drop")
}

#[tauri::command]
pub async fn cleanup_native_drop(path: String) -> Result<(), String> {
	tauri::async_runtime::spawn_blocking(move || cleanup_native_drop_blocking(&path))
		.await
		.map_err(|error| format!("A limpeza do drop temporário foi interrompida: {error}"))?
}

fn cleanup_native_drop_blocking(path: &str) -> Result<(), String> {
	let candidate = Path::new(path);

	if !candidate.exists() {
		return Ok(());
	}

	let canonical_candidate = candidate
		.canonicalize()
		.map_err(|error| format!("Não foi possível validar o drop temporário: {error}"))?;
	let base = native_drop_base_directory();
	let canonical_base = base
		.canonicalize()
		.map_err(|error| format!("Não foi possível validar a pasta temporária do Orqeto Dev: {error}"))?;

	if canonical_candidate == canonical_base || !canonical_candidate.starts_with(&canonical_base) {
		return Err("O caminho solicitado não pertence aos drops temporários do Orqeto Dev.".to_string());
	}

	std::fs::remove_dir_all(&canonical_candidate)
		.map_err(|error| format!("Não foi possível remover o drop temporário: {error}"))
}

#[cfg(target_os = "windows")]
mod windows {
	use super::{
		DropPosition,
		NativeDropEvent,
		NATIVE_DROP_EVENT,
	};
	use std::{
		ffi::{c_void, OsString},
		os::windows::ffi::OsStringExt,
		slice,
		sync::OnceLock,
	};
	use tauri::{
		AppHandle,
		Emitter,
		Manager,
		WebviewWindow,
	};

	const EVENT_ENTER: u32 = 0;
	const EVENT_OVER: u32 = 1;
	const EVENT_LEAVE: u32 = 2;
	const EVENT_DROP: u32 = 3;

	static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

	type NativeDropCallback = unsafe extern "C" fn(
		u32,
		i32,
		i32,
		*const *const u16,
		usize,
		*const u16,
	);

	unsafe extern "C" {
		fn orqeto_native_drop_install(
			parent: *mut c_void,
			callback: NativeDropCallback,
		) -> bool;
		fn orqeto_native_drop_refresh(parent: *mut c_void) -> bool;
	}

	pub fn install(window: &WebviewWindow) -> Result<(), String> {
		let _ = APP_HANDLE.set(window.app_handle().clone());
		let hwnd = window
			.hwnd()
			.map_err(|error| format!("Não foi possível obter a janela nativa: {error}"))?;
		let installed = unsafe {
			orqeto_native_drop_install(
				hwnd.0,
				handle_native_drop,
			)
		};

		if installed {
			Ok(())
		} else {
			Err("O Windows não conseguiu registrar o drop nativo do Orqeto Dev.".to_string())
		}
	}

	pub fn refresh(window: &WebviewWindow) -> Result<(), String> {
		let hwnd = window
			.hwnd()
			.map_err(|error| format!("Não foi possível obter a janela nativa: {error}"))?;
		let refreshed = unsafe { orqeto_native_drop_refresh(hwnd.0) };

		if refreshed {
			Ok(())
		} else {
			Err("O Windows não conseguiu atualizar o drop nativo do Orqeto Dev.".to_string())
		}
	}

	unsafe extern "C" fn handle_native_drop(
		event: u32,
		x: i32,
		y: i32,
		paths: *const *const u16,
		path_count: usize,
		temporary_root: *const u16,
	) {
		let Some(app_handle) = APP_HANDLE.get() else {
			return;
		};
		let position = DropPosition { x, y };
		let payload = match event {
			EVENT_ENTER => NativeDropEvent::Enter { position },
			EVENT_OVER => NativeDropEvent::Over { position },
			EVENT_LEAVE => NativeDropEvent::Leave,
			EVENT_DROP => NativeDropEvent::Drop {
				position,
				paths: read_paths(
					paths,
					path_count,
				),
				temporary_root: read_wide_string(temporary_root),
			},
			_ => return,
		};

		let _ = app_handle.emit(
			NATIVE_DROP_EVENT,
			payload,
		);
	}

	unsafe fn read_paths(
		paths: *const *const u16,
		path_count: usize,
	) -> Vec<String> {
		if paths.is_null() || path_count == 0 {
			return Vec::new();
		}

		slice::from_raw_parts(
			paths,
			path_count,
		)
		.iter()
		.filter_map(|path| read_wide_string(*path))
		.collect()
	}

	unsafe fn read_wide_string(value: *const u16) -> Option<String> {
		if value.is_null() {
			return None;
		}

		let mut length = 0_usize;
		while *value.add(length) != 0 {
			length += 1;
		}

		Some(
			OsString::from_wide(slice::from_raw_parts(
				value,
				length,
			))
			.to_string_lossy()
			.into_owned(),
		)
	}
}

#[cfg(target_os = "windows")]
pub use windows::{
	install,
	refresh,
};

#[cfg(not(target_os = "windows"))]
pub fn install(_window: &tauri::WebviewWindow) -> Result<(), String> {
	Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn refresh(_window: &tauri::WebviewWindow) -> Result<(), String> {
	Ok(())
}
