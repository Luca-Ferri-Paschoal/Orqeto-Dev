import { formatByteSize } from "../../../formatGeneratedContent"
import type { ContextSizeFile } from "../../../projectContextSizeReport"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

interface Props {
	files: readonly ContextSizeFile[]
	selectedPaths: readonly string[]
	disabled: boolean
	locale: Locale
	onSelect: (path: string) => void
}

export function ContextSizeFileList({ files, selectedPaths, disabled, locale, onSelect }: Props) {
	if (files.length === 0)
		return null

	return (
		<div className="mt-3 space-y-1">
			<h3 className="text-xs font-semibold">
				{translate(
					locale,
					"folder.projectContext.sizeFilesTitle",
				)}
			</h3>
			<ul className="max-h-40 space-y-1 overflow-auto">
				{files.map(file => {
					const coveredByParent = selectedPaths.some(selected => file.relativePath.startsWith(`${selected}/`))
					return (
						<li key={file.relativePath} className="flex items-start gap-2 text-xs">
							<input
								type="checkbox"
								className="mt-0.5 h-4 w-4 shrink-0"
								checked={selectedPaths.includes(file.relativePath) || coveredByParent}
								disabled={disabled || coveredByParent}
								onChange={() => onSelect(file.relativePath)}
								aria-label={file.relativePath}
							/>
							<span className="min-w-0 flex-1 break-all">{file.relativePath}</span>
							<strong className="shrink-0 tabular-nums">{formatByteSize(file.sizeBytes)}</strong>
						</li>
					)
				})}
			</ul>
		</div>
	)
}
