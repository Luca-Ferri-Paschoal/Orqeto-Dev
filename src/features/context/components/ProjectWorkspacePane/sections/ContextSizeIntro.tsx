import { formatByteSize } from "../../../formatGeneratedContent"
import { MAX_CONTEXT_CONTENT_BYTES } from "../../../projectContextSizeReport"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

interface Props {
	titleId: string
	locale: Locale
	byteCount: number
	path: string
	hasSuggestions: boolean
	showDirectoryTree: boolean
	disabled: boolean
	onBack: () => void
	onToggleDirectoryTree: () => void
}

export function ContextSizeIntro({
	titleId,
	locale,
	byteCount,
	path,
	hasSuggestions,
	showDirectoryTree,
	disabled,
	onBack,
	onToggleDirectoryTree,
}: Props) {
	return (
		<>
			<h2 id={titleId} className="text-base font-bold">
				{translate(
					locale,
					"folder.projectContext.sizeTitle",
				)}
			</h2>
			<p className="mt-2 text-sm text-[var(--font-color-secondary)]">
				{translate(
					locale,
					byteCount > MAX_CONTEXT_CONTENT_BYTES ?
						"folder.projectContext.sizeWarning" :
						"folder.projectContext.sizeWithinLimit",
					{ size: formatByteSize(byteCount) },
				)}
			</p>
			<p className="mt-2 text-xs text-[var(--font-color-secondary)]">
				{translate(
					locale,
					"folder.projectContext.sizeDialogHint",
				)}
			</p>
			<div className="mt-3 flex items-center justify-between gap-2 text-xs">
				<span className="min-w-0 break-all font-semibold">
					{path ?
						`${path}/` :
						"./"}
				</span>
				{path && (
					<button
						type="button"
						className="shrink-0 underline"
						disabled={disabled}
						onClick={onBack}
					>
						{translate(
							locale,
							"folder.projectContext.sizeBack",
						)}
					</button>
				)}
			</div>
			{!path && hasSuggestions && (
				<button
					type="button"
					className="mt-2 text-xs underline"
					disabled={disabled}
					onClick={onToggleDirectoryTree}
				>
					{translate(
						locale,
						showDirectoryTree ?
							"folder.projectContext.sizeSuggestions" :
							"folder.projectContext.sizeAllFolders",
					)}
				</button>
			)}
		</>
	)
}
