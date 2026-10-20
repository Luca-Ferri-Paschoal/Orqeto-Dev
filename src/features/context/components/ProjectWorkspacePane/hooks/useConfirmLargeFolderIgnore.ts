import {
	isSafeIgnoreSuggestion,
	MAX_CONTEXT_CONTENT_BYTES,
} from "../../../projectContextSizeReport"
import type {
	ContextWorkspace,
	WorkspaceConfirmationRequest,
} from "../../../useContextWorkspace"
import { translate } from "@/infra/i18n"
import type { MutableRefObject } from "react"
import { useCallback } from "react"

/** Ask before changing the ignore rules, then revalidate the same scanned project. */
export function useConfirmLargeFolderIgnore(
	workspaceRef: MutableRefObject<ContextWorkspace>,
	requestConfirmation: (request: WorkspaceConfirmationRequest) => Promise<boolean>,
	ignoreScannedFolder: (
		rootAtScan: string,
		relativePath: string,
	) => Promise<void>,
) {
	return useCallback(async (relativePath: string): Promise<void> => {
		const { rootFolder: rootAtScan, fullProjectContextSummary: summary, locale } = workspaceRef.current
		if (rootAtScan === null || !isSafeIgnoreSuggestion(relativePath) ||
			summary === null || summary.byteCount <= MAX_CONTEXT_CONTENT_BYTES ||
			!summary.directories.some(entry => entry.path === relativePath))
			return
		const confirmed = await requestConfirmation({
			title: translate(
				locale,
				"folder.projectContext.sizeConfirmTitle",
			),
			message: translate(
				locale,
				"folder.projectContext.sizeConfirmMessage",
				{ path: relativePath },
			),
			confirmLabel: translate(
				locale,
				"folder.projectContext.sizeConfirmAction",
			),
			cancelLabel: translate(
				locale,
				"folder.projectContext.sizeCancel",
			),
		})
		if (!confirmed || workspaceRef.current.rootFolder !== rootAtScan ||
			workspaceRef.current.fullProjectContextSummary !== summary)
			return
		await ignoreScannedFolder(
			rootAtScan,
			relativePath,
		)
	}, [ignoreScannedFolder, requestConfirmation, workspaceRef])
}
