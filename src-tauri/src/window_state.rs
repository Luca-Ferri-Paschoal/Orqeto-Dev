//! Best-effort restoration of the main window's placement on Windows.
//! This lives outside the project database so a missing/corrupt preference
//! never prevents the normal Tauri window from opening.

#[cfg(target_os = "windows")]
mod windows {
	use serde::{Deserialize, Serialize};
	use std::{
		ffi::c_void,
		fs,
		mem::size_of,
		path::PathBuf,
	};
	use tauri::{Manager, WebviewWindow};
	mod snap;
	use snap::SnappedPlacement;

	const STATE_VERSION: u8 = 1;
	const STATE_FILE: &str = "main-window-placement.json";
	const MAX_STATE_BYTES: u64 = 16 * 1024;
	const SW_SHOWNORMAL: u32 = 1;
	const SW_SHOWMAXIMIZED: u32 = 3;
	const WPF_RESTORETOMAXIMIZED: u32 = 0x0002;

	// GetWindowPlacement/SetWindowPlacement both use *workspace* coordinates,
	// not SetWindowPos screen coordinates. Using the pair avoids taskbar-related
	// position drift, and rcNormalPosition retains the restore bounds even when
	// the user closes a maximized or minimized window.
	#[repr(C)]
	#[derive(Clone, Copy, Default)]
	struct WinPoint {
		x: i32,
		y: i32,
	}
	#[repr(C)]
	#[derive(Clone, Copy, Default)]
	struct WinRect {
		left: i32,
		top: i32,
		right: i32,
		bottom: i32,
	}
	#[repr(C)]
	#[derive(Clone, Copy, Default)]
	struct WindowPlacement {
		length: u32,
		flags: u32,
		show_cmd: u32,
		min_position: WinPoint,
		max_position: WinPoint,
		normal_position: WinRect,
		device: WinRect,
	}

	#[link(name = "user32")]
	unsafe extern "system" {
		fn GetWindowPlacement(hwnd: *mut c_void, placement: *mut WindowPlacement) -> i32;
		fn SetWindowPlacement(hwnd: *mut c_void, placement: *const WindowPlacement) -> i32;
	}

	#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
	struct MonitorBounds {
		x: i32,
		y: i32,
		width: u32,
		height: u32,
		// Compare DPI to avoid restoring physical pixels into a changed scale.
		scale_milli: u32,
	}
	#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
	struct Bounds {
		left: i32,
		top: i32,
		right: i32,
		bottom: i32,
	}
	impl From<WinRect> for Bounds {
		fn from(rect: WinRect) -> Self {
			Self {
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
			}
		}
	}
	impl From<Bounds> for WinRect {
		fn from(rect: Bounds) -> Self {
			Self {
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
			}
		}
	}
	#[derive(Clone, Debug, Deserialize, Serialize)]
	struct SavedPlacement {
		version: u8,
		monitors: Vec<MonitorBounds>,
		normal_position: Bounds,
		maximized: bool,
		// Backwards-compatible with existing version-1 preference files.
		#[serde(default, skip_serializing_if = "Option::is_none")]
		snapped: Option<SnappedPlacement>,
	}
	fn state_path(window: &WebviewWindow) -> Result<PathBuf, String> {
		window
			.app_handle()
			.path()
			.app_config_dir()
			.map(|folder| folder.join(STATE_FILE))
			.map_err(|error| format!("Could not locate the window preferences: {error}"))
	}
	fn monitors(window: &WebviewWindow) -> Result<Vec<MonitorBounds>, String> {
		let mut result = window
			.available_monitors()
			.map_err(|error| format!("Could not enumerate monitors: {error}"))?
			.into_iter()
			.map(|monitor| MonitorBounds {
				x: monitor.position().x,
				y: monitor.position().y,
				width: monitor.size().width,
				height: monitor.size().height,
				scale_milli: (monitor.scale_factor() * 1000.0).round() as u32,
			})
			.collect::<Vec<_>>();
		result.sort();
		Ok(result)
	}

