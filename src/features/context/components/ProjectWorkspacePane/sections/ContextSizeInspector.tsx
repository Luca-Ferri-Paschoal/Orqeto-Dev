import { formatByteSize } from "../../../formatGeneratedContent"
import {
	childrenOfDirectory,
	MAX_CONTEXT_CONTENT_BYTES,
} from "../../../projectContextSizeReport"
import type { FullProjectContextSummary } from "../../../types"
import type { Locale } from "@/infra/i18n"
import { translate } from "@/infra/i18n"
import {
	useMemo,
	useState,
} from "react"

interface Props {
	summary: FullProjectContextSummary | null
	locale: Locale
	pathsOnly: boolean
	disabled: boolean
	onIgnore: (relativePath: string) => void
}

export function ContextSizeInspector({ summary, locale, pathsOnly, disabled, onIgnore }: Props) {
	const [openedPath, setOpenedPath] = useState("")
	const directories = summary?.directories
	const path = openedPath && directories?.some(dir => dir.path === openedPath) ?
		openedPath :
		""
	const children = useMemo(
		() => childrenOfDirectory(
			directories ?? [],
			path,
		),
		[directories, path],
	)
	if (summary === null || pathsOnly || summary.byteCount <= MAX_CONTEXT_CONTENT_BYTES)
		return null

	const parentPath = path.includes("/") ?
		path.slice(
			0,
			path.lastIndexOf("/"),
		) :
		""
	return (
		<section className="mt-3 space-y-2 rounded-lg border border-[var(--border-color-strong)] p-3" aria-label={translate(
			locale,
			"folder.projectContext.sizeTitle",
		)}>
			<div className="text-sm font-semibold">{translate(
				locale,
				"folder.projectContext.sizeTitle",
			)}</div>
			<p className="text-xs text-[var(--font-color-secondary)]">
				{translate(
					locale,
					"folder.projectContext.sizeWarning",
					{ size: formatByteSize(summary.byteCount) },
				)}
			</p>
			{path && (
				<div className="flex items-center gap-2 text-xs">
					<button type="button" className="underline" onClick={() => setOpenedPath(parentPath)}>{translate(
						locale,
						"folder.projectContext.sizeBack",
					)}</button>
					<span className="min-w-0 flex-1 break-all font-semibold">{path}/</span>
					<button type="button" className="shrink-0 rounded border border-[var(--border-color-strong)] px-2 py-1" disabled={disabled} onClick={() => onIgnore(path)}>{translate(
						locale,
						"folder.projectContext.sizeIgnore",
					)}</button>
				</div>
			)}
			<ul className="max-h-64 space-y-2 overflow-auto">
				{children.slice(
					0,
					12,
				).map(child => (
					<li key={child.path} className="rounded-md border border-[var(--border-color)] p-2">
						<div className="flex min-w-0 items-start justify-between gap-2">
							<button type="button" className="min-w-0 break-all text-left text-xs font-semibold underline" onClick={() => setOpenedPath(child.path)}>
								{child.path.slice(path ?
									path.length + 1 :
									0)}/
							</button>
							<span className="shrink-0 text-xs tabular-nums">{formatByteSize(child.byteCount)}</span>
						</div>
						<div className="mt-1 flex flex-wrap items-center justify-between gap-2">
							<span className="text-xs text-[var(--font-color-secondary)]">
								{translate(
									locale,
									"folder.projectContext.sizeLabel",
									{ files: child.fileCount, size: formatByteSize(child.byteCount) },
								)}
							</span>
							<button type="button" className="rounded border border-[var(--border-color-strong)] px-2 py-1 text-xs hover:bg-[var(--background-3)] disabled:opacity-50" disabled={disabled} onClick={() => onIgnore(child.path)}>
								{translate(
									locale,
									"folder.projectContext.sizeIgnore",
								)}
							</button>
						</div>
					</li>
				))}
			</ul>
			{children.length === 0 && <p className="text-xs text-[var(--font-color-secondary)]">{translate(
				locale,
				"folder.projectContext.noSubfolders",
			)}</p>}
			{children.length > 12 && <p className="text-xs text-[var(--font-color-secondary)]">{translate(
				locale,
				"folder.projectContext.showTop",
				{ count: children.length },
			)}</p>}
			<p className="text-xs text-[var(--font-color-secondary)]">{translate(
				locale,
				"folder.projectContext.sizeRescan",
			)}</p>
		</section>
	)
}
