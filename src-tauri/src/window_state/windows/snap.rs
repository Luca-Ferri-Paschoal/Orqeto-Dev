//! Screen-coordinate persistence of the *visible* Windows Snap layout.
//! The native Windows Snap group itself is not publicly restorable.

use super::{visible_normal_position, Bounds, MonitorBounds, WinRect};
use serde::{Deserialize, Serialize};
use std::{ffi::c_void, mem::size_of};
use tauri::WebviewWindow;

const MONITOR_DEFAULTTONEAREST: u32 = 2;
const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
const DWMWCP_DEFAULT: u32 = 0;
const DWMWCP_DONOTROUND: u32 = 1;
const SWP_NOZORDER: u32 = 0x0004;
const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_NOOWNERZORDER: u32 = 0x0200;
const SNAP_EDGE_TOLERANCE: i64 = 16;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct MonitorInfo {
	cb_size: u32,
	monitor: WinRect,
	work_area: WinRect,
	flags: u32,
}

#[link(name = "user32")]
unsafe extern "system" {
	fn GetWindowRect(hwnd: *mut c_void, rect: *mut WinRect) -> i32;
	fn MonitorFromRect(rect: *const WinRect, flags: u32) -> *mut c_void;
	fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
	fn SetWindowPos(
		hwnd: *mut c_void, insert_after: *mut c_void,
		x: i32, y: i32, width: i32, height: i32, flags: u32,
	) -> i32;
}

#[link(name = "dwmapi")]
unsafe extern "system" {
	fn DwmGetWindowAttribute(
		hwnd: *mut c_void, attribute: u32, value: *mut c_void, size: u32,
	) -> i32;
	fn DwmSetWindowAttribute(
		hwnd: *mut c_void, attribute: u32, value: *const c_void, size: u32,
	) -> i32;
}

// Windows Snap changes the actual onscreen rectangle independently from
// WINDOWPLACEMENT.rcNormalPosition (which can retain the pre-snap size).
// These are screen-space coordinates, unlike the normal placement above.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct SnappedPlacement {
	pub(super) outer_position: Bounds,
	pub(super) visible_frame: Bounds,
	pub(super) work_area: Bounds,
}

fn near(first: i32, second: i32) -> bool {
	(i64::from(first) - i64::from(second)).abs() <= SNAP_EDGE_TOLERANCE
}
pub(super) fn is_snapped_frame(frame: Bounds, work: Bounds) -> bool {
	let width = i64::from(frame.right) - i64::from(frame.left);
	let height = i64::from(frame.bottom) - i64::from(frame.top);
	let work_width = i64::from(work.right) - i64::from(work.left);
	let work_height = i64::from(work.bottom) - i64::from(work.top);
	if work_width < 600 || work_height < 600 || width < 420 || height < 500 ||
		width > work_width + SNAP_EDGE_TOLERANCE * 2 ||
		height > work_height + SNAP_EDGE_TOLERANCE * 2 ||
		i64::from(frame.left) < i64::from(work.left) - SNAP_EDGE_TOLERANCE ||
		i64::from(frame.top) < i64::from(work.top) - SNAP_EDGE_TOLERANCE ||
		i64::from(frame.right) > i64::from(work.right) + SNAP_EDGE_TOLERANCE ||
		i64::from(frame.bottom) > i64::from(work.bottom) + SNAP_EDGE_TOLERANCE
	{
		return false;
	}
	// Require a tile (side, top/bottom, or corner), not an arbitrary
	// floating window that happens to be close to a single screen edge.
	let aligned_edges = [
		near(frame.left, work.left),
		near(frame.right, work.right),
		near(frame.top, work.top),
		near(frame.bottom, work.bottom),
	].into_iter().filter(|edge| *edge).count();
	aligned_edges >= 2 && (width <= work_width - 80 || height <= work_height - 80)
}
pub(super) fn valid_snapped_placement(snap: &SnappedPlacement, monitors: &[MonitorBounds]) -> bool {
	let outer = snap.outer_position;
	let frame = snap.visible_frame;
	let borders = [
		i64::from(frame.left) - i64::from(outer.left),
		i64::from(frame.top) - i64::from(outer.top),
		i64::from(outer.right) - i64::from(frame.right),
		i64::from(outer.bottom) - i64::from(frame.bottom),
	];
	visible_normal_position(frame, monitors) &&
	is_snapped_frame(frame, snap.work_area) &&
	borders.iter().all(|border| (-16..=32).contains(border))
}
pub(super) fn work_area_unchanged(snap: &SnappedPlacement, current: Option<Bounds>) -> bool {
	current == Some(snap.work_area)
}
pub(super) fn current_work_area(rect: Bounds) -> Option<Bounds> {
	let win_rect: WinRect = rect.into();
	let monitor = unsafe { MonitorFromRect(&win_rect, MONITOR_DEFAULTTONEAREST) };
	if monitor.is_null() {
		return None;
	}
	let mut info = MonitorInfo { cb_size: size_of::<MonitorInfo>() as u32, ..MonitorInfo::default() };
	if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
		return None;
	}
	Some(info.work_area.into())
}
pub(super) fn snapped_placement(hwnd: *mut c_void) -> Option<SnappedPlacement> {
	let mut outer = WinRect::default();
	if unsafe { GetWindowRect(hwnd, &mut outer) } == 0 {
		return None;
	}
	let mut frame = WinRect::default();
	let hr = unsafe {
		DwmGetWindowAttribute(
			hwnd, DWMWA_EXTENDED_FRAME_BOUNDS,
			(&mut frame as *mut WinRect).cast(), size_of::<WinRect>() as u32,
		)
	};
	if hr < 0 {
		return None;
	}
	let work_area = current_work_area(frame.into())?;
	if !is_snapped_frame(frame.into(), work_area) {
		return None;
	}
	Some(SnappedPlacement {
		outer_position: outer.into(),
		visible_frame: frame.into(),
		work_area,
	})
}
fn set_square_corners(hwnd: *mut c_void, snapped: bool) {
	let preference: u32 = if snapped { DWMWCP_DONOTROUND } else { DWMWCP_DEFAULT };
	// DWM corner preferences exist only on Windows 11. Unsupported Windows
	// versions retain their system-controlled frame without blocking Apply.
	let _ = unsafe {
		DwmSetWindowAttribute(
			hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
			(&preference as *const u32).cast(), size_of::<u32>() as u32,
		)
	};
}
pub(super) fn update_snap_corners(window: &WebviewWindow) {
	if let Ok(hwnd) = window.hwnd() {
		// Reset the override as soon as the user unsnaps/moves/resizes the
		// window; live native Snap still gets its usual square edges.
		set_square_corners(hwnd.0, snapped_placement(hwnd.0).is_some());
	}
}
pub(super) fn restore_snapped(hwnd: *mut c_void, snap: &SnappedPlacement) -> Result<(), String> {
    let rect = snap.outer_position;
    let width = i64::from(rect.right) - i64::from(rect.left);
    let height = i64::from(rect.bottom) - i64::from(rect.top);
    let width = i32::try_from(width).map_err(|_| "Invalid snapped window width.")?;
    let height = i32::try_from(height).map_err(|_| "Invalid snapped window height.")?;
    // GetWindowRect is in screen coordinates, unlike WINDOWPLACEMENT.
    if unsafe {
        SetWindowPos(
            hwnd, std::ptr::null_mut(), rect.left, rect.top, width, height,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
    } == 0 {
        return Err("Windows could not restore the snapped window bounds.".to_string());
    }
    set_square_corners(hwnd, true);
    Ok(())
}
