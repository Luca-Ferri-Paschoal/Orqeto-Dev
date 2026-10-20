import { formatByteSize } from "../../../formatGeneratedContent"
import {
	type DirectorySizeEntry,
	MAX_CONTEXT_CONTENT_BYTES,
} from "../../../projectContextSizeReport"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

interface Props {
	entry: DirectorySizeEntry
	parentPath: string
	checked: boolean
	coveredByParent: boolean
	disabled: boolean
	locale: Locale
	onSelect: (path: string) => void
	onNavigate: (path: string) => void
}

export function ContextSizeRow({
	entry,
	parentPath,
	checked,
	coveredByParent,
	disabled,
	locale,
	onSelect,
	onNavigate,
}: Props) {
	return (
		<li
			className="rounded-md border border-[var(--border-color)] p-2"
		>
			<div className="flex items-center gap-2">
				<input
					type="checkbox"
					className="h-4 w-4 shrink-0"
					checked={checked || coveredByParent}
					disabled={disabled || coveredByParent}
					onChange={() => onSelect(entry.path)}
					aria-label={entry.path}
				/>
				<button
					type="button"
					className="min-w-0 flex-1 break-all text-left text-sm underline"
					disabled={disabled}
					onClick={() => onNavigate(entry.path)}
				>
					{`${entry.path.slice(parentPath ?
						parentPath.length + 1 :
						0)}/`}
				</button>
				<strong className="shrink-0 text-xs tabular-nums">
					{formatByteSize(entry.byteCount)}
				</strong>
			</div>
			<div className="mt-1 text-xs text-[var(--font-color-secondary)]">
				{translate(
					locale,
					"folder.projectContext.sizeLabel",
					{ files: entry.fileCount, size: formatByteSize(entry.byteCount) },
				)}
				{entry.byteCount > MAX_CONTEXT_CONTENT_BYTES ?
					` · ${translate(
						locale,
						"folder.projectContext.sizeAboveLimit",
					)}` :
					""}
			</div>
		</li>
	)
}
