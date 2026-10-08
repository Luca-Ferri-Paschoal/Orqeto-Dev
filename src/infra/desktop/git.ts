import type {
	ApplyGitPatchResult,
	GitCommitComparisonData,
	GitCommitHistoryPage,
	GitPatchPreview,
} from "@/domain/contextContracts"
import { invoke } from "@tauri-apps/api/core"

export const prepareGitPatch = (
	rootFolder: string,
	patchPath: string,
) => invoke<GitPatchPreview>(
	"prepare_git_patch",
	{ rootFolder, patchPath },
)
export const getGitPatchSourceFingerprint = (patchPath: string) => invoke<string>(
	"git_patch_source_fingerprint",
	{ patchPath },
)
export const applyGitPatch = (
	rootFolder: string,
	patchPath: string,
	expectedPatchFingerprint: string,
	undoHistoryLimit: number,
) => invoke<ApplyGitPatchResult>("apply_git_patch", {
	rootFolder,
	patchPath,
	expectedPatchFingerprint,
	undoHistoryLimit,
})

export const listGitCommits = (
	rootFolder: string,
	offset: number,
) => invoke<GitCommitHistoryPage>(
	"list_git_commits",
	{ rootFolder, offset },
)

export const compareGitCommits = (
	rootFolder: string,
	from: string,
	to: string,
) => invoke<GitCommitComparisonData>(
	"compare_git_commits",
	{ rootFolder, from, to },
)
