import { chooseLocalFileDestination } from "../../src/App/controllers/localFileApplyDecision.ts"
import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

const root = { destinationRelativePath: "./", sourcePrefix: "", matchedFiles: 0, matchedDirectories: 0, sourceContextMatches: 0 }
const current = { destinationRelativePath: "src", sourcePrefix: "", matchedFiles: 2, matchedDirectories: 2, sourceContextMatches: 0 }
const other = { destinationRelativePath: "lib", sourcePrefix: "", matchedFiles: 1, matchedDirectories: 1, sourceContextMatches: 0 }
type ProjectPlan = Parameters<typeof chooseLocalFileDestination>[0]

function plan(
	candidates: ProjectPlan["candidates"],
	recommendedCandidateIndex: ProjectPlan["recommendedCandidateIndex"] = null,
	rootCandidate: ProjectPlan["rootCandidate"] = root,
	ambiguityLimitExceeded = false,
): ProjectPlan {
	return { candidates, recommendedCandidateIndex, rootCandidate, ambiguityLimitExceeded, candidateCount: candidates.length, ambiguityLimit: 100, sourceFingerprint: "source", routingFingerprint: "route", fileCount: 1, deleteCount: 0, permanentDeletePaths: [] }
}

// BR-ROUTE-003
void test("BR-ROUTE-003 Files and Git preparation use only the initiating tab", async () => {
	const [files, git, routing] = await Promise.all([
		readProjectFile("src/App/controllers/routeFilesApply.ts"),
		readProjectFile("src/App/controllers/routeGitApply.ts"),
		readProjectFile("src/App/controllers/useApplyRouting.ts"),
	])
	assert.match(
		files,
		/prepareProjectOverlay\(sourceTab\.rootFolder, \[path\]\)/,
	)
	assert.match(
		git,
		/prepareGitPatch\(sourceTab\.rootFolder, patchPath\)/,
	)
	assert.match(
		git,
		/getProjectAppliedSourceHistoryMatch\(\s*sourceTab\.rootFolder/,
	)
	assert.match(
		routing,
		/tabsRef\.current\.find\(entry => entry\.id === sourceTabId\)/,
	)
	assert.doesNotMatch(
		routing,
		/rootedTabs|requestProjectApplySelection|scope: "auto"/,
	)
	assert.doesNotMatch(
		files + git,
		/rootedTabs|mapFilesystemHeavySerially|prioritizeCurrentRoutingProject/,
	)
})

void test("Files destination recommendation stays inside the only prepared project", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan(
			[root, current],
			1,
		)),
		{ kind: "direct", candidate: current },
	)
})

void test("Single credible destination applies without project selection", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan([root, current])),
		{ kind: "direct", candidate: current },
	)
})

// BR-ROUTE-005
void test("BR-ROUTE-005 multiple internal candidates offer only local destinations and ROOT fallback", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan([current, other])),
		{ kind: "review", candidates: [current, other, root] },
	)
})

void test("No credible match still asks for explicit ROOT placement", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan([root])),
		{ kind: "review", candidates: [root] },
	)
})

void test("ROOT fallback is never duplicated", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan([current, other, root])),
		{ kind: "review", candidates: [current, other, root] },
	)
})

// BR-ROUTE-007
void test("BR-ROUTE-007 ambiguity limit cannot be overridden by choosing ROOT", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan(
			[current, other],
			null,
			root,
			true,
		)),
		{ kind: "tooAmbiguous" },
	)
})

void test("Missing safe destination is rejected", () => {
	assert.deepEqual(
		chooseLocalFileDestination(plan(
			[],
			null,
			null,
		)),
		{ kind: "unavailable" },
	)
})

void test("Only directory overlap is not evidence for automatic application", () => {
	const directoryOnly = { ...other, matchedFiles: 0, sourceContextMatches: 0, matchedDirectories: 8 }
	assert.deepEqual(
		chooseLocalFileDestination(plan([directoryOnly])),
		{ kind: "review", candidates: [root] },
	)
})

void test("Project change or stale handle blocks after asynchronous preparation", async () => {
	const [files, git] = await Promise.all([
		readProjectFile("src/App/controllers/routeFilesApply.ts"),
		readProjectFile("src/App/controllers/routeGitApply.ts"),
	])
	for (const source of [files, git]) {
		assert.match(
			source,
			/tabsRef\.current\.find\(tab => tab\.id === sourceTab\.id\)\?\.rootFolder !== sourceTab\.rootFolder/,
		)
		assert.match(
			source,
			/workspaceHandlesRef\.current\.get\(sourceTab\.id\) !== handle/,
		)
		assert.match(
			source,
			/!handle\.canAcceptRoutedApply\(\)/,
		)
	}
})
