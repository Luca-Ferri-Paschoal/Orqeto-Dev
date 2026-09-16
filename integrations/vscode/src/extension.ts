import {
	execFile,
	spawn,
} from "node:child_process"
import { access } from "node:fs/promises"
import {
	isAbsolute,
	relative,
	resolve,
} from "node:path"
import * as vscode from "vscode"

const ORQETO_REGISTRY_KEY = String.raw`HKCU\Software\Orqeto\Orqeto Dev`
const EXECUTABLE_VALUE_NAME = "ExecutablePath"
const INTEGRATION_STATE_VALUE_NAME = "IntegrationState"
const RUNNING_CONTEXT_KEY = "orqetoDev.isRunning"
const PROJECT_OPEN_CONTEXT_KEY = "orqetoDev.projectOpen"
const IGNORE_MODE_CONTEXT_KEY = "orqetoDev.ignoreMode"
const CREATE_CONTEXT_MODE_CONTEXT_KEY = "orqetoDev.createContextMode"
const ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY = "orqetoDev.allowOpenSubfolders"
const OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY = "orqetoDev.openProjectRootPaths"
const WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY = "orqetoDev.workspaceRootExactlyOpen"
const FORWARD_ONLY_ARG = "--orqeto-dev-forward-only"
const FORWARD_ONLY_NO_PRIMARY_EXIT_CODE = 73
const FORWARD_DELIVERY_TIMEOUT_MS = 10_000
const ACTIVE_STATE_REFRESH_INTERVAL_MS = 5_000
const INACTIVE_STATE_REFRESH_INTERVAL_MS = 30_000
const REGISTRY_QUERY_TIMEOUT_MS = 5_000

interface IntegrationState {
	version: 2
	processId: number
	openProjectRoots: string[]
	contextProjectRoots: string[]
	ignoreProjectRoot: string | null
	hideOpenProjectSubfolders: boolean
}

const EMPTY_INTEGRATION_STATE: IntegrationState = {
	version: 2,
	processId: 0,
	openProjectRoots: [],
	contextProjectRoots: [],
	ignoreProjectRoot: null,
	hideOpenProjectSubfolders: true,
}

let cachedExecutablePath: string | undefined

function queryRegistryValue(
	registryKey: string,
	valueName: string,
): Promise<string | null> {
	if (process.platform !== "win32")
		return Promise.resolve(null)

	return new Promise(resolveQuery => {
		execFile(
			"reg.exe",
			[
				"query",
				registryKey,
				"/v",
				valueName,
			],
			{
				encoding: "utf8",
				windowsHide: true,
				timeout: REGISTRY_QUERY_TIMEOUT_MS,
			},
			(error, stdout) => {
				if (error) {
					resolveQuery(null)
					return
				}

				const line = stdout
					.split(/\r?\n/)
					.find(value => value.includes(valueName))

				if (line === undefined) {
					resolveQuery(null)
					return
				}

				const typeMarkerIndex = line.indexOf("REG_")

				if (typeMarkerIndex < 0) {
					resolveQuery(null)
					return
				}

				const typeAndValue = line.slice(typeMarkerIndex)
				const valueStart = typeAndValue.search(/\s+/)

				resolveQuery(valueStart < 0 ?
					null :
					typeAndValue.slice(valueStart).trim() || null)
			},
		)
	})
}

async function queryRegistryExecutablePath(): Promise<string | null> {
	return queryRegistryValue(
		ORQETO_REGISTRY_KEY,
		EXECUTABLE_VALUE_NAME,
	)
}

