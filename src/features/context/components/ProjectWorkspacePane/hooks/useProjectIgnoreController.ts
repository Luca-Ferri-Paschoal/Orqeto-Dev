import { projectIgnoreOutcomeFromResult } from "../../../operationOutcome"
import { createOperationOutcomeNotice } from "../../../operationOutcomeNotice"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import { getErrorMessage } from "../../../utils"
import {
	createProjectIgnore,
	projectIgnoreExists,
	updateProjectIgnore,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import type { MutableRefObject } from "react"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

interface ProjectIgnoreStatus {
	rootFolder: string
	exists: boolean
}

interface UseProjectIgnoreControllerOptions {
	active: boolean
	ignoreDialogOpen: boolean
	onIgnoreDialogOpenChange: (open: boolean) => void
	workspace: ContextWorkspace
	workspaceRef: MutableRefObject<ContextWorkspace>
}

export function useProjectIgnoreController({
	active,
	ignoreDialogOpen,
	onIgnoreDialogOpenChange,
	workspace,
	workspaceRef,
}: UseProjectIgnoreControllerOptions) {
	const [status, setStatus] = useState<ProjectIgnoreStatus | null>(null)
	const [isUpdating, setIsUpdating] = useState(false)
	const dialogOpenRef = useRef(ignoreDialogOpen)
	const isUpdatingRef = useRef(isUpdating)
	const onDialogOpenChangeRef = useRef(onIgnoreDialogOpenChange)
	const updateQueueRef = useRef<Promise<void>>(Promise.resolve())
	const pendingOperationsRef = useRef(0)
	const addDropZoneRef = useRef<HTMLElement | null>(null)
	const removeDropZoneRef = useRef<HTMLElement | null>(null)
	const updateIgnorePathsRef = useRef<(
		paths: string[],
		ignorePaths: boolean,
		externalAction?: boolean,
	) => Promise<void>>(() => Promise.resolve())

	const rootFolder = workspace.rootFolder
	const fileExists = rootFolder === null ?
		false :
		status?.rootFolder === rootFolder ?
			status.exists :
			null

	const setFileExists = useCallback((rootFolder: string, exists: boolean): void => {
		setStatus({ rootFolder, exists })
	}, [])
	const setOperationPending = useCallback((pending: boolean): void => {
		pendingOperationsRef.current += pending ?
			1 :
			-1
		pendingOperationsRef.current = Math.max(
			0,
			pendingOperationsRef.current,
		)
		const next = pendingOperationsRef.current > 0
		isUpdatingRef.current = next
		setIsUpdating(next)
	}, [])

	useEffect(() => {
		dialogOpenRef.current = ignoreDialogOpen
	}, [ignoreDialogOpen])
	useEffect(() => {
		isUpdatingRef.current = isUpdating
	}, [isUpdating])
	useEffect(() => {
		onDialogOpenChangeRef.current = onIgnoreDialogOpenChange
	}, [onIgnoreDialogOpenChange])
	useEffect(() => {
		if (!active && ignoreDialogOpen)
			onDialogOpenChangeRef.current(false)
	}, [active, ignoreDialogOpen])

	useEffect(() => {
		let cancelled = false
		if (rootFolder === null) {
			onDialogOpenChangeRef.current(false)
			return
		}
		void projectIgnoreExists(rootFolder)
			.then(exists => {
				if (!cancelled) {
					setFileExists(
						rootFolder,
						exists,
					)
				}
			})
			.catch(error => {
				if (cancelled)
					return
				setFileExists(
					rootFolder,
					false,
				)
				workspaceRef.current.publishNotice({
					kind: "error",
					message: getErrorMessage(
						error,
						workspaceRef.current.locale,
					),
				})
			})
		return () => {
			cancelled = true
		}
	}, [rootFolder, setFileExists, workspaceRef])

	const updateIgnorePaths = useCallback(async (
		paths: string[],
		ignorePaths: boolean,
		externalAction = false,
	): Promise<void> => {
		const rootFolder = workspaceRef.current.rootFolder
		if (rootFolder === null) {
			if (externalAction) {
				throw new Error(translate(
					workspaceRef.current.locale,
					"workspace.externalNoProject",
				))
			}
			return
		}
		if (paths.length === 0)
			return
		if (!dialogOpenRef.current) {
			const message = translate(
				workspaceRef.current.locale,
				"devIgnore.externalClosed",
			)
			workspaceRef.current.publishNotice({ kind: "warning", message })
			if (externalAction)
				throw new Error(message)
			return
		}

		const uniquePaths = [...new Set(paths)]
		setOperationPending(true)
		const operation = updateQueueRef.current
			.catch(() => undefined)
			.then(async () => {
				workspaceRef.current.publishNotice(null)
				const result = await updateProjectIgnore(
					rootFolder,
					uniquePaths,
					ignorePaths,
				)
				setFileExists(
					rootFolder,
					true,
				)
				workspaceRef.current.publishNotice(createOperationOutcomeNotice(
					workspaceRef.current.locale,
					projectIgnoreOutcomeFromResult(
						rootFolder,
						ignorePaths,
						result,
					),
					ignorePaths ?
						"devIgnore.addedSummary" :
						"devIgnore.removedSummary",
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
			if (externalAction)
				throw error
		} finally {
			setOperationPending(false)
		}
	}, [setFileExists, setOperationPending, workspaceRef])

	useEffect(() => {
		updateIgnorePathsRef.current = updateIgnorePaths
	}, [updateIgnorePaths])

	const handleDevIgnore = useCallback(async (): Promise<void> => {
		const rootFolder = workspaceRef.current.rootFolder
		if (rootFolder === null || fileExists === null)
			return
		setOperationPending(true)
		workspaceRef.current.publishNotice(null)
		try {
			const exists = await projectIgnoreExists(rootFolder)
			setFileExists(
				rootFolder,
				exists,
			)
			if (exists) {
				onDialogOpenChangeRef.current(true)
				return
			}
			await createProjectIgnore(rootFolder)
			setFileExists(
				rootFolder,
				true,
			)
			workspaceRef.current.publishNotice({
				kind: "success",
				message: translate(
					workspaceRef.current.locale,
					"folder.devIgnore.created",
				),
			})
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
	}, [fileExists, setFileExists, setOperationPending, workspaceRef])

	return {
		addDropZoneRef,
		dialogOpenRef,
		fileExists,
		handleDevIgnore,
		isUpdating,
		isUpdatingRef,
		removeDropZoneRef,
		updateIgnorePaths,
		updateIgnorePathsRef,
	}
}
