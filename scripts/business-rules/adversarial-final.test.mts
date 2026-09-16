import { normalizeContextSelection } from "../../src/features/context/contextSelection.ts"
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
	"BR-ADV-001 large Context membership remains reference-only and small subsets stay cheap to select",
	() => {
		const membership = Array.from(
			{ length: 50_000 },
			(_, index) => ({
				relativePath: `./generated/path-${index}.ts`,
				content: "source bytes must never enter long-lived selection state",
			}),
		)
		const selection = normalizeContextSelection(membership)

		assert.equal(
			selection.length,
			50_000,
		)
		assert.deepEqual(
			selection[0],
			{ relativePath: "./generated/path-0.ts" },
		)
		assert.deepEqual(
			selection.at(-1),
			{ relativePath: "./generated/path-49999.ts" },
		)
		assert.ok(selection.every(file => Object.keys(file).length === 1))

		const subset = [
			selection[0],
			selection[25_000],
			selection[49_999],
		]
		assert.deepEqual(
			subset.map(file => file?.relativePath),
			[
				"./generated/path-0.ts",
				"./generated/path-25000.ts",
				"./generated/path-49999.ts",
			],
		)
	},
)

void test(
	"BR-ADV-002 Context/routing races revalidate root, membership, ignore evidence, and stale Undo identity",
	async () => {
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")
		const overlay = await readProjectFile("src-tauri/src/overlay.rs")
		const statusTests = await readProjectFile("scripts/business-rules/status-outcome.test.mts")

		assert.match(
			workspace,
			/const rootRevision = rootRevisionRef\.current/,
		)
		assert.match(
			workspace,
			/const selectionRevision = contextSelectionRevisionRef\.current/,
		)
		assert.match(
			workspace,
			/rootRevisionRef\.current !== rootRevision/,
		)
		assert.match(
			workspace,
			/contextSelectionRevisionRef\.current !== selectionRevision/,
		)
		assert.match(
			overlay,
			/hash_field\(&mut hasher, b"ignore-present"\)/,
		)
		assert.match(
			overlay,
			/project_access_coordinator_blocks_overlapping_reads_and_writes/,
		)
		assert.match(
			statusTests,
			/BR-STATUS-004 contextual Undo requires the exact newest operation identity/,
		)
	},
)

void test(
	"BR-ADV-006 permanent docs describe the final state without robustness-roadmap language and ZIP compatibility remains wired",
	async () => {
		const [ai, docs, readme, packageJsonSource, cargo] = await Promise.all([
			readProjectFile("docs/AI.md"),
			readProjectFile("docs.txt"),
			readProjectFile("README.md"),
			readProjectFile("package.json"),
			readProjectFile("src-tauri/Cargo.toml"),
		])
		const permanentDocs = [ai, docs, readme]

		for (const document of permanentDocs) {
			assert.doesNotMatch(
				document,
				/ROBUSTNESS_COORDINATION/,
			)
			assert.doesNotMatch(
				document,
				/eight-patch robustness/i,
			)
			assert.doesNotMatch(
				document,
				/Patch 8 may/i,
			)
		}

		const packageJson = JSON.parse(packageJsonSource) as {
			scripts?: Record<string, string>
		}
		assert.equal(
			packageJson.scripts?.["test:adversarial"],
			"npm run test:adversarial:node && npm run test:adversarial:rust",
		)
		assert.equal(
			packageJson.scripts?.["verify:final"],
			"npm run verify:patch && npm run test:adversarial",
		)
		assert.match(
			cargo,
			/^zip = "8\.6\.0"$/m,
		)
	},
)
