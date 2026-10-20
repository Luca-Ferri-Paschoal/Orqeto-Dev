import { projectIgnoreOutcomeFromResult } from "../../../operationOutcome"
import { createOperationOutcomeNotice } from "../../../operationOutcomeNotice"
import { isSafeIgnoreSuggestion } from "../../../projectContextSizeReport"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import { getErrorMessage } from "../../../utils"
import {
	createProjectIgnore,
	projectIgnoreExists,
	updateProjectIgnore,
} from "@/infra/desktop"
import { join } from "@tauri-apps/api/path"
import type { MutableRefObject } from "react"
import { useCallback } from "react"

interface Options {
	workspaceRef: MutableRefObject<ContextWorkspace>
	setFileExists: (
		rootFolder: string,
		exists: boolean,
	) => void
	setOperationPending: (pending: boolean) => void
	updateQueueRef: MutableRefObject<Promise<void>>
}

/** Reuses the Dev Ignore queue so a scan shortcut cannot race dialog updates. */
export function useIgnoreScannedFolder({
	workspaceRef,
	setFileExists,
	setOperationPending,
	updateQueueRef,
}: Options) {
	return useCallback(async (rootAtScan: string, relativePath: string): Promise<void> => {
		if (!isSafeIgnoreSuggestion(relativePath) || workspaceRef.current.rootFolder !== rootAtScan)
			return
		setOperationPending(true)
		let didUpdate = false
		const operation = updateQueueRef.current.catch(() => undefined).then(async () => {
			if (workspaceRef.current.rootFolder !== rootAtScan)
				return
			const absolutePath = await join(
				rootAtScan,
				...relativePath.split("/"),
			)
			if (workspaceRef.current.rootFolder !== rootAtScan)
				return
			if (!await projectIgnoreExists(rootAtScan))
				await createProjectIgnore(rootAtScan)
			if (workspaceRef.current.rootFolder !== rootAtScan)
				return
			const result = await updateProjectIgnore(
				rootAtScan,
				[absolutePath],
				true,
			)
			setFileExists(
				rootAtScan,
				true,
			)
			if (workspaceRef.current.rootFolder !== rootAtScan)
				return
			workspaceRef.current.invalidateFullProjectContextScan()
			didUpdate = true
			workspaceRef.current.publishNotice(createOperationOutcomeNotice(
				workspaceRef.current.locale,
				projectIgnoreOutcomeFromResult(
					rootAtScan,
					true,
					result,
				),
				"devIgnore.addedSummary",
			))
		})
		updateQueueRef.current = operation.catch(() => undefined)
		try {
			await operation
		} catch (error) {
			workspaceRef.current.publishNotice({
				kind: "error",
				message: getErrorMessage(
					error,
					workspaceRef.current.locale,
				),
			})
		} finally {
			setOperationPending(false)
		}
		if (didUpdate && workspaceRef.current.rootFolder === rootAtScan)
			await workspaceRef.current.refreshFullProjectContextSummary()
	}, [setFileExists, setOperationPending, updateQueueRef, workspaceRef])
}
