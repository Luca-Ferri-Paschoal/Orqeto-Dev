#[cfg(target_os = "windows")]
fn install_vscode_extension_blocking(vsix_path: &Path) -> Result<(), String> {
	let mut last_error: Option<String> = None;

	for cli_path in vscode_cli_candidates() {
		let mut command = Command::new(&cli_path);
		command
			.arg("--install-extension")
			.arg(vsix_path)
			.arg("--force")
			.stdin(Stdio::null())
			.creation_flags(WINDOWS_NO_WINDOW);

		let output = match run_windows_command_bounded(command) {
			Ok(output) => output,
			Err(error) => {
				last_error = Some(format!(
					"Could not execute {}: {error}",
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
				"VS Code rejected extension installation using {}.",
				cli_path.display(),
			)
		} else {
			format!(
				"VS Code rejected extension installation using {}: {details}",
				cli_path.display(),
			)
		});
	}

	Err(last_error.unwrap_or_else(|| {
		"Could not locate a Visual Studio Code installation.".to_string()
	}))
}

#[cfg(not(target_os = "windows"))]
fn install_vscode_extension_blocking(_vsix_path: &Path) -> Result<(), String> {
	Err("Automatic VS Code extension installation is available only on Windows.".to_string())
}

#[tauri::command]
async fn install_vscode_extension(app: AppHandle) -> Result<(), String> {
	let vsix_path = app
		.path()
		.resolve(
			"vscode/orqeto-dev-vscode.vsix",
			BaseDirectory::Resource,
		)
		.map_err(|error| format!("Could not locate the packaged extension: {error}"))?;

	if !vsix_path.is_file() {
		return Err("The VS Code extension was not found in the Orqeto Dev package.".to_string());
	}

	tauri::async_runtime::spawn_blocking(move || {
		if !is_vscode_available_blocking() {
			return Err("Visual Studio Code is not available in this environment.".to_string());
		}

		install_vscode_extension_blocking(&vsix_path)
	})
	.await
	.map_err(|error| format!("Extension installation was interrupted: {error}"))?
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
	let system_root = std::env::var_os("SystemRoot")
		.ok_or_else(|| "The Windows folder is not available in the current environment.".to_string())?;
	let powershell = PathBuf::from(system_root)
		.join("System32")
		.join("WindowsPowerShell")
		.join("v1.0")
		.join("powershell.exe");
	let powershell = fs::canonicalize(&powershell)
		.map_err(|error| format!("Could not locate Windows PowerShell: {error}"))?;
	let mut command = Command::new(powershell);
	command
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
		.creation_flags(WINDOWS_NO_WINDOW);
	let output = run_windows_command_bounded(command)
		.map_err(|error| format!("Could not control Explorer: {error}"))?;

	if output.status.success() {
		return Ok(());
	}

	let stderr = String::from_utf8_lossy(&output.stderr);
	let details = stderr.trim();

	if details.is_empty() {
		return Err("Windows could not control the Explorer window.".to_string());
	}

	Err(format!("Windows could not control the Explorer window: {details}"))
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
	Command::new("/usr/bin/open")
		.arg(path)
		.spawn()
		.map_err(|error| format!("Could not open the file explorer: {error}"))?;

	Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_folder_in_explorer_blocking(path: &Path) -> Result<(), String> {
	let executable = if Path::new("/usr/bin/xdg-open").is_file() {
		PathBuf::from("/usr/bin/xdg-open")
	} else {
		resolve_executable_from_path("xdg-open")
			.ok_or_else(|| "Could not locate xdg-open.".to_string())?
	};
	Command::new(executable)
		.arg(path)
		.spawn()
		.map_err(|error| format!("Could not open the file explorer: {error}"))?;

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

