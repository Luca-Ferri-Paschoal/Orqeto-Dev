use std::process::{Child, Command};

/// Configures a subprocess so timeout/error cleanup can terminate the complete
/// descendant tree instead of only the direct child.
pub(crate) fn configure_process_tree(_command: &mut Command) {
	#[cfg(unix)]
	{
		use std::os::unix::process::CommandExt;

		// A fresh process group gives Orqeto a stable kill boundary for tools that
		// spawn helpers while diagnostics/Git operations are running.
		_command.process_group(0);
	}
}

#[cfg(target_os = "windows")]
fn windows_taskkill_path() -> Option<std::path::PathBuf> {
	use std::os::windows::ffi::OsStringExt;

	#[link(name = "kernel32")]
	unsafe extern "system" {
		fn GetSystemDirectoryW(
			buffer: *mut u16,
			size: u32,
		) -> u32;
	}

	// Windows limits the system directory to far below this size. Avoid PATH
	// lookup entirely so a project-controlled `taskkill.exe` can never be run.
	let mut buffer = vec![0_u16; 32_768];
	let written = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
	if written == 0 || written as usize >= buffer.len() {
		return None;
	}
	buffer.truncate(written as usize);
	let directory = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer));
	let executable = directory.join("taskkill.exe");
	executable.is_file().then_some(executable)
}

/// Best-effort termination of a subprocess and all descendants in the process
/// tree boundary configured above. The direct child is always killed/reaped as
/// a final fallback.
pub(crate) fn terminate_process_tree(child: &mut Child) {
	#[cfg(target_os = "windows")]
	{
		use std::os::windows::process::CommandExt;
		use std::process::Stdio;

		const WINDOWS_NO_WINDOW: u32 = 0x0800_0000;
		let pid = child.id().to_string();
		if let Some(taskkill) = windows_taskkill_path() {
			let _ = Command::new(taskkill)
				.args(["/PID", &pid, "/T", "/F"])
				.stdin(Stdio::null())
				.stdout(Stdio::null())
				.stderr(Stdio::null())
				.creation_flags(WINDOWS_NO_WINDOW)
				.status();
		}
	}

	#[cfg(unix)]
	{
		const SIGKILL: std::ffi::c_int = 9;

		unsafe extern "C" {
			fn kill(pid: std::ffi::c_int, signal: std::ffi::c_int) -> std::ffi::c_int;
		}

		if let Ok(pid) = std::ffi::c_int::try_from(child.id()) {
			// Negative PID targets the process group created by
			// `configure_process_tree`.
			let _ = unsafe { kill(-pid, SIGKILL) };
		}
	}

	let _ = child.kill();
	let _ = child.wait();
}