	// Reject implausible rectangles and positions with most of the window off
	// screen. A multi-monitor window is allowed when its union remains visible.
	fn visible_normal_position(rect: Bounds, monitors: &[MonitorBounds]) -> bool {
		let width = i64::from(rect.right) - i64::from(rect.left);
		let height = i64::from(rect.bottom) - i64::from(rect.top);
		if width < 420 || height < 500 || width > 32_768 || height > 32_768 {
			return false;
		}
		let visible_pixels = monitors.iter().map(|monitor| {
			let x1 = i64::from(rect.left).max(i64::from(monitor.x));
			let y1 = i64::from(rect.top).max(i64::from(monitor.y));
			let x2 = i64::from(rect.right).min(i64::from(monitor.x) + i64::from(monitor.width));
			let y2 = i64::from(rect.bottom).min(i64::from(monitor.y) + i64::from(monitor.height));
			(x2 - x1).max(0) * (y2 - y1).max(0)
		}).sum::<i64>();
		visible_pixels >= (width * height) / 2 && monitors.iter().any(|monitor| {
			// The title bar must be reachable on at least one screen.
			let x1 = i64::from(rect.left).max(i64::from(monitor.x));
			let x2 = i64::from(rect.right).min(i64::from(monitor.x) + i64::from(monitor.width));
			let y = i64::from(rect.top);
			x2 - x1 >= 160 && y >= i64::from(monitor.y) && y < i64::from(monitor.y) + i64::from(monitor.height)
		})
	}
	fn can_restore(saved: &SavedPlacement, current_monitors: &[MonitorBounds]) -> bool {
		saved.version == STATE_VERSION &&
		!current_monitors.is_empty() &&
		saved.monitors == current_monitors &&
		visible_normal_position(saved.normal_position, current_monitors) &&
		saved.snapped.as_ref().is_none_or(|snap| {
			!saved.maximized && snap::valid_snapped_placement(snap, current_monitors)
		})
	}
	fn get_placement(window: &WebviewWindow) -> Result<WindowPlacement, String> {
		let hwnd = window.hwnd().map_err(|error| format!("Could not access window handle: {error}"))?;
		let mut placement = WindowPlacement {
			length: size_of::<WindowPlacement>() as u32,
			..WindowPlacement::default()
		};
		if unsafe { GetWindowPlacement(hwnd.0, &mut placement) } == 0 {
			return Err("Windows could not read the window placement.".to_string());
		}
		Ok(placement)
	}
	pub(crate) fn restore(window: &WebviewWindow) -> Result<(), String> {
		let path = state_path(window)?;
		let Ok(metadata) = fs::metadata(&path) else {
			return Ok(());
		};
		if metadata.len() > MAX_STATE_BYTES {
			return Ok(());
		}
		let Ok(contents) = fs::read(path) else {
			return Ok(());
		};
		let Ok(saved) = serde_json::from_slice::<SavedPlacement>(&contents) else {
			return Ok(());
		};
		if !can_restore(&saved, &monitors(window)?) {
			return Ok(());
		}
		if let Some(snap) = &saved.snapped {
			// Docking is only safe when the exact usable area has not changed
			// (including taskbar position and system reserved screen space).
			if !snap::work_area_unchanged(snap, snap::current_work_area(snap.visible_frame)) {
				return Ok(());
			}
		}

		let hwnd = window.hwnd().map_err(|error| format!("Could not access window handle: {error}"))?;
		let initial = get_placement(window)?;
		let mut placement = initial;
		placement.normal_position = saved.normal_position.into();
		placement.show_cmd = if saved.maximized { SW_SHOWMAXIMIZED } else { SW_SHOWNORMAL };
		placement.flags = 0;
		if unsafe { SetWindowPlacement(hwnd.0, &placement) } == 0 {
			return Err("Windows could not restore the window placement.".to_string());
		}
		if let Some(snapped) = saved.snapped {
			if let Err(error) = snap::restore_snapped(hwnd.0, &snapped) {
				let _ = unsafe { SetWindowPlacement(hwnd.0, &initial) };
				return Err(error);
			}
		}
		Ok(())
	}
	pub(crate) fn save(window: &WebviewWindow) -> Result<(), String> {
		let monitors = monitors(window)?;
		if monitors.is_empty() {
			return Ok(());
		}
		let placement = get_placement(window)?;
		let maximized = placement.show_cmd == SW_SHOWMAXIMIZED ||
			(placement.flags & WPF_RESTORETOMAXIMIZED != 0);
		let snapped = if placement.show_cmd == SW_SHOWNORMAL && !maximized {
			let hwnd = window.hwnd().map_err(|error| format!("Could not access window handle: {error}"))?;
			snap::snapped_placement(hwnd.0)
		} else {
			None
		};
		let saved = SavedPlacement {
			version: STATE_VERSION,
			monitors,
			normal_position: placement.normal_position.into(),
			maximized,
			snapped,
		};
		if !can_restore(&saved, &saved.monitors) {
			// Never overwrite a valid preference with a transient/invalid state.
			return Ok(());
		}
		let path = state_path(window)?;
		let parent = path.parent().ok_or("Window preference folder is unavailable.")?;
		fs::create_dir_all(parent)
			.map_err(|error| format!("Could not create window preference folder: {error}"))?;
		let contents = serde_json::to_vec(&saved)
			.map_err(|error| format!("Could not serialize window placement: {error}"))?;
		// Never expose a partly-written JSON preference after an interrupted close.
		let temporary = path.with_extension("json.tmp");
		fs::write(&temporary, contents)
			.map_err(|error| format!("Could not stage window placement: {error}"))?;
		let outcome = fs::rename(&temporary, &path)
			.map_err(|error| format!("Could not commit window placement: {error}"));
		if outcome.is_err() {
			let _ = fs::remove_file(&temporary);
		}
		outcome
	}
	pub(crate) fn update_snap_corners(window: &WebviewWindow) {
		snap::update_snap_corners(window);
	}
	#[cfg(test)]
	mod tests;
}

#[cfg(target_os = "windows")]
pub(crate) use windows::{restore, save, update_snap_corners};

#[cfg(not(target_os = "windows"))]
pub(crate) fn restore(_window: &tauri::WebviewWindow) -> Result<(), String> {
	Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn save(_window: &tauri::WebviewWindow) -> Result<(), String> {
	Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn update_snap_corners(_window: &tauri::WebviewWindow) {}