async function queryRegistryIntegrationState(): Promise<IntegrationState> {
	const serialized = await queryRegistryValue(
		ORQETO_REGISTRY_KEY,
		INTEGRATION_STATE_VALUE_NAME,
	)

	if (serialized === null)
		return EMPTY_INTEGRATION_STATE

	try {
		const parsed: unknown = JSON.parse(serialized)

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("version" in parsed) ||
			parsed.version !== 2 ||
			!("processId" in parsed) ||
			typeof parsed.processId !== "number" ||
			!Number.isSafeInteger(parsed.processId) ||
			parsed.processId <= 0 ||
			!("openProjectRoots" in parsed) ||
			!Array.isArray(parsed.openProjectRoots) ||
			!parsed.openProjectRoots.every(root => typeof root === "string") ||
			!("contextProjectRoots" in parsed) ||
			!Array.isArray(parsed.contextProjectRoots) ||
			!parsed.contextProjectRoots.every(root => typeof root === "string") ||
			!("ignoreProjectRoot" in parsed) ||
			!(parsed.ignoreProjectRoot === null || typeof parsed.ignoreProjectRoot === "string") ||
			!("hideOpenProjectSubfolders" in parsed) ||
			typeof parsed.hideOpenProjectSubfolders !== "boolean"
		)
			return EMPTY_INTEGRATION_STATE

		return {
			version: 2,
			processId: parsed.processId,
			openProjectRoots: parsed.openProjectRoots,
			contextProjectRoots: parsed.contextProjectRoots,
			ignoreProjectRoot: parsed.ignoreProjectRoot,
			hideOpenProjectSubfolders: parsed.hideOpenProjectSubfolders,
		}
	} catch {
		return EMPTY_INTEGRATION_STATE
	}
}

function isPublishedProcessAlive(state: IntegrationState): boolean {
	if (state.processId <= 0)
		return false

	try {
		process.kill(
			state.processId,
			0,
		)
		return true
	} catch {
		return false
	}
}

async function queryExecutablePath(): Promise<string | null> {
	const executablePath = cachedExecutablePath ??
		await queryRegistryExecutablePath()

	if (executablePath === null)
		return null

	cachedExecutablePath = executablePath

	try {
		await access(executablePath)
	} catch {
		cachedExecutablePath = undefined
		return null
	}

	return executablePath
}

function normalizePath(path: string): string {
	const normalized = resolve(path).replace(
		/[\\/]+$/,
		"",
	)

	return process.platform === "win32" ?
		normalized.toLowerCase() :
		normalized
}

