import {
	copyProjectLogs,
	downloadProjectLogs,
} from "./exports"
import { retainBoundedEntries } from "./helpers"
import {
	emptyProjectLogsViewState,
	projectLogTrustKey,
	trustedProjectLogCommands,
} from "./state"
import type { ProjectLogsOptions } from "./types"
import type {
	ProjectLogEntry,
	ProjectLogSnapshot,
} from "@/features/context/types"
import { getErrorMessage } from "@/features/context/utils"
import {
	approveProjectLogCommand,
	clearProjectLogSession,
	getProjectLogSnapshot,
	startProjectLogSession,
	stopProjectLogSession,
} from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

const POLL_INTERVAL_MS = 300

export function useProjectLogs(options: ProjectLogsOptions) {
	const { rootFolder, locale, command, clearAfterCopy, active, requestConfirmation, onError } = options
	const onErrorRef = useRef(onError)
	const [viewState, setViewState] = useState(() => emptyProjectLogsViewState(rootFolder))
	const [isStarting, setIsStarting] = useState(false)
	const [isStopping, setIsStopping] = useState(false)
	const [isExporting, setIsExporting] = useState(false)
	const sessionIdRef = useRef<string | null>(null)
	const cursorRef = useRef(0)
	const entriesRef = useRef<ProjectLogEntry[]>([])
	const locallyTruncatedRef = useRef(false)
	const snapshotEpochRef = useRef(0)
	const refreshInFlightRef = useRef(false)
	const snapshotMutationRef = useRef(false)
	const currentView = viewState.rootFolder === rootFolder ?
		viewState :
		emptyProjectLogsViewState(rootFolder)

	useEffect(() => {
		onErrorRef.current = onError
	}, [onError])

	const applySnapshot = useCallback((snapshot: ProjectLogSnapshot) => {
		let nextEntries = entriesRef.current
		if (snapshot.sessionId !== sessionIdRef.current) {
			sessionIdRef.current = snapshot.sessionId
			const retained = retainBoundedEntries(snapshot.entries)
			locallyTruncatedRef.current = retained.truncated
			nextEntries = retained.entries
		} else if (snapshot.entries.length > 0) {
			const retained = retainBoundedEntries([
				...entriesRef.current,
				...snapshot.entries,
			])
			locallyTruncatedRef.current ||= retained.truncated
			nextEntries = retained.entries
		}
		entriesRef.current = nextEntries
		cursorRef.current = snapshot.latestSequence
		setViewState({
			rootFolder,
			entries: nextEntries,
			sessionCommand: snapshot.command,
			running: snapshot.running,
			exitCode: snapshot.exitCode,
			truncated: snapshot.truncated || locallyTruncatedRef.current,
		})
	}, [rootFolder])

	const refresh = useCallback(async () => {
		if (!active || snapshotMutationRef.current || refreshInFlightRef.current)
			return
		refreshInFlightRef.current = true
		const epoch = snapshotEpochRef.current
		try {
			const snapshot = await getProjectLogSnapshot(
				rootFolder,
				cursorRef.current,
			)
			if (epoch === snapshotEpochRef.current && !snapshotMutationRef.current)
				applySnapshot(snapshot)
		} catch (error) {
			onErrorRef.current(getErrorMessage(
				error,
				locale,
			))
		} finally {
			refreshInFlightRef.current = false
		}
	}, [active, applySnapshot, locale, rootFolder])

	useEffect(() => {
		snapshotEpochRef.current += 1
		sessionIdRef.current = null
		cursorRef.current = 0
		entriesRef.current = []
		locallyTruncatedRef.current = false
		void refresh()
		const interval = window.setInterval(
			() => void refresh(),
			POLL_INTERVAL_MS,
		)
		return () => window.clearInterval(interval)
	}, [refresh, rootFolder])

	async function start(): Promise<void> {
		if (currentView.running || isStarting)
			return
		setIsStarting(true)
		snapshotMutationRef.current = true
		snapshotEpochRef.current += 1
		try {
			const key = projectLogTrustKey(
				rootFolder,
				command,
			)
			if (!trustedProjectLogCommands.has(key)) {
				const approved = await requestConfirmation({
					title: translate(
						locale,
						"logs.trustTitle",
					),
					message: translate(
						locale,
						"logs.trustMessage",
						{ command },
					),
					confirmLabel: translate(
						locale,
						"logs.start",
					),
					cancelLabel: translate(
						locale,
						"app.loading.cancel",
					),
				})
				if (!approved)
					return
				await approveProjectLogCommand(
					rootFolder,
					command,
				)
				trustedProjectLogCommands.add(key)
			}
			const snapshot = await startProjectLogSession(rootFolder)
			sessionIdRef.current = null
			cursorRef.current = 0
			entriesRef.current = []
			applySnapshot(snapshot)
		} catch (error) {
			onErrorRef.current(getErrorMessage(
				error,
				locale,
			))
		} finally {
			snapshotMutationRef.current = false
			setIsStarting(false)
		}
	}

	async function stop(): Promise<void> {
		if (!currentView.running || isStopping)
			return
		setIsStopping(true)
		try {
			await stopProjectLogSession(rootFolder)
			await refresh()
		} catch (error) {
			onErrorRef.current(getErrorMessage(
				error,
				locale,
			))
		} finally {
			setIsStopping(false)
		}
	}

	async function clear(): Promise<void> {
		snapshotMutationRef.current = true
		snapshotEpochRef.current += 1
		try {
			const result = await clearProjectLogSession(rootFolder)
			cursorRef.current = result.cursor
			entriesRef.current = []
			locallyTruncatedRef.current = false
			setViewState(previous => previous.rootFolder === rootFolder ?
				{
					...previous,
					entries: [],
					truncated: false,
				} :
				previous)
		} catch (error) {
			onErrorRef.current(getErrorMessage(
				error,
				locale,
			))
		} finally {
			snapshotMutationRef.current = false
			void refresh()
		}
	}

	const effectiveCommand = currentView.sessionCommand ?? command
	async function copy(): Promise<void> {
		if (currentView.entries.length === 0 || isExporting)
			return
		setIsExporting(true)
		if (clearAfterCopy) {
			snapshotMutationRef.current = true
			snapshotEpochRef.current += 1
		}
		try {
			const result = await copyProjectLogs({
				rootFolder,
				locale,
				effectiveCommand,
				clearAfterCopy,
			})
			if (result.clearedCursor !== null) {
				cursorRef.current = result.clearedCursor
				entriesRef.current = []
				locallyTruncatedRef.current = false
				setViewState(previous => previous.rootFolder === rootFolder ?
					{
						...previous,
						entries: [],
						truncated: false,
					} :
					previous)
			}
		} catch (error) {
			onErrorRef.current(getErrorMessage(
				error,
				locale,
			))
		} finally {
			if (clearAfterCopy) {
				snapshotMutationRef.current = false
				void refresh()
			}
			setIsExporting(false)
		}
	}

	async function download(): Promise<void> {
		if (currentView.entries.length === 0 || isExporting)
			return
		setIsExporting(true)
		try {
			await downloadProjectLogs({
				rootFolder,
				locale,
				effectiveCommand,
			})
		} catch (error) {
			onErrorRef.current(getErrorMessage(
				error,
				locale,
			))
		} finally {
			setIsExporting(false)
		}
	}

	return {
		clear,
		copy,
		download,
		effectiveCommand,
		entries: currentView.entries,
		exitCode: currentView.exitCode,
		isBusy: isStarting || isStopping || isExporting,
		isStarting,
		isStopping,
		running: currentView.running,
		start,
		stop,
		truncated: currentView.truncated,
	}
}
