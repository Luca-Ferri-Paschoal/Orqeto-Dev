import { launchOrForwardToOrqeto } from "./launcher.js"
import { extensionMessage } from "./messages.js"
import {
	findOpenProjectRoot,
	getWorkspacePaths,
	normalizePath,
} from "./paths.js"
import {
	isPublishedProcessAlive,
	queryRegistryIntegrationState,
} from "./state.js"
import * as vscode from "vscode"

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

export async function sendSelection(
	primaryResource: vscode.Uri | undefined,
	selectedResources: readonly vscode.Uri[] | undefined,
	direction: "add" | "addAndCopy" | "remove",
	target: "context" | "ignore",
): Promise<void> {
	const resources = getSelectedResources(
		primaryResource,
		selectedResources,
	)
	if (resources.length === 0)
		return
	const state = await queryRegistryIntegrationState()
	if (!isPublishedProcessAlive(state)) {
		void vscode.window.showWarningMessage(extensionMessage(
			state.locale,
			"appUnavailable",
		))
		return
	}
	const projectRoot = findOpenProjectRoot(
		resources.map(resource => resource.fsPath),
		state,
	)
	if (projectRoot === null)
		return
	const projectBusy = state.busyProjectRoots.some(root => normalizePath(root) === normalizePath(projectRoot))
	if (projectBusy) {
		void vscode.window.showInformationMessage(extensionMessage(
			state.locale,
			"projectBusy",
		))
		return
	}
	const ignoreMode = state.ignoreProjectRoot !== null && normalizePath(state.ignoreProjectRoot) === normalizePath(projectRoot)
	if (target === "context" && ignoreMode) {
		void vscode.window.showInformationMessage(extensionMessage(
			state.locale,
			"ignoreCopyUnavailable",
		))
		return
	}
	if (target === "ignore" && !ignoreMode) {
		void vscode.window.showInformationMessage(extensionMessage(
			state.locale,
			"ignoreUnavailable",
		))
		return
	}
	const flag = target === "ignore" ?
		direction === "add" ?
			"--add-ignore" :
			"--remove-ignore" :
		direction === "addAndCopy" ?
			"--add-context-and-copy" :
			direction === "add" ?
				"--add-context" :
				"--remove-context"
	const delivered = await launchOrForwardToOrqeto(
		[flag, ...resources.map(resource => resource.fsPath)],
		false,
	)
	if (!delivered) {
		void vscode.window.showWarningMessage(extensionMessage(
			state.locale,
			"deliveryFailed",
		))
	}
}

export async function openFolderInOrqeto(resource: vscode.Uri | undefined): Promise<void> {
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
	const state = await queryRegistryIntegrationState()
	const launched = await launchOrForwardToOrqeto(
		["--open-root", target.fsPath],
		true,
	)
	if (!launched) {
		void vscode.window.showWarningMessage(extensionMessage(
			state.locale,
			"openFailed",
		))
	}
}
