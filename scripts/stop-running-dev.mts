import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import {
	isAbsolute,
	join,
	resolve,
} from "node:path"

const WINDOWS_POWERSHELL_RELATIVE_PATH = join(
	"System32",
	"WindowsPowerShell",
	"v1.0",
	"powershell.exe",
)
const WINDOWS_TASKKILL_RELATIVE_PATH = join(
	"System32",
	"taskkill.exe",
)
const DEV_EXECUTABLE_NAME = "orqeto-dev.exe"
const PROCESS_NAME = "orqeto-dev"
const STOP_TIMEOUT_MS = 20_000

function resolveCargoTargetDirectory(projectRoot: string): string {
	const configuredTarget = process.env.CARGO_TARGET_DIR?.trim()

	if (!configuredTarget) {
		return join(
			projectRoot,
			"src-tauri",
			"target",
		)
	}

	return isAbsolute(configuredTarget) ?
		configuredTarget :
		resolve(
			projectRoot,
			configuredTarget,
		)
}

function resolveWindowsSystemExecutable(relativePath: string): string {
	const windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR

	if (!windowsDirectory)
		throw new Error("Windows system directory is unavailable.")

	const executable = join(
		windowsDirectory,
		relativePath,
	)

	if (!existsSync(executable))
		throw new Error(`Windows system executable was not found at ${executable}.`)

	return executable
}

function stopPreviousDevSession(
	projectRoot: string,
	targetExecutable: string,
): number[] {
	const powershell = resolveWindowsSystemExecutable(WINDOWS_POWERSHELL_RELATIVE_PATH)
	const taskkill = resolveWindowsSystemExecutable(WINDOWS_TASKKILL_RELATIVE_PATH)
	const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($env:ORQETO_DEV_TARGET_EXECUTABLE)
$projectNodeModules = [System.IO.Path]::GetFullPath((Join-Path $env:ORQETO_DEV_PROJECT_ROOT 'node_modules'))
$taskkill = $env:ORQETO_DEV_TASKKILL

function Get-ProcessInfo([int] $processId) {
	Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
}

function Is-ProjectTauriProcess($processInfo) {
	if ($null -eq $processInfo -or $processInfo.Name -ine 'tauri.exe' -or [string]::IsNullOrWhiteSpace($processInfo.ExecutablePath)) {
		return $false
	}

	try {
		$executablePath = [System.IO.Path]::GetFullPath($processInfo.ExecutablePath)
		$nodeModulesPrefix = $projectNodeModules.TrimEnd('\') + '\'

		return $executablePath.StartsWith(
			$nodeModulesPrefix,
			[System.StringComparison]::OrdinalIgnoreCase
		)
	}
	catch {
		return $false
	}
}

function Find-ProjectTauriAncestor([int] $processId) {
	$current = Get-ProcessInfo $processId
	for ($depth = 0; $depth -lt 12 -and $null -ne $current; $depth += 1) {
		if (Is-ProjectTauriProcess $current) {
			return [int] $current.ProcessId
		}

		$parentId = [int] $current.ParentProcessId
		if ($parentId -le 0 -or $parentId -eq [int] $current.ProcessId) {
			break
		}
		$current = Get-ProcessInfo $parentId
	}

	return $null
}

$matches = @(
	Get-Process -Name $env:ORQETO_DEV_PROCESS_NAME -ErrorAction SilentlyContinue |
		Where-Object {
			try {
				$_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -ieq $target)
			}
			catch {
				$false
			}
		}
)

$terminatedSessionRoots = @{}
foreach ($candidate in $matches) {
	$processId = [int] $candidate.Id
	$tauriProcessId = Find-ProjectTauriAncestor $processId

	if ($null -ne $tauriProcessId -and -not $terminatedSessionRoots.ContainsKey($tauriProcessId)) {
		$terminatedSessionRoots[$tauriProcessId] = $true
		& $taskkill /PID $tauriProcessId /T /F *> $null
		if ($LASTEXITCODE -ne 0 -and $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
			throw "Could not stop the previous Tauri development session $tauriProcessId."
		}
	}
	elseif ($null -eq $tauriProcessId) {
		try {
			Stop-Process -Id $processId -Force -ErrorAction Stop
		}
		catch {
			if ($null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
				throw
			}
		}
	}

	Write-Output $processId
}

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
	$remaining = @(
		Get-Process -Name $env:ORQETO_DEV_PROCESS_NAME -ErrorAction SilentlyContinue |
			Where-Object {
				try {
					$_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -ieq $target)
				}
				catch {
					$false
				}
			}
	)

	if ($remaining.Count -eq 0) {
		break
	}

	Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

if ($remaining.Count -gt 0) {
	throw "The previous Orqeto Dev development session did not exit."
}
`
	const result = spawnSync(
		powershell,
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			script,
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				ORQETO_DEV_PROCESS_NAME: PROCESS_NAME,
				ORQETO_DEV_PROJECT_ROOT: projectRoot,
				ORQETO_DEV_TARGET_EXECUTABLE: targetExecutable,
				ORQETO_DEV_TASKKILL: taskkill,
			},
			timeout: STOP_TIMEOUT_MS,
			windowsHide: true,
		},
	)

	if (result.error)
		throw result.error

	if (result.status !== 0) {
		const details = result.stderr.trim() || result.stdout.trim()
		throw new Error(details || "Could not stop the previous Orqeto Dev development session.")
	}

	return result.stdout
		.split(/\r?\n/u)
		.map(value => value.trim())
		.filter(value => /^\d+$/u.test(value))
		.map(Number)
}

function main(): void {
	if (process.platform !== "win32")
		return

	const projectRoot = process.cwd()
	const targetDirectory = resolveCargoTargetDirectory(projectRoot)
	const targetExecutable = join(
		targetDirectory,
		"debug",
		DEV_EXECUTABLE_NAME,
	)
	const stoppedProcessIds = stopPreviousDevSession(
		projectRoot,
		targetExecutable,
	)

	if (stoppedProcessIds.length === 0) {
		console.log("[Dev] No previous development instance is running.")
		return
	}

	console.log(`[Dev] Stopped previous development session (${stoppedProcessIds.join(", ")}).`)
}

try {
	main()
} catch (error) {
	const message = error instanceof Error ?
		error.message :
		String(error)
	console.error(`[Dev] ${message}`)
	process.exitCode = 1
}
