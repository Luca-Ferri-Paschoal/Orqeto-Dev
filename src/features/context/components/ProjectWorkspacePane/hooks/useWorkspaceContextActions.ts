import { formatByteSize } from "../../../formatGeneratedContent"
import type { ContextMode } from "../../../types"
import type { ContextWorkspace } from "../../../useContextWorkspace"
import type { ContextSectionMode } from "../../FolderSettings"
import {
	translate,
	translateCount,
} from "@/infra/i18n"
import type {
	Dispatch,
	SetStateAction,
} from "react"

interface InteractionState {
	isGeneratingCommitContext: boolean
	isGeneratingProjectContext: boolean
	isInspectingProjectContext: boolean
	diagnosticContextKind: "typecheck" | "eslint" | null
}

export function useWorkspaceContextActions(
	workspace: ContextWorkspace,
	contextMode: ContextMode,
	lintFixAvailable: boolean,
	interaction: InteractionState,
	setRequestedContextMode: Dispatch<SetStateAction<ContextMode>>,
) {
	const projectContextMetadata = contextMode === "project" ?
		interaction.isInspectingProjectContext && workspace.fullProjectContextSummary === null ?
			translate(
				workspace.locale,
				"folder.projectContext.calculating",
			) :
			workspace.fullProjectContextSummary === null ?
				null :
				translateCount(
					workspace.locale,
					workspace.fullProjectContextSummary.fileCount,
					"context.summary.one",
					"context.summary.other",
					{ size: formatByteSize(workspace.fullProjectContextSummary.byteCount) },
				) :
		null
	const preparedContextByteCount = contextMode === "commit" ?
		workspace.gitCommitContextByteCount :
		contextMode === "typecheck" ?
			workspace.diagnosticContextByteCounts.typecheck :
			contextMode === "lintfix" ?
				workspace.validationCommandContextByteCounts.lintfix :
				contextMode === "eslint" ?
					workspace.diagnosticContextByteCounts.eslint :
					contextMode === "test" ?
						workspace.validationCommandContextByteCounts.test :
						null
	const metadata = projectContextMetadata ?? (preparedContextByteCount === null ?
		null :
		formatByteSize(preparedContextByteCount))
	const hasGenerateStep = contextMode === "project" || contextMode === "commit"
	const generated = contextMode === "project" ?
		workspace.fullProjectContextSummary !== null :
		contextMode !== "create" && preparedContextByteCount !== null
	const busy = contextMode === "project" ?
		interaction.isGeneratingProjectContext || interaction.isInspectingProjectContext :
		contextMode === "commit" ?
			interaction.isGeneratingCommitContext :
			contextMode === "typecheck" ?
				interaction.diagnosticContextKind === "typecheck" :
				contextMode === "lintfix" ?
					workspace.validationCommandKind === "lintfix" :
					contextMode === "eslint" ?
						interaction.diagnosticContextKind === "eslint" :
						contextMode === "test" && workspace.validationCommandKind === "test"

	function changeMode(mode: ContextSectionMode): void {
		if (mode === "project") {
			if (contextMode !== "create" && contextMode !== "project")
				setRequestedContextMode("create")
			return
		}
		if (mode === "commit") {
			setRequestedContextMode("commit")
			return
		}
		if (mode === "logs") {
			setRequestedContextMode("logs")
			return
		}
		if (["typecheck", "lintfix", "eslint", "test"].includes(contextMode))
			return
		setRequestedContextMode(workspace.diagnosticCapabilities.typecheck ?
			"typecheck" :
			lintFixAvailable ?
				"lintfix" :
				workspace.diagnosticCapabilities.eslint ?
					"eslint" :
					"test")
	}

	function generate(): void {
		if (contextMode === "project")
			void workspace.refreshFullProjectContextSummary()
		else if (contextMode === "commit")
			void workspace.generateGitCommitContextReport()
	}
	function generateDiagnostic(kind: "typecheck" | "eslint"): void {
		setRequestedContextMode(kind)
		void workspace.generateDiagnosticContextReport(kind)
	}
	function runLintFix(): void {
		setRequestedContextMode("lintfix")
		void workspace.fixEslint()
	}
	function runTests(): void {
		setRequestedContextMode("test")
		void workspace.runProjectTests()
	}
	function copy(): void {
		if (contextMode === "project")
			void workspace.copyFullProjectContext()
		else if (contextMode === "commit")
			void workspace.copyGitCommitContext()
		else if (contextMode === "typecheck")
			void workspace.copyDiagnosticContext("typecheck")
		else if (contextMode === "lintfix")
			void workspace.copyValidationCommandContext("lintfix")
		else if (contextMode === "eslint")
			void workspace.copyDiagnosticContext("eslint")
		else if (contextMode === "test")
			void workspace.copyValidationCommandContext("test")
	}
	function download(): void {
		if (contextMode === "project")
			void workspace.downloadFullProjectContext()
		else if (contextMode === "commit")
			void workspace.downloadGitCommitContext()
		else if (contextMode === "typecheck")
			void workspace.downloadDiagnosticContext("typecheck")
		else if (contextMode === "lintfix")
			void workspace.downloadValidationCommandContext("lintfix")
		else if (contextMode === "eslint")
			void workspace.downloadDiagnosticContext("eslint")
		else if (contextMode === "test")
			void workspace.downloadValidationCommandContext("test")
	}

	return {
		busy,
		changeMode,
		copy,
		download,
		generate,
		generateDiagnostic,
		generated,
		hasGenerateStep,
		metadata,
		projectScope: contextMode === "create" ?
			"custom" as const :
			"full" as const,
		runLintFix,
		runTests,
		validationMode: ["lintfix", "eslint", "test"].includes(contextMode) ?
			contextMode :
			"typecheck",
	}
}
