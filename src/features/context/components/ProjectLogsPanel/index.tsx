import { formatLogTime } from "./helpers"
import { styles } from "./style"
import { useProjectLogs } from "./useProjectLogs"
import type { Locale } from "@/infra/i18n"
import { translate } from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import {
	useEffect,
	useRef,
} from "react"

interface Props {
	rootFolder: string
	locale: Locale
	command: string
	clearAfterCopy: boolean
	disabled: boolean
	active: boolean
	requestConfirmation: (request: {
		title: string
		message: string
		confirmLabel: string
		cancelLabel: string
	}) => Promise<boolean>
	onError: (message: string) => void
}

export function ProjectLogsPanel(props: Props) {
	const logs = useProjectLogs({
		rootFolder: props.rootFolder,
		locale: props.locale,
		command: props.command,
		clearAfterCopy: props.clearAfterCopy,
		active: props.active,
		requestConfirmation: props.requestConfirmation,
		onError: props.onError,
	})
	const listRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const element = listRef.current
		if (element !== null)
			element.scrollTop = element.scrollHeight
	}, [logs.entries])

	const status = logs.running ?
		translate(
			props.locale,
			"logs.running",
		) :
		logs.exitCode === null ?
			translate(
				props.locale,
				"logs.stopped",
			) :
			translate(
				props.locale,
				"logs.finished",
				{ code: logs.exitCode },
			)
	const buttonDisabled = props.disabled || logs.isBusy

	return (
		<section className={styles.container}>
			<div className={styles.header}>
				<div className={styles.statusGroup}>
					<div className={styles.status}>{status}</div>
					<div className={styles.command} title={logs.effectiveCommand}>{logs.effectiveCommand}</div>
				</div>
				<div className={styles.actions}>
					<Button variant="secondary" disabled={buttonDisabled || logs.running} onClick={() => void logs.start()}>
						{translate(
							props.locale,
							logs.isStarting ?
								"logs.starting" :
								"logs.start",
						)}
					</Button>
					<Button variant="secondary" disabled={buttonDisabled || !logs.running} onClick={() => void logs.stop()}>
						{translate(
							props.locale,
							logs.isStopping ?
								"logs.stopping" :
								"logs.stop",
						)}
					</Button>
					<Button variant="secondary" disabled={buttonDisabled || logs.entries.length === 0} onClick={() => void logs.copy()}>
						{translate(
							props.locale,
							"logs.copy",
						)}
					</Button>
					<Button disabled={buttonDisabled || logs.entries.length === 0} onClick={() => void logs.download()}>
						{translate(
							props.locale,
							"logs.download",
						)}
					</Button>
					<Button variant="secondary" disabled={buttonDisabled || logs.entries.length === 0} onClick={() => void logs.clear()}>
						{translate(
							props.locale,
							"logs.clear",
						)}
					</Button>
				</div>
			</div>
			<div ref={listRef} className={styles.logList} aria-live="polite">
				{logs.entries.length === 0 ?
					<div className={styles.empty}>{translate(
						props.locale,
						"logs.empty",
					)}</div> :
					logs.entries.map(entry => (
						<div key={entry.sequence} className={styles.entry}>
							<span className={styles.time}>{formatLogTime(
								props.locale,
								entry.timestampMs,
							)}</span>
							<span className={styles.stream}>{entry.stream}</span>
							<span className={styles.message}>{entry.message}</span>
						</div>
					))}
			</div>
			{logs.truncated && <div className={styles.warning}>{translate(
				props.locale,
				"logs.truncated",
			)}</div>}
		</section>
	)
}
