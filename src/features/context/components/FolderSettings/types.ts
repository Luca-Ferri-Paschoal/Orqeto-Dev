import type {
	ContextMode,
	FolderAction,
} from "@/features/context/types"
import type { Locale } from "@/infra/i18n"
import type { ReactNode } from "react"

export type ContextSectionMode = "project" | "commit" | "validation" | "logs"

export interface FolderSettingsProps {
	rootFolder: string | null
	locale: Locale
	disabled?: boolean
	isGitRepository: boolean
	hasTypecheckContext: boolean
	hasLintFixAction: boolean
	hasEslintContext: boolean
	hasTestAction: boolean
	hasProjectLogs: boolean
	contextMode: ContextMode
	projectIgnoreExists: boolean | null
	vscodeAvailable: boolean
	expanded: boolean
	selectedAction: FolderAction
	children?: ReactNode
	headerAccessory?: ReactNode
	onExpandedChange: (expanded: boolean) => void
	onSelectedActionChange: (action: FolderAction) => void
	onContextModeChange: (mode: ContextSectionMode) => void
	onSelectFolder: () => void
	onOpenFolder: () => void
	onOpenVscode: () => void
	onCloseFolder: () => void
	onDevIgnore: () => void
}
