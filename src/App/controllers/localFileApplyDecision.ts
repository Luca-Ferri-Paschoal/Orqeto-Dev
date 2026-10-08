import type {
	OverlayDestinationCandidate,
	PrepareProjectOverlayResult,
} from "../../domain/contextContracts.ts"

export type LocalFileApplyDecision = | { kind: "direct"; candidate: OverlayDestinationCandidate } |
{ kind: "review"; candidates: OverlayDestinationCandidate[] } |
{ kind: "tooAmbiguous" } |
{ kind: "unavailable" }

function hasEvidence(candidate: OverlayDestinationCandidate): boolean {
	return candidate.matchedFiles > 0 || candidate.sourceContextMatches > 0
}

function sameCandidate(a: OverlayDestinationCandidate, b: OverlayDestinationCandidate): boolean {
	return a.destinationRelativePath === b.destinationRelativePath && a.sourcePrefix === b.sourcePrefix
}

/** The backend has already generated candidates for one project only. */
export function chooseLocalFileDestination(plan: PrepareProjectOverlayResult): LocalFileApplyDecision {
	if (plan.ambiguityLimitExceeded)
		return { kind: "tooAmbiguous" }
	const recommended = plan.recommendedCandidateIndex === null ?
		null :
		plan.candidates[plan.recommendedCandidateIndex]
	// The backend can certify an exact ZIP-root mapping using its complete
	// existing parent hierarchy even when every incoming file is new.
	// Do not undo that recommendation by checking only existing files here.
	const concrete = recommended ?
		[recommended] :
		plan.candidates.filter(hasEvidence)
	if (concrete.length === 1) {
		const candidate = concrete[0]
		if (candidate !== undefined)
			return { kind: "direct", candidate }
	}
	const candidates = [...concrete]
	const rootCandidate = plan.rootCandidate
	if (rootCandidate !== null && !candidates.some(candidate => sameCandidate(
		candidate,
		rootCandidate,
	)))
		candidates.push(rootCandidate)
	return candidates.length > 0 ?
		{ kind: "review", candidates } :
		{ kind: "unavailable" }
}
