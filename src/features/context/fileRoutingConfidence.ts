export interface FileRoutingCandidateEvidence {
	destinationRelativePath: string
	matchedFiles: number
	matchedDirectories: number
	sourceContextMatches: number
}

export interface FileRoutingProjectEvidence {
	projectName: string
	sourceLabel: string
	fileCount: number
	candidate: FileRoutingCandidateEvidence
}

const GENERIC_SINGLE_TOKEN_PROJECT_NAMES = new Set([
	"api",
	"app",
	"backend",
	"client",
	"frontend",
	"project",
	"repo",
	"server",
	"web",
])

function tokenizeIdentity(value: string): string[] {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
}

function containsContiguousTokens(
	sourceTokens: readonly string[],
	targetTokens: readonly string[],
): boolean {
	if (targetTokens.length === 0 || targetTokens.length > sourceTokens.length)
		return false

	for (let startIndex = 0; startIndex <= sourceTokens.length - targetTokens.length; startIndex += 1) {
		let matches = true

		for (let offset = 0; offset < targetTokens.length; offset += 1) {
			if (sourceTokens[startIndex + offset] !== targetTokens[offset]) {
				matches = false
				break
			}
		}

		if (matches)
			return true
	}

	return false
}

function sourceLabelNamesProject(
	sourceLabel: string,
	projectName: string,
): boolean {
	const projectTokens = tokenizeIdentity(projectName)

	if (projectTokens.length === 0)
		return false

	if (projectTokens.length === 1) {
		const projectToken = projectTokens[0]

		if (
			projectToken === undefined ||
			projectToken.length < 5 ||
			GENERIC_SINGLE_TOKEN_PROJECT_NAMES.has(projectToken)
		)
			return false
	}

	return containsContiguousTokens(
		tokenizeIdentity(sourceLabel),
		projectTokens,
	)
}

function hasRealProjectEvidence(candidate: FileRoutingCandidateEvidence): boolean {
	return candidate.matchedFiles > 0 || candidate.sourceContextMatches >= 2
}

function hasStrongExactFileCoverage(
	fileCount: number,
	candidate: FileRoutingCandidateEvidence,
): boolean {
	if (
		fileCount <= 0 ||
		candidate.destinationRelativePath !== "./" ||
		candidate.matchedFiles <= 0
	)
		return false

	// One exact ROOT-relative file is strong evidence when no other project
	// has the same full path. The caller keeps multiple equally strong projects
	// ambiguous, so this never turns a shared path into an automatic guess.
	if (candidate.matchedFiles === fileCount)
		return true

	if (fileCount < 2 || candidate.matchedFiles < 2)
		return false

	return candidate.matchedFiles * 2 >= fileCount
}

function hasStrongSourceContext(candidate: FileRoutingCandidateEvidence): boolean {
	return candidate.sourceContextMatches >= 2 &&
		(candidate.matchedFiles > 0 || candidate.matchedDirectories > 0)
}

/**
 * Returns one project only when its routing evidence is meaningfully stronger
 * than every other open project. Weak path coincidences remain ambiguous and
 * continue through the normal project selector.
 */
export function selectUniqueStrongFileRoutingProject<
	Project extends FileRoutingProjectEvidence,
>(projects: readonly Project[]): Project | null {
	const identityMatches = projects.filter(project =>
		hasRealProjectEvidence(project.candidate) &&
		sourceLabelNamesProject(
			project.sourceLabel,
			project.projectName,
		))

	if (identityMatches.length === 1) {
		const identityMatch = identityMatches[0]

		if (identityMatch === undefined)
			return null

		const hasStrongerStructuralCompetitor = projects.some(project =>
			project !== identityMatch &&
			(
				project.candidate.matchedFiles > identityMatch.candidate.matchedFiles ||
				project.candidate.sourceContextMatches > identityMatch.candidate.sourceContextMatches + 1
			))

		if (!hasStrongerStructuralCompetitor)
			return identityMatch
	}

	if (identityMatches.length > 1)
		return null

	const structuralMatches = projects.filter(project =>
		hasStrongExactFileCoverage(
			project.fileCount,
			project.candidate,
		))

	if (structuralMatches.length === 1)
		return structuralMatches[0] ?? null

	if (structuralMatches.length > 1)
		return null

	const contextualMatches = projects.filter(project =>
		hasStrongSourceContext(project.candidate))

	return contextualMatches.length === 1 ?
		contextualMatches[0] ?? null :
		null
}
