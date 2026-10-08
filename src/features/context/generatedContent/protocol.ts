import type { WorkMode } from "../types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function getProtocolHeader(locale: Locale, workMode: WorkMode): string {
	const modeInstructions = workMode === "git" ?
		[
			translate(
				locale,
				"protocol.workModeGit",
			),
			translate(
				locale,
				"protocol.gitPatchInstruction",
			),
			translate(
				locale,
				"protocol.gitPatchSafety",
			),
		] :
		[
			translate(
				locale,
				"protocol.workModeFiles",
			),
			translate(
				locale,
				"protocol.filesPatchInstruction",
			),
			translate(
				locale,
				"protocol.deleteManifestDescription",
			),
			translate(
				locale,
				"protocol.deleteManifestFormat",
			),
			translate(
				locale,
				"protocol.deleteManifestPaths",
			),
			translate(
				locale,
				"protocol.deleteManifestPermanent",
			),
			translate(
				locale,
				"protocol.deleteManifestOptional",
			),
		]
	return [
		translate(
			locale,
			"protocol.header",
		),
		translate(
			locale,
			"protocol.label",
		),
		...modeInstructions,
		translate(
			locale,
			"protocol.rootDescription",
		),
		translate(
			locale,
			"protocol.folderDescription",
		),
		translate(
			locale,
			"protocol.backDescription",
		),
		translate(
			locale,
			"protocol.fileDescription",
		),
		translate(
			locale,
			"protocol.contentDescription",
		),
		translate(
			locale,
			"protocol.pathOnlyDescription",
		),
		translate(
			locale,
			"protocol.redactionInfo",
		),
		translate(
			locale,
			"protocol.redactionApplyProtection",
		),
		`===== ${translate(
			locale,
			"protocol.root",
		)}: ./ =====`,
	].join("\n")
}
