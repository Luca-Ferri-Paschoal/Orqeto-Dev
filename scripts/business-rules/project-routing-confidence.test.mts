import { selectUniqueStrongFileRoutingProject } from "../../src/features/context/fileRoutingConfidence.ts"
import assert from "node:assert/strict"
import test from "node:test"

const rootCandidate = {
	destinationRelativePath: "./",
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
