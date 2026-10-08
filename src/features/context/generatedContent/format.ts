import type {
	GeneratedFile,
	WorkMode,
} from "../types"
import { getProtocolHeader } from "./protocol"
import {
	appendDirectoryContent,
	buildDirectoryTree,
} from "./tree"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function formatGeneratedContent(
	files: readonly GeneratedFile[],
	locale: Locale,
	workMode: WorkMode,
): string {
	if (files.length === 0)
		return ""
	const blocks = [getProtocolHeader(
		locale,
		workMode,
	)]
	appendDirectoryContent(
		buildDirectoryTree(files),
		blocks,
		true,
		locale,
	)
	blocks.push(translate(
		locale,
		"protocol.end",
	))
	return `${blocks.join("\n\n")}\n`
}
