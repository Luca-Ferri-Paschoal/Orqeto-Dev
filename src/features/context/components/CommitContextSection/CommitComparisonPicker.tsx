import { useCommitHistory } from "./useCommitHistory"
import { ContextExportActions } from "@/features/context/components/ContextExportActions"
import type { ContextWorkspace } from "@/features/context/useContextWorkspace"
import { translate } from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import {
	useId,
	useState,
} from "react"

interface Props {
	workspace: ContextWorkspace
	rootFolder: string
	active: boolean
	disabled: boolean
	onCopy: () => void
	onDownload: () => void
}

export function CommitComparisonPicker({ workspace, rootFolder, active, disabled, onCopy, onDownload }: Props) {
	const history = useCommitHistory(
		rootFolder,
		workspace.locale,
		active,
	)
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [search, setSearch] = useState("")
	const selectId = useId()
	const filter = search.toLocaleLowerCase(workspace.locale)
	const options = history.commits.filter(commit =>
		commit.hash === from || commit.hash === to ||
		`${commit.hash} ${commit.subject} ${commit.author}`.toLocaleLowerCase(workspace.locale).includes(filter))
	const selected = from.length > 0 && to.length > 0 && from !== to
	const comparison = workspace.gitCommitComparisonSelection
	const generated = workspace.gitCommitContextVariant === "compare" &&
		comparison?.from === from && comparison.to === to
	const busy = disabled || workspace.isGeneratingCommitContext
	const dateLabel = (value: string): string => {
		const date = new Date(value)
		return Number.isNaN(date.getTime()) ?
			value :
			date.toLocaleString(workspace.locale, {
				dateStyle: "short",
				timeStyle: "short",
			})
	}
	const labels = {
		from: translate(
			workspace.locale,
			"commitCompare.initial",
		),
		to: translate(
			workspace.locale,
			"commitCompare.final",
		),
	}

	return (
		<section className="mt-3 flex min-w-0 flex-col gap-3 border-t border-[var(--border-color)] pt-3">
			<div className="flex flex-wrap items-center gap-2">
				<input
					type="search"
					aria-label={translate(
						workspace.locale,
						"commitCompare.search",
					)}
					placeholder={translate(
						workspace.locale,
						"commitCompare.search",
					)}
					className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--background-2)] px-2 py-1.5 text-xs text-[var(--font-color)]"
					value={search}
					disabled={busy}
					onChange={event => setSearch(event.target.value)}
				/>
				<Button variant="secondary" disabled={busy || !history.loaded || history.loading} onClick={history.refresh}>
					{translate(
						workspace.locale,
						"commitCompare.refresh",
					)}
				</Button>
			</div>
			{(["from", "to"] as const).map(kind => (
				<div key={kind} className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${selectId}-${kind}`} className="text-xs font-semibold text-[var(--font-color-secondary)]">
						{labels[kind]}
					</label>
					<select
						id={`${selectId}-${kind}`}
						value={kind === "from" ?
							from :
							to}
						disabled={busy || history.commits.length === 0}
						className="min-w-0 max-w-full rounded-md border border-[var(--border-color)] bg-[var(--background-2)] p-2 text-xs text-[var(--font-color)]"
						onChange={event => (kind === "from" ?
							setFrom :
							setTo)(event.target.value)}
					>
						<option value="">{translate(
							workspace.locale,
							"commitCompare.select",
						)}</option>
						{options.map(commit => (
							<option value={commit.hash} key={commit.hash}>
								{`${commit.shortHash} · ${commit.subject} · ${commit.author} · ${dateLabel(commit.authoredAt)}`}
							</option>
						))}
					</select>
				</div>
			))}
			{!history.loaded && <p role="status" className="text-xs text-[var(--font-color-muted)]">
				{translate(
					workspace.locale,
					"commitCompare.loading",
				)}
			</p>}
			{history.error !== null && <p role="alert" className="text-xs text-[var(--danger-font-color)]">{history.error}</p>}
			{history.loaded && history.commits.length === 0 && history.error === null && (
				<p className="text-xs text-[var(--font-color-muted)]">{translate(
					workspace.locale,
					"commitCompare.empty",
				)}</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs text-[var(--font-color-muted)]">
					{translate(
						workspace.locale,
						"commitCompare.loaded",
						{ count: history.commits.length },
					)}
				</span>
				{history.hasMore && <Button variant="secondary" disabled={busy || history.loading} onClick={() => void history.loadMore()}>
					{translate(
						workspace.locale,
						"commitCompare.more",
					)}
				</Button>}
			</div>
			{generated && workspace.gitCommitComparisonStats !== null && <p className="text-xs text-[var(--font-color-secondary)]">
				{translate(workspace.locale, "commitCompare.summary", {
					files: workspace.gitCommitComparisonStats.fileCount,
					added: workspace.gitCommitComparisonStats.addedLines,
					deleted: workspace.gitCommitComparisonStats.deletedLines,
				})}
			</p>}
			{selected && <p className="text-xs text-[var(--font-color-secondary)]">
				{translate(
					workspace.locale,
					"commitCompare.direction",
					{
						from: from.slice(
							0,
							8,
						),
						to: to.slice(
							0,
							8,
						),
					},
				)}
			</p>}
			<ContextExportActions
				locale={workspace.locale}
				metadata={generated ?
					`${workspace.gitCommitContextByteCount ?? 0} B` :
					null}
				busy={workspace.isGeneratingCommitContext}
				disabled={disabled || !selected}
				generated={generated}
				onGenerate={() => void workspace.generateGitCommitComparisonReport(
					from,
					to,
				)}
				onCopy={onCopy}
				onDownload={onDownload}
			/>
			{!selected && <p className="text-xs text-[var(--font-color-muted)]">
				{translate(
					workspace.locale,
					"commitCompare.chooseTwo",
				)}
			</p>}
		</section>
	)
}
