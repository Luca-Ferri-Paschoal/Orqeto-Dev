import { spawnSync } from "node:child_process"
import os from "node:os"

interface ProcessSample {
	cpuSeconds: number
	workingSetBytes: number
	privateBytes: number
}

function argument(name: string): string | null {
	const prefix = `--${name}=`
	return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function sampleWindowsProcess(pid: number): ProcessSample {
	const script = [
		`$p = Get-Process -Id ${pid} -ErrorAction Stop`,
		"[pscustomobject]@{ cpuSeconds = [double]$p.CPU; workingSetBytes = [double]$p.WorkingSet64; privateBytes = [double]$p.PrivateMemorySize64 } | ConvertTo-Json -Compress",
	].join("; ")
	const result = spawnSync(
		"powershell.exe",
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			script,
		],
		{
			encoding: "utf8",
			windowsHide: true,
		},
	)

	if (result.status !== 0)
		throw new Error(result.stderr.trim() || `Unable to sample process ${pid}.`)

	return JSON.parse(result.stdout) as ProcessSample
}

const pid = Number(argument("pid"))
const seconds = Number(argument("seconds") ?? "10")
const label = argument("label") ?? "orqeto-idle"

if (!Number.isInteger(pid) || pid <= 0)
	throw new Error("Pass the Orqeto process ID as --pid=<number>.")
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300)
	throw new Error("--seconds must be between 1 and 300.")
if (process.platform !== "win32")
	throw new Error("The runtime benchmark helper currently targets the Windows-first Orqeto desktop environment.")

const logicalCpuCount = Math.max(
	1,
	os.cpus().length,
)
const first = sampleWindowsProcess(pid)
const started = performance.now()
await new Promise(resolve => setTimeout(
	resolve,
	seconds * 1000,
))
const elapsedSeconds = (performance.now() - started) / 1000
const second = sampleWindowsProcess(pid)
const cpuDelta = Math.max(
	0,
	second.cpuSeconds - first.cpuSeconds,
)
const normalizedCpuPercent = (cpuDelta / elapsedSeconds / logicalCpuCount) * 100

process.stdout.write(`${JSON.stringify({
	label,
	pid,
	sampleSeconds: Number(elapsedSeconds.toFixed(3)),
	logicalCpuCount,
	cpuPercentOfMachine: Number(normalizedCpuPercent.toFixed(3)),
	workingSetMiB: Number((second.workingSetBytes / 1024 / 1024).toFixed(2)),
	privateMiB: Number((second.privateBytes / 1024 / 1024).toFixed(2)),
}, null, 2)}\n`)
