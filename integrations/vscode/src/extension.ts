import {
	registerLocalizedOpenCommands,
	registerLocalizedSelectionCommands,
} from "./extension/commands.js"
import { registerContextRefresh } from "./extension/contexts.js"
import type * as vscode from "vscode"

export function activate(context: vscode.ExtensionContext): void {
	registerContextRefresh(context)
	context.subscriptions.push(
		...registerLocalizedSelectionCommands(
			"orqetoDev.sendToContext",
			"add",
			"context",
		),
		...registerLocalizedSelectionCommands(
			"orqetoDev.sendToContextAndCopy",
			"addAndCopy",
			"context",
		),
		...registerLocalizedSelectionCommands(
			"orqetoDev.removeFromContext",
			"remove",
			"context",
		),
		...registerLocalizedSelectionCommands(
			"orqetoDev.sendToIgnore",
			"add",
			"ignore",
		),
		...registerLocalizedSelectionCommands(
			"orqetoDev.removeFromIgnore",
			"remove",
			"ignore",
		),
		...registerLocalizedOpenCommands(),
	)
}

export function deactivate(): void {}
