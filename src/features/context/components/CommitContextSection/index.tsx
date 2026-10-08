import { CommitComparisonPicker } from "./CommitComparisonPicker"
import { ContextExportActions } from "@/features/context/components/ContextExportActions"
import type { ContextWorkspace } from "@/features/context/useContextWorkspace"
import { translate } from "@/infra/i18n"
import { Button } from "@/shared/components/Button"
import { useState } from "react"

interface Props {
	workspace: ContextWorkspace
	rootFolder: string
	active: boolean
	disabled: boolean
	metadata: string | null
	busy: boolean
	generated: boolean
	onGenerate: () => void
	onCopy: () => void
	onDownload: () => void
}

export function CommitContextSection(props: Props) {
	const [mode, setMode] = useState<"current" | "compare">("current")
	return (
		<section className="min-w-0">
			<div className="mt-3 flex flex-wrap gap-1.5">
				<Button variant={mode === "current" ?
					"primary" :
					"secondary"} disabled={props.disabled} onClick={() => setMode("current")}>
					{translate(
						props.workspace.locale,
						"commitCompare.current",
					)}
				</Button>
				<Button variant={mode === "compare" ?
					"primary" :
					"secondary"} disabled={props.disabled} onClick={() => setMode("compare")}>
					{translate(
						props.workspace.locale,
						"commitCompare.mode",
					)}
				</Button>
			</div>
			{mode === "current" ?
				(
					<ContextExportActions
						locale={props.workspace.locale}
						metadata={props.workspace.gitCommitContextVariant === "current" ?
							props.metadata :
							null}
						busy={props.busy}
						disabled={props.disabled}
						generated={props.generated && props.workspace.gitCommitContextVariant === "current"}
						onGenerate={props.onGenerate}
						onCopy={props.onCopy}
						onDownload={props.onDownload}
					/>
				) :
				(
					<CommitComparisonPicker
						workspace={props.workspace}
						rootFolder={props.rootFolder}
						active={props.active}
						disabled={props.disabled}
						onCopy={props.onCopy}
						onDownload={props.onDownload}
					/>
				)}
		</section>
	)
}
