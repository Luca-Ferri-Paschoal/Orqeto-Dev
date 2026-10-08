export interface GitCommitSummary {
	hash: string
	shortHash: string
	subject: string
	author: string
	authoredAt: string
}

export interface GitCommitHistoryPage {
	commits: GitCommitSummary[]
	hasMore: boolean
}

export interface GitCommitComparisonData {
	repositoryName: string
	initial: GitCommitSummary
	finalCommit: GitCommitSummary
	fileCount: number
	addedLines: number
	deletedLines: number
	diff: string
}
