import type { DiagnosticScope } from "../diagnostic-batch-utils.mts"
import {
	type WorkspaceDefinition,
	WORKSPACES,
} from "./model.mts"

export function getSelectedWorkspaces(scope: DiagnosticScope): WorkspaceDefinition[] {
	switch (scope) {
		case "app":
			return [WORKSPACES.app]
		case "vscode":
			return [WORKSPACES.vscode]
		case "all":
			return [
				WORKSPACES.app,
				WORKSPACES.vscode,
			]
	}
}
