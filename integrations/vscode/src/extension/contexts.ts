import {
	ACTIVE_STATE_REFRESH_INTERVAL_MS,
	ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY,
	IGNORE_MODE_CONTEXT_KEY,
	INACTIVE_STATE_REFRESH_INTERVAL_MS,
	LOCALE_ENGLISH_CONTEXT_KEY,
	LOCALE_PT_BR_CONTEXT_KEY,
	OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY,
	PROJECT_BUSY_CONTEXT_KEY,
	PROJECT_OPEN_CONTEXT_KEY,
	RUNNING_CONTEXT_KEY,
	WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY,
} from "./constants.js"
import {
	getWorkspaceProjectRoot,
	normalizePath,
	workspaceRootExactlyOpen,
	workspaceTouchesOpenProject,
} from "./paths.js"
import {
	EMPTY_INTEGRATION_STATE,
	isPublishedProcessAlive,
	queryRegistryIntegrationState,
} from "./state.js"
import * as vscode from "vscode"

async function setContext(key: string, value: unknown): Promise<void> {
	await vscode.commands.executeCommand(
		"setContext",
		key,
		value,
	)
}

async function resetContexts(): Promise<void> {
	await Promise.all([
		setContext(
			RUNNING_CONTEXT_KEY,
			false,
		),
		setContext(
			PROJECT_OPEN_CONTEXT_KEY,
			false,
		),
		setContext(
			PROJECT_BUSY_CONTEXT_KEY,
			false,
		),
		setContext(
			IGNORE_MODE_CONTEXT_KEY,
			false,
		),
		setContext(
			LOCALE_PT_BR_CONTEXT_KEY,
			true,
		),
		setContext(
			LOCALE_ENGLISH_CONTEXT_KEY,
			false,
		),
		setContext(
			ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY,
			true,
		),
		setContext(
			OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY,
			[],
		),
		setContext(
			WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY,
			false,
		),
	])
}

function createContextRefresher(): () => Promise<void> {
	let refreshInProgress = false
	return async () => {
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
			const projectBusy = projectRoot !== null && state.busyProjectRoots.some(root => normalizePath(root) === normalizePath(projectRoot))
			const ignoreMode = projectRoot !== null && state.ignoreProjectRoot !== null && normalizePath(projectRoot) === normalizePath(state.ignoreProjectRoot)
			const allowOpenSubfolders = !isRunning || !state.hideOpenProjectSubfolders || !workspaceTouchesOpenProject(state)
			const exactWorkspaceOpen = isRunning && workspaceRootExactlyOpen(state)
			const openProjectRootPaths = state.openProjectRoots.flatMap(root => {
				const uri = vscode.Uri.file(root)
				return [uri.fsPath, uri.path]
			})
			await Promise.all([
				setContext(
					RUNNING_CONTEXT_KEY,
					isRunning,
				),
				setContext(
					PROJECT_OPEN_CONTEXT_KEY,
					projectOpen,
				),
				setContext(
					PROJECT_BUSY_CONTEXT_KEY,
					projectBusy,
				),
				setContext(
					IGNORE_MODE_CONTEXT_KEY,
					ignoreMode,
				),
				setContext(
					LOCALE_PT_BR_CONTEXT_KEY,
					publishedState.locale === "pt-BR",
				),
				setContext(
					LOCALE_ENGLISH_CONTEXT_KEY,
					publishedState.locale === "en",
				),
				setContext(
					ALLOW_OPEN_SUBFOLDERS_CONTEXT_KEY,
					allowOpenSubfolders,
				),
				setContext(
					OPEN_PROJECT_ROOT_PATHS_CONTEXT_KEY,
					openProjectRootPaths,
				),
				setContext(
					WORKSPACE_ROOT_EXACTLY_OPEN_CONTEXT_KEY,
					exactWorkspaceOpen,
				),
			])
		} catch {
			await resetContexts()
		} finally {
			refreshInProgress = false
		}
	}
}

export function registerContextRefresh(context: vscode.ExtensionContext): void {
	const refreshContexts = createContextRefresher()
	void resetContexts()
	void refreshContexts()
	let refreshTimer: ReturnType<typeof setTimeout> | undefined
	const scheduleRefresh = (): void => {
		if (refreshTimer !== undefined)
			clearTimeout(refreshTimer)
		const interval = vscode.window.state.focused ?
			ACTIVE_STATE_REFRESH_INTERVAL_MS :
			INACTIVE_STATE_REFRESH_INTERVAL_MS
		refreshTimer = setTimeout(
			() => void refreshContexts().finally(scheduleRefresh),
			interval,
		)
	}
	scheduleRefresh()
	context.subscriptions.push(
		{ dispose: () => refreshTimer !== undefined && clearTimeout(refreshTimer) },
		vscode.window.onDidChangeWindowState(() => {
			void refreshContexts()
			scheduleRefresh()
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshContexts()),
	)
}
