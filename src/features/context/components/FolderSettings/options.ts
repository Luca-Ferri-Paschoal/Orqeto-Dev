import type { ContextSectionMode } from "./types"
import type {
	ContextMode,
	FolderAction,
} from "@/features/context/types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function getSectionMode(contextMode: ContextMode): ContextSectionMode {
	if (contextMode === "commit")
		return "commit"
	if (["typecheck", "lintfix", "eslint", "test"].includes(contextMode))
		return "validation"
	if (contextMode === "logs")
		return "logs"
	return "project"
}

export function getContextModes(
	locale: Locale,
	options: {
		isGitRepository: boolean
		hasValidation: boolean
		hasLogs: boolean
	},
): Array<{ mode: ContextSectionMode; label: string }> {
	return [
		{
			mode: "project",
			label: translate(
				locale,
				"folder.contextMode.project",
			),
		},
		...(options.isGitRepository ?
			[{
				mode: "commit" as const,
				label: translate(
					locale,
					"folder.contextMode.commit",
				),
			}] :
			[]),
		...(options.hasValidation ?
			[{
				mode: "validation" as const,
				label: translate(
					locale,
					"folder.contextMode.validation",
				),
			}] :
			[]),
		...(options.hasLogs ?
			[{
				mode: "logs" as const,
				label: translate(
					locale,
					"folder.contextMode.logs",
				),
			}] :
			[]),
	]
}

export function getFolderActions(
	rootFolder: string | null,
	vscodeAvailable: boolean,
	locale: Locale,
): Array<{ value: FolderAction; label: string }> {
	const defaultAction = {
		value: "select" as const,
		label: translate(
			locale,
			rootFolder === null ?
				"folder.select" :
				"folder.change",
		),
	}
	if (rootFolder === null)
		return [defaultAction]
	return [
		defaultAction,
		{
			value: "explorer",
			label: translate(
				locale,
				"folder.openExplorer",
			),
		},
		...(vscodeAvailable ?
			[{
				value: "vscode" as const,
				label: translate(
					locale,
					"folder.openVscode",
				),
			}] :
			[]),
		{
			value: "close",
			label: translate(
				locale,
				"folder.close",
			),
		},
	]
}
