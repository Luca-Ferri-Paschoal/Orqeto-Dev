import type { OverlayUndoHistoryEntry } from "../../types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export function getUndoHistoryLabel(
	entry: OverlayUndoHistoryEntry,
	locale: Locale,
	historyTimeFormatter: Intl.DateTimeFormat,
): string {
	if (entry.sourceKind === "git") {
		return translate(
			locale,
			entry.steps === 1 ?
				"apply.undo.historyGitLatest" :
				"apply.undo.historyGitPrevious",
			{
				steps: entry.steps,
				patch: entry.sourceLabel ?? ".patch",
				added: entry.addedFiles,
				replaced: entry.replacedFiles,
				deleted: entry.deletedFiles,
				addedLines: entry.addedLines ?? 0,
				deletedLines: entry.deletedLines ?? 0,
				time: historyTimeFormatter.format(entry.appliedAtUnixMs),
			},
		)
	}

	return translate(
		locale,
		entry.steps === 1 ?
			"apply.undo.historyLatest" :
			"apply.undo.historyPrevious",
		{
			steps: entry.steps,
			source: entry.sourceLabel ?? translate(
				locale,
				"apply.undo.sourceFallback",
			),
			added: entry.addedFiles,
			replaced: entry.replacedFiles,
			deleted: entry.deletedFiles,
			time: historyTimeFormatter.format(entry.appliedAtUnixMs),
		},
	)
}
