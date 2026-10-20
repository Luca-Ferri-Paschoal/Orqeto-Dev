import { projectIgnoreOutcomeFromResult } from "../../../operationOutcome"
import { createOperationOutcomeNotice } from "../../../operationOutcomeNotice"
import {
	isSafeIgnoreSuggestion,
	MAX_CONTEXT_CONTENT_BYTES,
} from "../../../projectContextSizeReport"
import type { FullProjectContextSummary } from "../../../types"
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

/** One serialized Dev Ignore update for the folders selected in the scan dialog. */
export function useIgnoreScannedFolder({
	workspaceRef,
	setFileExists,
	setOperationPending,
	updateQueueRef,
}: Options) {
	return useCallback(async (
		rootAtScan: string,
		summaryAtScan: FullProjectContextSummary,
		relativePaths: string[],
	): Promise<boolean> => {
		const current = workspaceRef.current
		if (current.rootFolder !== rootAtScan ||
			current.fullProjectContextSummary !== summaryAtScan ||
			summaryAtScan.byteCount <= MAX_CONTEXT_CONTENT_BYTES)
			return false
		const knownPaths = new Set(summaryAtScan.directories.map(dir => dir.path))
		const paths = [...new Set(relativePaths)]
		if (paths.length === 0 || paths.some(path => !isSafeIgnoreSuggestion(path) || !knownPaths.has(path)))
			return false
		// Parent directories supersede selected descendants.
		const distinctPaths = paths.filter(path => !paths.some(parent => parent !== path && path.startsWith(`${parent}/`)))
		setOperationPending(true)
		let updated = false
		const operation = updateQueueRef.current.catch(() => undefined).then(async () => {
			if (workspaceRef.current.rootFolder !== rootAtScan ||
				workspaceRef.current.fullProjectContextSummary !== summaryAtScan)
				return
			const absolutePaths = await Promise.all(distinctPaths.map(path =>
				join(
					rootAtScan,
					...path.split("/"),
				)))
			if (workspaceRef.current.rootFolder !== rootAtScan ||
				workspaceRef.current.fullProjectContextSummary !== summaryAtScan)
				return
			if (!await projectIgnoreExists(rootAtScan))
				await createProjectIgnore(rootAtScan)
			if (workspaceRef.current.rootFolder !== rootAtScan ||
				workspaceRef.current.fullProjectContextSummary !== summaryAtScan)
				return
			const result = await updateProjectIgnore(
				rootAtScan,
				absolutePaths,
				true,
			)
			setFileExists(
				rootAtScan,
				true,
			)
			if (workspaceRef.current.rootFolder !== rootAtScan)
				return
			workspaceRef.current.invalidateFullProjectContextScan()
			updated = true
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
			if (workspaceRef.current.rootFolder === rootAtScan) {
				workspaceRef.current.publishNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						workspaceRef.current.locale,
					),
				})
			}
			throw error
		} finally {
			setOperationPending(false)
		}
		if (updated && workspaceRef.current.rootFolder === rootAtScan)
			await workspaceRef.current.refreshFullProjectContextSummary()
		return updated
	}, [setFileExists, setOperationPending, updateQueueRef, workspaceRef])
}
