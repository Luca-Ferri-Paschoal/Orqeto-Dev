import type { ContextMode } from "../../../types"
import {
	type ContextWorkspace,
	useContextWorkspace,
	type WorkspaceConfirmationRequest,
} from "../../../useContextWorkspace"
import type { ProjectWorkspacePaneProps } from "../types"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

type Options = Pick<
	ProjectWorkspacePaneProps,
	| "tabId" |
	"active" |
	"initialRootFolder" |
	"folderPickerReferenceRoot" |
	"preferences" |
	"onRootFolderChange" |
	"onContextModeChange"
> & {
	requestConfirmation: (request: WorkspaceConfirmationRequest) => Promise<boolean>
}

function resolveContextMode(
	requested: ContextMode,
	workspace: ContextWorkspace,
	lintFixAvailable: boolean,
	testAvailable: boolean,
	logsAvailable: boolean,
): ContextMode {
	if (workspace.rootFolder === null)
		return "create"
	if (requested === "commit" && !workspace.isGitRepository)
		return "create"
	if (requested === "typecheck" && !workspace.diagnosticCapabilities.typecheck)
		return "create"
	if (requested === "lintfix" && !lintFixAvailable)
		return "create"
	if (requested === "eslint" && !workspace.diagnosticCapabilities.eslint)
		return "create"
	if (requested === "test" && !testAvailable)
		return "create"
	if (requested === "logs" && !logsAvailable)
		return "create"
	return requested
}

export function useProjectWorkspaceMode({
	tabId,
	active,
	initialRootFolder,
	folderPickerReferenceRoot,
	preferences,
	onRootFolderChange,
	onContextModeChange,
	requestConfirmation,
}: Options) {
	const [requestedContextMode, setRequestedContextMode] = useState<ContextMode>("create")
	const onRootFolderChangeRef = useRef(onRootFolderChange)
	useEffect(() => {
		onRootFolderChangeRef.current = onRootFolderChange
	}, [onRootFolderChange])

	const changeRootFolder = useCallback(async (rootFolder: string | null): Promise<boolean> => {
		const changed = await onRootFolderChangeRef.current(rootFolder)
		if (changed)
			setRequestedContextMode("create")
		return changed
	}, [])
	const workspace = useContextWorkspace({
		active,
		initialRootFolder,
		folderPickerReferenceRoot,
		preferences,
		onRootFolderChange: changeRootFolder,
		requestConfirmation,
	})
	const workspaceRef = useRef(workspace)
	useEffect(() => {
		workspaceRef.current = workspace
	}, [workspace])

	const lintFixAvailable = workspace.diagnosticCapabilities.lintFixCommand !== null || workspace.diagnosticCapabilities.eslint
	const testAvailable = workspace.diagnosticCapabilities.testCommand !== null
	const logsAvailable = workspace.diagnosticCapabilities.developmentLogCommand !== null
	const contextMode = resolveContextMode(
		requestedContextMode,
		workspace,
		lintFixAvailable,
		testAvailable,
		logsAvailable,
	)
	const contextModeRef = useRef<ContextMode>("create")
	useEffect(() => {
		contextModeRef.current = contextMode
		onContextModeChange(
			tabId,
			contextMode,
		)
	}, [contextMode, onContextModeChange, tabId])

	return {
		workspace,
		workspaceRef,
		contextMode,
		contextModeRef,
		requestedContextMode,
		setRequestedContextMode,
		lintFixAvailable,
		testAvailable,
		logsAvailable,
	}
}
