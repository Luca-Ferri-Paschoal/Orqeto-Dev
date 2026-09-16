import {
	selectUniqueCompleteExactRootFileRoutingProject,
	selectUniqueStrongFileRoutingProject,
} from "../../src/features/context/fileRoutingConfidence.ts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const rootCandidate = {
	destinationRelativePath: "./",
	sourcePrefix: "",
	matchedFiles: 1,
	matchedDirectories: 0,
	sourceContextMatches: 0,
}

void test(
	"Files routing prefers one project explicitly named by the incoming ZIP when both share the same single-file path",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "assignment",
				projectName: "assignment-manager",
				sourceLabel: "assignment_manager_orqeto_vite_watch_fix(1).zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
			{
				id: "orqeto",
				projectName: "orqeto-dev",
				sourceLabel: "assignment_manager_orqeto_vite_watch_fix(1).zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
		])

		assert.equal(
			selected?.id,
			"assignment",
		)
	},
)

void test(
	"Files routing keeps a generic single-file ZIP ambiguous across projects with the same path",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "assignment",
				projectName: "assignment-manager",
				sourceLabel: "vite-watch-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
			{
				id: "orqeto",
				projectName: "orqeto-dev",
				sourceLabel: "vite-watch-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
		])

		assert.equal(
			selected,
			null,
		)
	},
)

void test(
	"Files routing accepts one unique exact ROOT-relative match for a single-file ZIP",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "assignment",
				projectName: "assignment-manager",
				sourceLabel: "person-dialog-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
			{
				id: "foreign",
				projectName: "foreign-project",
				sourceLabel: "person-dialog-fix.zip",
				fileCount: 1,
				candidate: {
					...rootCandidate,
					matchedFiles: 0,
					matchedDirectories: 3,
				},
			},
		])

		assert.equal(
			selected?.id,
			"assignment",
		)
	},
)

void test(
	"Files routing accepts one uniquely strong multi-file structural match",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "target",
				projectName: "target-project",
				sourceLabel: "changes.zip",
				fileCount: 10,
				candidate: {
					...rootCandidate,
					matchedFiles: 8,
				},
			},
			{
				id: "foreign",
				projectName: "foreign-project",
				sourceLabel: "changes.zip",
				fileCount: 10,
				candidate: {
					...rootCandidate,
					matchedFiles: 2,
				},
			},
		])

		assert.equal(
			selected?.id,
			"target",
		)
	},
)

void test(
	"Files routing prefers strong exact ROOT coverage over a relocated source-prefix match",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "target",
				projectName: "financial-project",
				sourceLabel: "card-flow-fix.zip",
				fileCount: 6,
				candidate: {
					destinationRelativePath: "./",
					sourcePrefix: "",
					matchedFiles: 5,
					matchedDirectories: 39,
					sourceContextMatches: 0,
				},
			},
			{
				id: "relocated",
				projectName: "other-project",
				sourceLabel: "card-flow-fix.zip",
				fileCount: 6,
				candidate: {
					destinationRelativePath: "./",
					sourcePrefix: "apps/api",
					matchedFiles: 6,
					matchedDirectories: 40,
					sourceContextMatches: 3,
				},
			},
		])

		assert.equal(
			selected?.id,
			"target",
		)
	},
)

void test(
	"Files routing never guesses when more than one project has strong structural evidence",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "first",
				projectName: "first-project",
				sourceLabel: "changes.zip",
				fileCount: 10,
				candidate: {
					...rootCandidate,
					matchedFiles: 8,
				},
			},
			{
				id: "second",
				projectName: "second-project",
				sourceLabel: "changes.zip",
				fileCount: 10,
				candidate: {
					...rootCandidate,
					matchedFiles: 7,
				},
			},
		])

		assert.equal(
			selected,
			null,
		)
	},
)

