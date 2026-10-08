import type {
	ProjectDiagnosticKind,
	ProjectValidationCommandKind,
} from "../../types"
import type { WorkspaceState } from "../useWorkspaceState"
import { getSafeProjectName } from "../utils"
import { getErrorMessage } from "@/features/context/utils"
import { saveExportFile } from "@/infra/desktop"
import { translate } from "@/infra/i18n"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { useCallback } from "react"

export function useDiagnosticExportActions(state: WorkspaceState) {
	const { currentPreparedDiagnosticContexts, currentPreparedValidationCommandContexts, locale, rootFolderRef, setNotice } = state

	const copyDiagnosticContext = useCallback(
		async (kind: ProjectDiagnosticKind): Promise<void> => {
			const prepared = currentPreparedDiagnosticContexts[kind]

			if (prepared === null)
				return

			try {
				await writeText(prepared.content)
				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.diagnosticContextCopied",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.diagnosticContextCopyFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			currentPreparedDiagnosticContexts,
			locale,
			setNotice,
		],
	)

	const downloadDiagnosticContext = useCallback(
		async (kind: ProjectDiagnosticKind): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current
			const prepared = currentPreparedDiagnosticContexts[kind]

			if (configuredRootFolder === null || prepared === null)
				return

			try {
				const saved = await saveExportFile({
					suggestedFileName: `${getSafeProjectName(configuredRootFolder)}-${kind}-context.txt`,
					dialogTitle: translate(
						locale,
						kind === "typecheck" ?
							"dialog.saveTypecheckContext" :
							"dialog.saveEslintContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
					content: prepared.content,
				})

				if (!saved)
					return

				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.diagnosticContextDownloaded",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.diagnosticContextDownloadFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			currentPreparedDiagnosticContexts,
			locale,
			rootFolderRef,
			setNotice,
		],
	)

	const copyValidationCommandContext = useCallback(
		async (kind: ProjectValidationCommandKind): Promise<void> => {
			const prepared = currentPreparedValidationCommandContexts[kind]

			if (prepared === null)
				return

			try {
				await writeText(prepared.content)
				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.validationCommandCopied",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.validationCommandCopyFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			currentPreparedValidationCommandContexts,
			locale,
			setNotice,
		],
	)

	const downloadValidationCommandContext = useCallback(
		async (kind: ProjectValidationCommandKind): Promise<void> => {
			const configuredRootFolder = rootFolderRef.current
			const prepared = currentPreparedValidationCommandContexts[kind]

			if (configuredRootFolder === null || prepared === null)
				return

			try {
				const saved = await saveExportFile({
					suggestedFileName: `${getSafeProjectName(configuredRootFolder)}-${kind === "lintfix" ?
						"lint-fix" :
						"test"}-context.txt`,
					dialogTitle: translate(
						locale,
						kind === "lintfix" ?
							"dialog.saveLintFixContext" :
							"dialog.saveTestContext",
					),
					filterName: translate(
						locale,
						"dialog.textFile",
					),
					extension: "txt",
					content: prepared.content,
				})

				if (!saved)
					return

				setNotice({
					kind: "success",
					message: translate(
						locale,
						"workspace.validationCommandDownloaded",
					),
				})
			} catch (error) {
				setNotice({
					kind: "error",
					message: translate(
						locale,
						"workspace.validationCommandDownloadFailed",
						{
							error: getErrorMessage(
								error,
								locale,
							),
						},
					),
				})
			}
		},
		[
			currentPreparedValidationCommandContexts,
			locale,
			rootFolderRef,
			setNotice,
		],
	)

	return {
		copyDiagnosticContext,
		downloadDiagnosticContext,
		copyValidationCommandContext,
		downloadValidationCommandContext,
	}
}
