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
	"BR-HISTORY-003 routine React history state contains metadata only and copy loads content lazily",
	async () => {
		const types = await readProjectFile("src/features/context/types.ts")
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")
		const historyInterface = types.match(/export interface ContextHistoryEntry \{([\s\S]*?)\n\}/)?.[1] ?? ""

		assert.ok(
			historyInterface.length > 0,
			"ContextHistoryEntry interface must exist",
		)
		assert.doesNotMatch(
			historyInterface,
			/\bcontent\s*:/,
		)
		assert.match(
			workspace,
			/const content = await getContextHistoryContent\(/,
		)
		assert.doesNotMatch(
			workspace,
			/writeText\(entry\.content\)/,
		)
	},
)

void test(
	"BR-HISTORY-004 history download resolves archived content inside the backend",
	async () => {
		const workspace = await readProjectFile("src/features/context/useContextWorkspace.ts")
		const desktop = await readProjectFile("src/infra/desktop.ts")
		const backend = await readProjectFile("src-tauri/src/lib.rs")

		assert.match(
			workspace,
			/const saved = await saveContextHistoryExportFile\(\{/,
		)
		assert.match(
			desktop,
			/"save_context_history_export_file"/,
		)
		assert.match(
			backend,
			/async fn save_context_history_export_file\(/,
		)
		assert.match(
			backend,
			/config_database::load_context_history_content\(/,
		)
	},
)