function pathBelongsToRoot(
	path: string,
	root: string,
): boolean {
	const normalizedPath = normalizePath(path)
	const normalizedRoot = normalizePath(root)
	const pathFromRoot = relative(
		normalizedRoot,
		normalizedPath,
	)

	return pathFromRoot === "" ||
		(!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
}

function findOpenProjectRoot(
	paths: readonly string[],
	state: IntegrationState,
): string | null {
	if (paths.length === 0)
		return null

	let bestRoot: string | null = null
	let bestDepth = -1

	for (const root of state.openProjectRoots) {
		if (!paths.every(path => pathBelongsToRoot(
			path,
			root,
		)))
			continue

		const depth = normalizePath(root).split(/[\\/]+/).length

		if (depth > bestDepth) {
			bestRoot = root
			bestDepth = depth
		}
	}

	return bestRoot
}

function getWorkspacePaths(): string[] {
	return (vscode.workspace.workspaceFolders ?? [])
		.filter(folder => folder.uri.scheme === "file")
		.map(folder => folder.uri.fsPath)
}

function getWorkspaceProjectRoot(state: IntegrationState): string | null {
	const workspacePaths = getWorkspacePaths()

	if (workspacePaths.length === 0)
		return null

	const matchedRoots = new Set<string>()

	for (const workspacePath of workspacePaths) {
		const root = findOpenProjectRoot(
			[workspacePath],
			state,
		)

		if (root === null)
			return null

		matchedRoots.add(normalizePath(root))
	}

	if (matchedRoots.size !== 1)
		return null

	const [normalizedMatch] = matchedRoots

	return state.openProjectRoots.find(root => normalizePath(root) === normalizedMatch) ?? null
}

function workspaceTouchesOpenProject(state: IntegrationState): boolean {
	return getWorkspacePaths().some(path => findOpenProjectRoot(
		[path],
		state,
	) !== null)
}

function workspaceRootExactlyOpen(state: IntegrationState): boolean {
	const workspacePaths = getWorkspacePaths()

	if (workspacePaths.length !== 1)
		return false

	const [workspacePath] = workspacePaths

	return workspacePath !== undefined && state.openProjectRoots.some(root =>
		normalizePath(root) === normalizePath(workspacePath))
}

async function launchOrForwardToOrqeto(
	args: readonly string[],
	startIfClosed: boolean,
): Promise<boolean> {
	const executablePath = await queryExecutablePath()

	if (executablePath === null)
		return false

	if (!startIfClosed) {
		const state = await queryRegistryIntegrationState()

		if (!isPublishedProcessAlive(state))
			return false
	}

	// Open-in-Orqeto commands intentionally start without the forward-only flag.
	// The single-instance plugin forwards them when a primary instance exists,
	// while the new process remains primary if the previous instance exits in
	// the small window between discovery and launch. Commands that must never
	// start the app keep the forward-only contract.
	const processArgs = startIfClosed ?
		[...args] :
		[FORWARD_ONLY_ARG, ...args]

	if (startIfClosed) {
		return new Promise(resolveLaunch => {
			const child = spawn(
				executablePath,
				processArgs,
				{
					detached: true,
					stdio: "ignore",
					windowsHide: true,
				},
			)

			child.once(
				"error",
				() => resolveLaunch(false),
			)
			child.once(
				"spawn",
				() => {
					child.unref()
					resolveLaunch(true)
				},
			)
		})
	}

	return new Promise(resolveLaunch => {
		let settled = false
		const child = spawn(
			executablePath,
			processArgs,
			{
				detached: false,
				stdio: "ignore",
				windowsHide: true,
			},
		)
		const finish = (delivered: boolean): void => {
			if (settled)
				return

			settled = true
			clearTimeout(timeout)
			resolveLaunch(delivered)
		}
		const timeout = setTimeout(
			() => {
				if (!settled)
					child.kill()

				finish(false)
			},
			FORWARD_DELIVERY_TIMEOUT_MS,
		)

		child.once(
			"error",
			() => finish(false),
		)
		child.once(
			"exit",
			code => finish(code !== FORWARD_ONLY_NO_PRIMARY_EXIT_CODE && code === 0),
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

function projectIsInCreateContextMode(
	state: IntegrationState,
	projectRoot: string,
): boolean {
	const normalizedRoot = normalizePath(projectRoot)

	return state.contextProjectRoots.some(root => normalizePath(root) === normalizedRoot)
}

async function sendSelection(
	primaryResource: vscode.Uri | undefined,
	selectedResources: readonly vscode.Uri[] | undefined,
	direction: "add" | "addAndCopy" | "remove",
): Promise<void> {
	const resources = getSelectedResources(
		primaryResource,
		selectedResources,
	)

	if (resources.length === 0)
		return

	const state = await queryRegistryIntegrationState()

	if (!isPublishedProcessAlive(state)) {
		void vscode.window.showWarningMessage("Orqeto Dev is not available to receive this action.")
		return
	}

	const projectRoot = findOpenProjectRoot(
		resources.map(resource => resource.fsPath),
		state,
	)

	if (projectRoot === null)
		return

	const ignoreMode = state.ignoreProjectRoot !== null &&
		normalizePath(state.ignoreProjectRoot) === normalizePath(projectRoot)
	if (ignoreMode && direction === "addAndCopy") {
		void vscode.window.showInformationMessage("Dev Ignore is open for this project. Use the Dev Ignore actions.")
		return
	}
	if (!ignoreMode && !projectIsInCreateContextMode(
		state,
		projectRoot,
	)) {
		void vscode.window.showInformationMessage("Context actions are available only when the project is in Create mode in Orqeto Dev.")
		return
	}

	const flag = ignoreMode ?
		direction === "add" ?
			"--add-ignore" :
			"--remove-ignore" :
		direction === "addAndCopy" ?
			"--add-context-and-copy" :
			direction === "add" ?
				"--add-context" :
				"--remove-context"

	const delivered = await launchOrForwardToOrqeto(
		[
			flag,
			...resources.map(resource => resource.fsPath),
		],
		false,
	)

	if (!delivered)
		void vscode.window.showWarningMessage("The action was not delivered because Orqeto Dev closed or stopped responding while it was being sent.")
}

async function openFolderInOrqeto(resource: vscode.Uri | undefined): Promise<void> {
	const fallbackResource = getWorkspacePaths().length === 1 ?
		vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === "file")?.uri :
		undefined
	const target = resource?.scheme === "file" ?
		resource :
		fallbackResource

	if (target?.scheme !== "file")
		return

	try {
		const stat = await vscode.workspace.fs.stat(target)

		if ((stat.type & vscode.FileType.Directory) === 0)
			return
	} catch {
		return
	}

	const launched = await launchOrForwardToOrqeto(
		[
			"--open-root",
			target.fsPath,
		],
		true,
	)

	if (!launched)
		void vscode.window.showWarningMessage("Could not locate or start Orqeto Dev.")
}

export function activate(context: vscode.ExtensionContext): void {
	let refreshInProgress = false

	async function refreshContexts(): Promise<void> {
		if (refreshInProgress)
			return

		refreshInProgress = true

		try {
			const publishedState = await queryRegistryIntegrationState()
			const isRunning = isPublishedProcessAlive(publishedState)
			const state = isRunning ?
				publishedState :
				EMPTY_INTEGRATION_STATE
			const projectRoot = isRunning ?
				getWorkspaceProjectRoot(state) :
				null
			const projectOpen = projectRoot !== null
			const ignoreMode = projectRoot !== null &&
				state.ignoreProjectRoot !== null &&
				normalizePath(projectRoot) === normalizePath(state.ignoreProjectRoot)
			const createContextMode = projectRoot !== null &&
				!ignoreMode &&
				projectIsInCreateContextMode(
					state,
					projectRoot,
				)
			const allowOpenSubfolders = !isRunning ||
				!state.hideOpenProjectSubfolders ||
				!workspaceTouchesOpenProject(state)
			const exactWorkspaceOpen = isRunning &&
				workspaceRootExactlyOpen(state)
			const openProjectRootPaths = state.openProjectRoots.flatMap(root => {
				const uri = vscode.Uri.file(root)

				return [
					uri.fsPath,
					uri.path,
				]
			})

			await Promise.all([
				vscode.commands.executeCommand(
					"setContext",
					RUNNING_CONTEXT_KEY,
					isRunning,
				),
				vscode.commands.executeCommand(
					"setContext",
					PROJECT_OPEN_CONTEXT_KEY,
					projectOpen,
				),
				vscode.commands.executeCommand(
					"setContext",
					IGNORE_MODE_CONTEXT_KEY,
					ignoreMode,
				),
				vscode.commands.executeCommand(
					"setContext",
					CREATE_CONTEXT_MODE_CONTEXT_KEY,
					createContextMode,
				),
				vscode.commands.executeCommand(
					"setContext",
					ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY,
					allowOpenSubfolders,
				),
				vscode.commands.executeCommand(
					"setContext",
					OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY,
					openProjectRootPaths,
				),
				vscode.commands.executeCommand(
					"setContext",
					WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY,
					exactWorkspaceOpen,
				),
			])
		} catch {
			await Promise.all([
				vscode.commands.executeCommand(
					"setContext",
					RUNNING_CONTEXT_KEY,
					false,
				),
				vscode.commands.executeCommand(
					"setContext",
					PROJECT_OPEN_CONTEXT_KEY,
					false,
				),
				vscode.commands.executeCommand(
					"setContext",
					IGNORE_MODE_CONTEXT_KEY,
					false,
				),
				vscode.commands.executeCommand(
					"setContext",
					CREATE_CONTEXT_MODE_CONTEXT_KEY,
					false,
				),
				vscode.commands.executeCommand(
					"setContext",
					ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY,
					true,
				),
				vscode.commands.executeCommand(
					"setContext",
					OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY,
					[],
				),
				vscode.commands.executeCommand(
					"setContext",
					WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY,
					false,
				),
			])
		} finally {
			refreshInProgress = false
		}
	}

	void Promise.all([
		vscode.commands.executeCommand(
			"setContext",
			RUNNING_CONTEXT_KEY,
			false,
		),
		vscode.commands.executeCommand(
			"setContext",
			PROJECT_OPEN_CONTEXT_KEY,
			false,
		),
		vscode.commands.executeCommand(
			"setContext",
			IGNORE_MODE_CONTEXT_KEY,
			false,
		),
		vscode.commands.executeCommand(
			"setContext",
			CREATE_CONTEXT_MODE_CONTEXT_KEY,
			false,
		),
		vscode.commands.executeCommand(
			"setContext",
			ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY,
			true,
		),
		vscode.commands.executeCommand(
			"setContext",
			OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY,
			[],
		),
		vscode.commands.executeCommand(
			"setContext",
			WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY,
			false,
		),
	])
	void refreshContexts()

	let refreshTimer: ReturnType<typeof setTimeout> | undefined
	const scheduleRefresh = (): void => {
		if (refreshTimer !== undefined)
			clearTimeout(refreshTimer)

		const interval = vscode.window.state.focused ?
			ACTIVE_STATE_REFRESH_INTERVAL_MS :
			INACTIVE_STATE_REFRESH_INTERVAL_MS
		refreshTimer = setTimeout(
			() => {
				void refreshContexts().finally(scheduleRefresh)
			},
			interval,
		)
	}
	scheduleRefresh()

	context.subscriptions.push(
		{
			dispose: () => {
				if (refreshTimer !== undefined)
					clearTimeout(refreshTimer)
			},
		},
		vscode.window.onDidChangeWindowState(() => {
			void refreshContexts()
			scheduleRefresh()
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshContexts()),
		vscode.commands.registerCommand(
			"orqetoDev.sendToContext",
			(
				primary: vscode.Uri | undefined,
				selected: readonly vscode.Uri[] | undefined,
			) => sendSelection(
				primary,
				selected,
				"add",
			),
		),
		vscode.commands.registerCommand(
			"orqetoDev.sendToContextAndCopy",
			(
				primary: vscode.Uri | undefined,
				selected: readonly vscode.Uri[] | undefined,
			) => sendSelection(
				primary,
				selected,
				"addAndCopy",
			),
		),
		vscode.commands.registerCommand(
			"orqetoDev.removeFromContext",
			(
				primary: vscode.Uri | undefined,
				selected: readonly vscode.Uri[] | undefined,
			) => sendSelection(
				primary,
				selected,
				"remove",
			),
		),
		vscode.commands.registerCommand(
			"orqetoDev.sendToIgnore",
			(
				primary: vscode.Uri | undefined,
				selected: readonly vscode.Uri[] | undefined,
			) => sendSelection(
				primary,
				selected,
				"add",
			),
		),
		vscode.commands.registerCommand(
			"orqetoDev.removeFromIgnore",
			(
				primary: vscode.Uri | undefined,
				selected: readonly vscode.Uri[] | undefined,
			) => sendSelection(
				primary,
				selected,
				"remove",
			),
		),
		vscode.commands.registerCommand(
			"orqetoDev.openFolder",
			openFolderInOrqeto,
		),
	)
}

export function deactivate(): void {}
