import type { PendingExternalSelectionAction } from "../types"
import type { ProjectWorkspaceHandle } from "@/features/context/components/ProjectWorkspacePane"
import type {
	AppNotice,
	ContextMode,
	ProjectTab,
} from "@/features/context/types"
import {
	useRef,
	useState,
} from "react"

export function useAppState() {
	const [tabs, setTabs] = useState<ProjectTab[]>([])
	const [activeTabId, setActiveTabId] = useState("")
	const [tabsReady, setTabsReady] = useState(false)
	const [isSettingsOpen, setIsSettingsOpen] = useState(false)
	const [globalNotice, setGlobalNotice] = useState<AppNotice | null>(null)
	const [appVersion, setAppVersion] = useState("")
	const [lastRootFolder, setLastRootFolder] = useState<string | null>(null)
	const [isRoutingApply, setIsRoutingApply] = useState(false)
	const [ignoreDialogTabId, setIgnoreDialogTabId] = useState<string | null>(null)
	const [workspaceContextModes, setWorkspaceContextModes] = useState<Record<string, ContextMode>>({})
	const [workspaceBusyStates, setWorkspaceBusyStates] = useState<Record<string, boolean>>({})
	const [isSettingsOperationBusy, setIsSettingsOperationBusy] = useState(false)
	const [routingApplyTabId, setRoutingApplyTabId] = useState<string | null>(null)
	const [vscodeAvailable, setVscodeAvailable] = useState(false)
	const [recoveryBlocked, setRecoveryBlocked] = useState(false)
	const [isDiscardingRecovery, setIsDiscardingRecovery] = useState(false)

	const tabsRef = useRef<ProjectTab[]>([])
	const activeTabIdRef = useRef("")
	const workspaceHandlesRef = useRef(new Map<string, ProjectWorkspaceHandle>())
	const pendingExternalSelectionActionsRef = useRef(new Map<string, PendingExternalSelectionAction[]>())
	const ignoreDialogTabIdRef = useRef<string | null>(null)
	const initializationStartedRef = useRef(false)
	const processingExternalActionsRef = useRef(false)
	const externalActionsRequestedRef = useRef(false)
	const isClosingAppRef = useRef(false)
	const rootChangeRevisionsRef = useRef(new Map<string, number>())
	const tabOrderSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
	const activeTabSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
	const isRoutingApplyRef = useRef(false)
	const externalIntegrationWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

	return {
		tabs,
		setTabs,
		activeTabId,
		setActiveTabId,
		tabsReady,
		setTabsReady,
		isSettingsOpen,
		setIsSettingsOpen,
		globalNotice,
		setGlobalNotice,
		appVersion,
		setAppVersion,
		lastRootFolder,
		setLastRootFolder,
		isRoutingApply,
		setIsRoutingApply,
		ignoreDialogTabId,
		setIgnoreDialogTabId,
		workspaceContextModes,
		setWorkspaceContextModes,
		workspaceBusyStates,
		setWorkspaceBusyStates,
		isSettingsOperationBusy,
		setIsSettingsOperationBusy,
		routingApplyTabId,
		setRoutingApplyTabId,
		vscodeAvailable,
		setVscodeAvailable,
		recoveryBlocked,
		setRecoveryBlocked,
		isDiscardingRecovery,
		setIsDiscardingRecovery,
		tabsRef,
		activeTabIdRef,
		workspaceHandlesRef,
		pendingExternalSelectionActionsRef,
		ignoreDialogTabIdRef,
		initializationStartedRef,
		processingExternalActionsRef,
		externalActionsRequestedRef,
		isClosingAppRef,
		rootChangeRevisionsRef,
		tabOrderSaveQueueRef,
		activeTabSaveQueueRef,
		isRoutingApplyRef,
		externalIntegrationWriteQueueRef,
	}
}

export type AppState = ReturnType<typeof useAppState>
