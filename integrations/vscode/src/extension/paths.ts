import type { IntegrationState } from "./state.js"
import {
	isAbsolute,
	relative,
	resolve,
} from "node:path"
import * as vscode from "vscode"

export function normalizePath(path: string): string {
	const normalized = resolve(path).replace(
		/[\\/]+$/,
		"",
	)
	return process.platform === "win32" ?
		normalized.toLowerCase() :
		normalized
}

export function pathBelongsToRoot(
	path: string,
	root: string,
): boolean {
	const pathFromRoot = relative(
		normalizePath(root),
		normalizePath(path),
	)
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
}

export function findOpenProjectRoot(
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

export function getWorkspacePaths(): string[] {
	return (vscode.workspace.workspaceFolders ?? [])
		.filter(folder => folder.uri.scheme === "file")
		.map(folder => folder.uri.fsPath)
}

export function getWorkspaceProjectRoot(state: IntegrationState): string | null {
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

export function workspaceTouchesOpenProject(state: IntegrationState): boolean {
	return getWorkspacePaths().some(path => findOpenProjectRoot(
		[path],
		state,
	) !== null)
}

export function workspaceRootExactlyOpen(state: IntegrationState): boolean {
	const workspacePaths = getWorkspacePaths()
	if (workspacePaths.length !== 1)
		return false
	const [workspacePath] = workspacePaths
	return workspacePath !== undefined && state.openProjectRoots.some(root => normalizePath(root) === normalizePath(workspacePath))
}
