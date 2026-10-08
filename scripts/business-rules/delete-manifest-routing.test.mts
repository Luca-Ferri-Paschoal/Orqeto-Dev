import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

// BR-ROUTE-008
void test(
	"BR-ROUTE-008 current-project input errors are not swallowed or converted into no destination",
	async () => {
		const [routing, manifest, prompt, ptProtocol, enProtocol, readme, docs, aiDocs] = await Promise.all([
			readProjectFile("src/App/controllers/routeFilesApply.ts"),
			readProjectFile("src-tauri/src/overlay/manifest_delete.rs"),
			readProjectFile("src/features/context/formatAiWorkflowPrompt.ts"),
			readProjectFile("src/infra/i18n/locales/ptBR/protocol.ts"),
			readProjectFile("src/infra/i18n/locales/en/protocol.ts"),
			readProjectFile("README.md"),
			readProjectFile("docs/docs.md"),
			readProjectFile("docs/AI.md"),
		])
		assert.match(
			routing,
			/prepareProjectOverlay\(\s*sourceTab\.rootFolder,\s*\[path\],?\s*\)/,
		)
		assert.match(
			manifest,
			/10_000|MAX_DELETE_MANIFEST_PATHS/,
		)
		assert.match(
			manifest,
			/256|MAX_DELETE_MANIFEST_BYTES/,
		)
		assert.match(
			manifest,
			/Folder paths are supported/,
		)
		assert.match(
			prompt,
			/pasta existente[\s\S]*não enumere todos os filhos[\s\S]*10\.000 entradas[\s\S]*256 KiB/,
		)
		assert.match(
			prompt,
			/existing file or folder[\s\S]*do not enumerate every child[\s\S]*10,000 entries[\s\S]*256 KiB/,
		)
		assert.match(
			ptProtocol,
			/arquivos ou pastas existentes[\s\S]*10\.000 entradas[\s\S]*256 KiB/,
		)
		assert.match(
			enProtocol,
			/existing files or folders[\s\S]*10,000 entries[\s\S]*256 KiB/,
		)
		for (const document of [readme, docs, aiDocs]) {
			assert.match(
				document,
				/10,000|10\.000/,
			)
			assert.match(
				document,
				/256 KiB/,
			)
			assert.match(
				document,
				/folder|pasta/i,
			)
		}
	},
)
