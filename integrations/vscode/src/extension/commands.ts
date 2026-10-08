import {
	openFolderInOrqeto,
	sendSelection,
} from "./actions.js"
import * as vscode from "vscode"

function localizedCommandIds(baseCommand: string): string[] {
	return [baseCommand, `${baseCommand}.ptBR`, `${baseCommand}.en`]
}

export function registerLocalizedSelectionCommands(
	baseCommand: string,
	direction: "add" | "addAndCopy" | "remove",
	target: "context" | "ignore",
): vscode.Disposable[] {
	return localizedCommandIds(baseCommand).map(command =>
		vscode.commands.registerCommand(
			command,
			(
				primary: vscode.Uri | undefined,
				selected: readonly vscode.Uri[] | undefined,
			) => sendSelection(
				primary,
				selected,
				direction,
				target,
			),
		))
}

export function registerLocalizedOpenCommands(): vscode.Disposable[] {
	return localizedCommandIds("orqetoDev.openFolder").map(command =>
		vscode.commands.registerCommand(
			command,
			openFolderInOrqeto,
		))
}
