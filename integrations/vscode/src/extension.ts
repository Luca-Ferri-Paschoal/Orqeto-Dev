import {
	execFile,
	spawn,
} from "node:child_process"
import { access } from "node:fs/promises"
import { basename } from "node:path"
import * as vscode from "vscode"

const ORQETO_REGISTRY_KEY = String.raw`HKCU\Software\Orqeto\Orqeto Dev`
const EXECUTABLE_VALUE_NAME = "ExecutablePath"
const RUNNING_CONTEXT_KEY = "orqetoDev.isRunning"
const FORWARD_ONLY_ARG = "--orqeto-dev-forward-only"
const RUNNING_REFRESH_INTERVAL_MS = 5_000

let cachedExecutablePath: string | undefined

function queryRegistryExecutablePath(registryKey: string): Promise<string | null> {
	if (process.platform !== "win32")
		return Promise.resolve(null)

	return new Promise(resolve => {
		execFile(
			"reg.exe",
			[
				"query",
				registryKey,
				"/v",
				EXECUTABLE_VALUE_NAME,
			],
			{
				encoding: "utf8",
				windowsHide: true,
			},
			(error, stdout) => {
				if (error) {
					resolve(null)
					return
				}

				const line = stdout
					.split(/\r?\n/)
					.find(value => value.includes(EXECUTABLE_VALUE_NAME))
				const match = line?.match(/ExecutablePath\s+REG_SZ\s+(.+)$/)
				const executablePath = match?.[1]?.trim()

				resolve(executablePath || null)
			},
		)
	})
}

function queryProcessRunning(executablePath: string): Promise<boolean> {
	const executableName = basename(executablePath)

	return new Promise(resolve => {
		execFile(
			"tasklist.exe",
			[
				"/FI",
				`IMAGENAME eq ${executableName}`,
				"/FO",
				"CSV",
				"/NH",
			],
			{
				encoding: "utf8",
				windowsHide: true,
			},
			(error, stdout) => {
				if (error) {
					resolve(false)
					return
				}

				const normalizedName = executableName.toLowerCase()
				const running = stdout
					.split(/\r?\n/)
					.some(line => {
						const match = line.match(/^"([^"]+)"/)

						return match?.[1]?.toLowerCase() === normalizedName
					})

				resolve(running)
			},
		)
	})
}

async function queryRunningExecutablePath(): Promise<string | null> {
	const executablePath = cachedExecutablePath ??
		await queryRegistryExecutablePath(ORQETO_REGISTRY_KEY)

	if (executablePath === null)
		return null

	cachedExecutablePath = executablePath

	try {
		await access(executablePath)
	} catch {
		cachedExecutablePath = undefined
		return null
	}

	return await queryProcessRunning(executablePath) ?
		executablePath :
		null
}

async function sendToRunningOrqeto(args: readonly string[]): Promise<void> {
	const executablePath = await queryRunningExecutablePath()

	if (executablePath === null)
		return

	await new Promise<void>(resolve => {
		const child = spawn(
			executablePath,
			[FORWARD_ONLY_ARG, ...args],
			{
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			},
		)

		child.once(
			"error",
			() => resolve(),
		)
		child.once(
			"spawn",
			() => {
				child.unref()
				resolve()
			},
		)
	})
}

function getSelectedResources(
	primaryResource: vscode.Uri | undefined,
	selectedResources: readonly vscode.Uri[] | undefined,
): vscode.Uri[] {
	const resources = selectedResources?.length ?
		selectedResources :
		primaryResource ?
			[primaryResource] :
			[]

	return resources.filter(resource => resource.scheme === "file")
}

async function sendToContext(
	primaryResource: vscode.Uri | undefined,
	selectedResources: readonly vscode.Uri[] | undefined,
): Promise<void> {
	const resources = getSelectedResources(
		primaryResource,
		selectedResources,
	)

	if (resources.length === 0)
		return

	await sendToRunningOrqeto([
		"--add-context",
		...resources.map(resource => resource.fsPath),
	])
}

async function removeFromContext(
	primaryResource: vscode.Uri | undefined,
	selectedResources: readonly vscode.Uri[] | undefined,
): Promise<void> {
	const resources = getSelectedResources(
		primaryResource,
		selectedResources,
	)

	if (resources.length === 0)
		return

	await sendToRunningOrqeto([
		"--remove-context",
		...resources.map(resource => resource.fsPath),
	])
}

async function openFolderInOrqeto(resource: vscode.Uri | undefined): Promise<void> {
	if (resource?.scheme !== "file")
		return

	try {
		const stat = await vscode.workspace.fs.stat(resource)

		if ((stat.type & vscode.FileType.Directory) === 0)
			return
	} catch {
		return
	}

	await sendToRunningOrqeto([
		"--open-root",
		resource.fsPath,
	])
}

export function activate(context: vscode.ExtensionContext): void {
	let refreshInProgress = false

	async function refreshRunningContext(): Promise<void> {
		if (refreshInProgress)
			return

		refreshInProgress = true

		try {
			const isRunning = await queryRunningExecutablePath() !== null
			await vscode.commands.executeCommand(
				"setContext",
				RUNNING_CONTEXT_KEY,
				isRunning,
			)
		} catch {
			await vscode.commands.executeCommand(
				"setContext",
				RUNNING_CONTEXT_KEY,
				false,
			)
		} finally {
			refreshInProgress = false
		}
	}

	void vscode.commands.executeCommand(
		"setContext",
		RUNNING_CONTEXT_KEY,
		false,
	)
	void refreshRunningContext()

	const refreshTimer = setInterval(
		() => void refreshRunningContext(),
		RUNNING_REFRESH_INTERVAL_MS,
	)

	context.subscriptions.push(
		{
			dispose: () => clearInterval(refreshTimer),
		},
		vscode.window.onDidChangeWindowState(() => void refreshRunningContext()),
		vscode.commands.registerCommand(
			"orqetoDev.sendToContext",
			sendToContext,
		),
		vscode.commands.registerCommand(
			"orqetoDev.removeFromContext",
			removeFromContext,
		),
		vscode.commands.registerCommand(
			"orqetoDev.openFolder",
			openFolderInOrqeto,
		),
	)
}

export function deactivate(): void {}
