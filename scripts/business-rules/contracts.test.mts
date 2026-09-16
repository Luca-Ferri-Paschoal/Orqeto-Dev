import { businessRules } from "./registry.mts"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
	"..",
)

async function readProjectFile(relativePath: string): Promise<string> {
	return readFile(
		path.join(
			rootDirectory,
			relativePath,
		),
		"utf8",
	)
}

void test(
	"business-rule registry has unique IDs, canonical documentation, and executable evidence",
	async () => {
		const ids = businessRules.map(rule => rule.id)
		assert.equal(
			new Set(ids).size,
			ids.length,
			"business-rule IDs must be unique",
		)

		const canonicalDocumentation = await readProjectFile("docs/AI.md")

		for (const rule of businessRules) {
			assert.match(
				rule.id,
				/^BR-[A-Z]+-\d{3}$/,
				`invalid business-rule ID ${rule.id}`,
			)
			assert.ok(
				canonicalDocumentation.includes(rule.id),
				`${rule.id} must be described in docs/AI.md`,
			)

			const evidence = await readProjectFile(rule.evidenceFile)
			assert.ok(
				evidence.includes(rule.evidenceToken),
				`${rule.id} evidence token ${rule.evidenceToken} is missing from ${rule.evidenceFile}`,
			)
		}
	},
)

void test(
	"package.json exposes the cumulative business-rule and patch verification commands",
	async () => {
		const packageJson = JSON.parse(await readProjectFile("package.json")) as {
			scripts?: Record<string, string>
		}
		const scripts = packageJson.scripts ?? {}

		assert.equal(
			scripts["test:business:contracts"],
			"node --experimental-strip-types scripts/business-rules/run.mts",
		)
		assert.equal(
			scripts["test:business:rust"],
			"cargo test --manifest-path src-tauri/Cargo.toml",
		)
		assert.equal(
			scripts["test:business"],
			"npm run test:business:contracts && npm run test:business:rust",
		)
		assert.equal(
			scripts["verify:business"],
			"npm run version:check && npm run test:business",
		)
		assert.equal(
			scripts["verify:patch"],
			"npm run typecheck && npm run lint:fix && npm run verify:business",
		)
	},
)

void test(
	"temporary robustness coordination document is retired after final acceptance",
	async () => {
		await assert.rejects(
			readProjectFile("docs/ROBUSTNESS_COORDINATION.md"),
			{ code: "ENOENT" },
		)
	},
)
