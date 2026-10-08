import type {
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
	ProjectTab,
} from "@/features/context/types"

export function getSourceLabel(path: string): string {
	const normalized = path.replaceAll(
		"\\",
		"/",
	).replace(
		/\/$/,
		"",
	)
	return normalized.split("/").filter(Boolean).at(-1) ?? path
}

export function withOnlyOverlayCandidates(
	plan: PrepareProjectOverlayResult,
	candidates: OverlayDestinationCandidate[],
): PrepareProjectOverlayResult {
	return {
		...plan,
		candidates,
		candidateCount: candidates.length,
		ambiguityLimitExceeded: false,
		recommendedCandidateIndex: candidates.length === 1 ?
			0 :
			null,
	}
}

export function createProjectTab(rootFolder: string | null = null): ProjectTab {
	return {
		id: `tab-${crypto.randomUUID()}`,
		rootFolder,
		folderSectionExpanded: true,
		contextSectionExpanded: true,
		applySectionExpanded: true,
	}
}

export function moveTabToInsertionPosition(
	tabs: readonly ProjectTab[],
	sourceId: string,
	insertionIndex: number,
): ProjectTab[] {
	const sourceIndex = tabs.findIndex(tab => tab.id === sourceId)
	if (sourceIndex < 0)
		return [...tabs]
	const nextTabs = [...tabs]
	const [source] = nextTabs.splice(
		sourceIndex,
		1,
	)
	if (source === undefined)
		return [...tabs]
	const boundedIndex = Math.max(
		0,
		Math.min(
			insertionIndex,
			nextTabs.length,
		),
	)
	nextTabs.splice(
		boundedIndex,
		0,
		source,
	)
	return nextTabs
}
