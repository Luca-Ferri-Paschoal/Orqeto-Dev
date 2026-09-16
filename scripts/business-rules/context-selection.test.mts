import {
	mergeContextSelection,
	normalizeContextSelection,
} from "../../src/features/context/contextSelection.ts"
import assert from "node:assert/strict"
import test from "node:test"

void test(
	"BR-CTX-001 active selection strips source contents and keeps only path membership",
	() => {
		const selection = normalizeContextSelection([
			{
				relativePath: "./src/App.tsx",
				content: "old source text",
			},
		])

		assert.deepEqual(
			selection,
			[
				{
					relativePath: "./src/App.tsx",
				},
			],
		)
	},
)

void test(
	"BR-CTX-002 re-adding a selected path never replaces it with supplied content",
	() => {
		const result = mergeContextSelection(
			[
				{
					relativePath: "./src/App.tsx",
				},
			],
			[
				{
					relativePath: "./src/App.tsx",
					content: "new source text that must not become selection state",
				},
			],
		)

		assert.equal(
			result.addedFiles,
			0,
		)
		assert.equal(
			result.unchangedFiles,
			1,
		)
		assert.deepEqual(
			result.files,
			[
				{
					relativePath: "./src/App.tsx",
				},
			],
		)
	},
)

void test(
	"BR-CTX-003 re-sending a folder-shaped selection adds only newly discovered paths",
	() => {
		const result = mergeContextSelection(
			[
				{
					relativePath: "./src/a.ts",
					content: null,
				},
			],
			[
				{
					relativePath: "./src/a.ts",
					content: "changed a",
				},
				{
					relativePath: "./src/b.ts",
					content: "new b",
				},
			],
		)

		assert.equal(
			result.addedFiles,
			1,
		)
		assert.equal(
			result.unchangedFiles,
			1,
		)
		assert.deepEqual(
			result.files,
			[
				{
					relativePath: "./src/a.ts",
				},
				{
					relativePath: "./src/b.ts",
				},
			],
		)
	},
)

void test(
	"BR-CTX-007 files created later under a selected folder stay unselected until that path is sent again",
	() => {
		const selectionAfterInitialFolderSend = normalizeContextSelection([
			{ relativePath: "./src/a.ts" },
		])
		assert.deepEqual(
			selectionAfterInitialFolderSend,
			[
				{ relativePath: "./src/a.ts" },
			],
		)

		const resultAfterFolderResend = mergeContextSelection(
			selectionAfterInitialFolderSend,
			[
				{ relativePath: "./src/a.ts" },
				{ relativePath: "./src/new.ts" },
			],
		)

		assert.equal(
			resultAfterFolderResend.addedFiles,
			1,
		)
		assert.equal(
			resultAfterFolderResend.unchangedFiles,
			1,
		)
		assert.deepEqual(
			resultAfterFolderResend.files,
			[
				{ relativePath: "./src/a.ts" },
				{ relativePath: "./src/new.ts" },
			],
		)
	},
)
