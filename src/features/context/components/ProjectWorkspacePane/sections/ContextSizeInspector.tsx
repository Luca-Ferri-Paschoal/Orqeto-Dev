import { formatByteSize } from "../../../formatGeneratedContent"
import {
	childrenOfDirectory,
	largestOverBudgetFolders,
	MIN_CONTEXT_DIAGNOSTIC_BYTES,
} from "../../../projectContextSizeReport"
import type { FullProjectContextSummary } from "../../../types"
import { ContextSizeFileList } from "./ContextSizeFileList"
import { ContextSizeIntro } from "./ContextSizeIntro"
import { ContextSizeRow } from "./ContextSizeRow"
import {
	type Locale,
	translate,
} from "@/infra/i18n"
import { Dialog } from "@/shared/components/Dialog"
import {
	useId,
	useState,
} from "react"

interface Props {
	summary: FullProjectContextSummary | null
	locale: Locale
	pathsOnly: boolean
	disabled: boolean
	onIgnore: (
		summary: FullProjectContextSummary,
		paths: string[],
	) => Promise<boolean>
}

/** A scan opens this modal. Ignore rules are changed only by explicit confirmation. */
export function ContextSizeInspector({
	summary,
	locale,
	pathsOnly,
	disabled,
	onIgnore,
}: Props) {
	const titleId = useId()
	const [dismissedSummary, setDismissedSummary] = useState<FullProjectContextSummary | null>(null)
	const [selection, setSelection] = useState<{ summary: FullProjectContextSummary | null; paths: string[] }>({ summary: null, paths: [] })
	const [openedPath, setOpenedPath] = useState("")
	const [openedForSummary, setOpenedForSummary] = useState<FullProjectContextSummary | null>(null)
	const [isSaving, setIsSaving] = useState(false)
	const [errorState, setErrorState] = useState<{ summary: FullProjectContextSummary | null; message: string }>({ summary: null, message: "" })
	const [showAll, setShowAll] = useState(false)
	const [showDirectoryTree, setShowDirectoryTree] = useState(false)
	const selectedPaths = selection.summary === summary ?
		selection.paths :
		[]
	const errorMessage = errorState.summary === summary ?
		errorState.message :
		""

	if (summary === null || pathsOnly || summary.byteCount < MIN_CONTEXT_DIAGNOSTIC_BYTES || summary === dismissedSummary)
		return null

	const directories = summary.directories
	const largestFiles = summary.largestFiles ?? []
	const path = openedForSummary === summary && directories.some(dir => dir.path === openedPath) ?
		openedPath :
		""
	const suggestions = largestOverBudgetFolders(directories)
	const children = !path && !(openedForSummary === summary && showDirectoryTree) && suggestions.length > 0 ?
		suggestions :
		childrenOfDirectory(
			directories,
			path,
		)
	const visibleChildren = openedForSummary === summary && showAll ?
		children :
		children.slice(
			0,
			15,
		)
	const parentPath = path.includes("/") ?
		path.slice(
			0,
			path.lastIndexOf("/"),
		) :
		""
	const validSelections = selectedPaths.filter(selected => directories.some(dir => dir.path === selected) || largestFiles.some(file => file.relativePath === selected))
	const selectedBytes = validSelections.reduce((sum, selected) => sum + (
		directories.find(dir => dir.path === selected)?.byteCount ??
		largestFiles.find(file => file.relativePath === selected)?.sizeBytes ?? 0
	), 0)
	const remainingBytes = Math.max(
		0,
		summary.byteCount - selectedBytes,
	)

	function togglePath(selected: string): void {
		setSelection(previous => {
			const paths = previous.summary === summary ?
				previous.paths :
				[]
			return {
				summary,
				paths: paths.includes(selected) ?
					paths.filter(item => item !== selected) :
					[...paths.filter(item => !item.startsWith(`${selected}/`) && !selected.startsWith(`${item}/`)), selected],
			}
		})
	}

	function navigate(to: string): void {
		setOpenedForSummary(summary)
		setOpenedPath(to)
		setShowAll(false)
	}

	async function confirm(): Promise<void> {
		if (summary === null || isSaving || disabled || validSelections.length === 0)
			return
		setErrorState({ summary, message: "" })
		setIsSaving(true)
		try {
			const applied = await onIgnore(
				summary,
				validSelections,
			)
			if (applied) {
				setDismissedSummary(summary)
				setSelection({ summary: null, paths: [] })
				setOpenedPath("")
			}
		} catch (error) {
			setErrorState({
				summary,
				message: error instanceof Error ?
					error.message :
					String(error),
			})
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<Dialog
			backdropClassName="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--overlay-background)] p-4"
			dialogClassName="w-full max-w-[34rem] rounded-xl border border-[var(--border-color)] bg-[var(--background-2)] p-4 shadow-2xl"
			labelledBy={titleId}
			disabled={isSaving || disabled}
			onCancel={() => setDismissedSummary(summary)}
		>
			<ContextSizeIntro
				titleId={titleId}
				locale={locale}
				byteCount={summary.byteCount}
				path={path}
				hasSuggestions={suggestions.length > 0}
				showDirectoryTree={openedForSummary === summary && showDirectoryTree}
				disabled={isSaving}
				onBack={() => navigate(parentPath)}
				onToggleDirectoryTree={() => {
					setOpenedForSummary(summary)
					setShowDirectoryTree(previous => !previous)
					setShowAll(false)
				}}
			/>
			<ul
				className="mt-2 max-h-[45vh] space-y-1 overflow-auto"
				aria-label={translate(
					locale,
					"folder.projectContext.sizeTitle",
				)}
			>
				{visibleChildren.map(child => (
					<ContextSizeRow
						key={child.path}
						entry={child}
						parentPath={path}
						checked={validSelections.includes(child.path)}
						coveredByParent={validSelections.some(selected => child.path.startsWith(`${selected}/`))}
						disabled={disabled || isSaving}
						locale={locale}
						onSelect={togglePath}
						onNavigate={navigate}
					/>
				))}
			</ul>
			{children.length > visibleChildren.length && (
				<button
					type="button"
					className="mt-2 text-xs underline"
					onClick={() => setShowAll(true)}
				>
					{translate(
						locale,
						"folder.projectContext.sizeShowAll",
						{ count: children.length - visibleChildren.length },
					)}
				</button>
			)}
			{!path && (
				<ContextSizeFileList
					files={largestFiles}
					selectedPaths={validSelections}
					disabled={disabled || isSaving}
					locale={locale}
					onSelect={togglePath}
				/>
			)}
			{children.length === 0 && largestFiles.length === 0 && (
				<p className="mt-2 text-xs text-[var(--font-color-secondary)]">
					{translate(
						locale,
						"folder.projectContext.sizeNoFolders",
					)}
				</p>
			)}
			<p className="mt-3 text-xs text-[var(--font-color-secondary)]">
				{translate(
					locale,
					"folder.projectContext.sizeProjected",
					{ size: formatByteSize(remainingBytes) },
				)}
			</p>
			{errorMessage && (
				<p
					role="alert"
					className="mt-2 text-xs text-[var(--danger-font-color)]"
				>
					{errorMessage}
				</p>
			)}
			<div className="mt-3 flex justify-end gap-2">
				<button
					type="button"
					className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm"
					disabled={isSaving}
					onClick={() => setDismissedSummary(summary)}
				>
					{translate(
						locale,
						"folder.projectContext.sizeCancel",
					)}
				</button>
				<button
					type="button"
					className="rounded-md bg-[var(--button-color)] px-3 py-2 text-sm font-semibold text-[var(--button-font-color)] disabled:opacity-50"
					disabled={disabled || isSaving || validSelections.length === 0}
					onClick={() => void confirm()}
				>
					{translate(
						locale,
						"folder.projectContext.sizeIgnoreSelected",
						{ count: validSelections.length },
					)}
				</button>
			</div>
		</Dialog>
	)
}
