import assert from "node:assert/strict"
import {
	access,
	readFile,
} from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

// BR-DOCS-001
void test(
	"BR-DOCS-001 permanent business documentation lives in docs/docs.md and validation docs define the aggregate Test contract",
	async () => {
		const [
			ai,
			docs,
			appDocs,
			readme,
			adversarial,
		] = await Promise.all([
			read("docs/AI.md"),
			read("docs/docs.md"),
			read("docs/App.md"),
			read("README.md"),
			read("scripts/business-rules/adversarial-final.test.mts"),
		])

		await assert.rejects(access("docs.txt"))
		assert.match(
			readme,
			/\[`docs\/docs\.md`\]\(docs\/docs\.md\)/,
		)
		assert.doesNotMatch(
			readme,
			/\bdocs\.txt\b/,
		)
		assert.match(
			adversarial,
			/readProjectFile\("docs\/docs\.md"\)/,
		)

		for (const document of [ai, docs, readme]) {
			assert.match(
				document,
				/orqetoDev[\s\S]*validation[\s\S]*lintFix[\s\S]*test/,
			)
			assert.match(
				document,
				/aggregate[\s\S]*test|test[\s\S]*aggregate/i,
			)
		}
		assert.match(
			appDocs,
			/canonical[\s\S]*docs\/docs\.md/i,
		)
	},
)

// BR-DOCS-002
void test(
	"BR-DOCS-002 permanent docs stay synchronized with validation trust, AI test opt-in, repeated ZIP no-op, and hover behavior",
	async () => {
		const [
			ai,
			docs,
			appDocs,
			readme,
		] = await Promise.all([
			read("docs/AI.md"),
			read("docs/docs.md"),
			read("docs/App.md"),
			read("README.md"),
		])

		assert.notEqual(
			appDocs,
			docs,
		)
		assert.match(
			appDocs,
			/canonical[\s\S]*docs\/docs\.md[\s\S]*does not mirror/i,
		)

		assert.match(
			ai,
			/Copy AI prompt[\s\S]*orqetoDev\.validation[\s\S]*must not invent tests[\s\S]*explicitly requests tests/,
		)
		assert.match(
			docs,
			/Validation-integration guidance[\s\S]*never invent tests[\s\S]*orqetoDev\.validation\.test[\s\S]*explicitly asks for tests/,
		)
		assert.match(
			readme,
			/Copy AI prompt[\s\S]*not to invent tests[\s\S]*orqetoDev\.validation\.test[\s\S]*explicitly asks for tests/,
		)

		for (const document of [ai, docs, readme]) {
			assert.match(
				document,
				/in-app[\s\S]*(confirmation|dialog)/i,
			)
			assert.match(
				document,
				/(same|reapplying)[\s\S]*ZIP[\s\S]*(unchanged|already applied)/i,
			)
			assert.match(
				document,
				/(enabled buttons|enabled `<button>`)[\s\S]*(hover|pointer)/i,
			)
		}
	},
)