void test(
	"Files routing does not let a ZIP name override a materially stronger project match",
	() => {
		const selected = selectUniqueStrongFileRoutingProject([
			{
				id: "named-but-weak",
				projectName: "assignment-manager",
				sourceLabel: "assignment_manager_changes.zip",
				fileCount: 10,
				candidate: {
					...rootCandidate,
					matchedFiles: 2,
				},
			},
			{
				id: "structurally-strong",
				projectName: "other-project",
				sourceLabel: "assignment_manager_changes.zip",
				fileCount: 10,
				candidate: {
					...rootCandidate,
					matchedFiles: 8,
				},
			},
		])

		assert.equal(
			selected?.id,
			"structurally-strong",
		)
	},
)

// BR-ROUTE-003
void test(
	"Files routing gives a unique complete exact ROOT match precedence over a relocated context-only project match",
	() => {
		const selected = selectUniqueCompleteExactRootFileRoutingProject([
			{
				id: "assignment",
				projectName: "assignment-manager",
				sourceLabel: "assignment-manager-onboarding-state-fix-patch.zip",
				fileCount: 1,
				candidate: {
					destinationRelativePath: "./",
					sourcePrefix: "",
					matchedFiles: 1,
					matchedDirectories: 2,
					sourceContextMatches: 0,
				},
			},
			{
				id: "mvp",
				projectName: "mvp-av",
				sourceLabel: "assignment-manager-onboarding-state-fix-patch.zip",
				fileCount: 1,
				candidate: {
					destinationRelativePath: "./apps/web/src/app",
					sourcePrefix: "src/App",
					matchedFiles: 0,
					matchedDirectories: 0,
					sourceContextMatches: 2,
				},
			},
		])

		assert.equal(
			selected?.id,
			"assignment",
		)
	},
)

void test(
	"Files routing keeps two complete exact ROOT matches ambiguous when the source name does not identify one project",
	() => {
		const selected = selectUniqueCompleteExactRootFileRoutingProject([
			{
				id: "first",
				projectName: "first-project",
				sourceLabel: "onboarding-state-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
			{
				id: "second",
				projectName: "second-project",
				sourceLabel: "onboarding-state-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
		])

		assert.equal(
			selected,
			null,
		)
	},
)

void test(
	"Files routing may use the source name only to break a tie between otherwise complete exact ROOT matches",
	() => {
		const selected = selectUniqueCompleteExactRootFileRoutingProject([
			{
				id: "assignment",
				projectName: "assignment-manager",
				sourceLabel: "assignment-manager-onboarding-state-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
			{
				id: "other",
				projectName: "other-project",
				sourceLabel: "assignment-manager-onboarding-state-fix.zip",
				fileCount: 1,
				candidate: rootCandidate,
			},
		])

		assert.equal(
			selected?.id,
			"assignment",
		)
	},
)

void test(
	"BR-ROUTE-003 wires exact ROOT evidence from every project plan before the project selector",
	async () => {
		const app = await readFile(
			"src/App/index.tsx",
			"utf8",
		)
		const exactEvidenceIndex = app.indexOf("const exactRootProjectCandidates = analyses.flatMap")
		const exactSelectionIndex = app.indexOf("if (exactRootProjectMatch !== null)")
		const projectSelectorIndex = app.indexOf(
			"const selection = await requestProjectApplySelection({",
			exactSelectionIndex,
		)

		assert.ok(exactEvidenceIndex >= 0)
		assert.match(
			app,
			/candidate: analysis\.plan\.rootCandidate/,
		)
		assert.match(
			app,
			/selectUniqueCompleteExactRootFileRoutingProject<StrongProjectAnalysis>/,
		)
		assert.ok(exactSelectionIndex > exactEvidenceIndex)
		assert.ok(projectSelectorIndex > exactSelectionIndex)
		assert.match(
			app.slice(
				exactSelectionIndex,
				projectSelectorIndex,
			),
			/applyProjectAnalysis\([\s\S]*?exactRootProjectMatch\.candidate/,
		)
		assert.match(
			app,
			/applyProjectAnalysis\([\s\S]*?strongProjectMatch\.analysis,[\s\S]*?strongProjectMatch\.candidate/,
		)
	},
)
