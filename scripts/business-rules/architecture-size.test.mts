import assert from "node:assert/strict"
import {
	readdir,
	readFile,
} from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const PROJECT_ROOT = path.resolve(
	import.meta.dirname,
	"..",
	"..",
)
const MAX_SOURCE_LINES = 300
const SOURCE_EXTENSIONS = new Set([
	".mts",
	".rs",
	".ts",
	".tsx",
])
const SOURCE_ROOTS = [
	"src",
	"scripts",
	"src-tauri/src",
	"integrations/vscode/src",
] as const

// BR-ARCH-001
void test(
	"BR-ARCH-001 production and maintenance modules stay specialized and bounded",
	async () => {
		const oversized: string[] = []

		for (const sourceRoot of SOURCE_ROOTS) {
			const files = await collectSourceFiles(path.join(
				PROJECT_ROOT,
				sourceRoot,
			))

			for (const filePath of files) {
				const source = await readFile(
					filePath,
					"utf8",
				)
				const lineCount = countSourceLines(source)

				if (lineCount > MAX_SOURCE_LINES) {
					oversized.push(`${path.relative(
						PROJECT_ROOT,
						filePath,
					)} (${lineCount} lines)`)
				}
			}
		}

		assert.deepEqual(
			oversized,
			[],
			`source modules must stay at or below ${MAX_SOURCE_LINES} lines:\n${oversized.join("\n")}`,
		)
	},
)

async function collectSourceFiles(directoryPath: string): Promise<string[]> {
	const files: string[] = []
	const entries = await readdir(
		directoryPath,
		{ withFileTypes: true },
	)

	for (const entry of entries) {
		const absolutePath = path.join(
			directoryPath,
			entry.name,
		)

		if (entry.isDirectory()) {
			files.push(...await collectSourceFiles(absolutePath))
			continue
		}

		if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)))
			files.push(absolutePath)
	}

	return files
}

function countSourceLines(source: string): number {
	if (source.length === 0)
		return 0

	return source.split("\n").length
}

// BR-ARCH-002
void test(
	"BR-ARCH-002 domain and infrastructure layers do not depend on application features",
	async () => {
		const violations: string[] = []

		for (const layer of ["src/domain", "src/infra"] as const) {
			const files = await collectSourceFiles(path.join(
				PROJECT_ROOT,
				layer,
			))

			for (const filePath of files) {
				if (!/[.]tsx?$/.test(filePath))
					continue

				const source = await readFile(
					filePath,
					"utf8",
				)
				const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)]

				for (const match of imports) {
					const specifier = match[1]

					if (specifier && /(?:^|\/)features(?:\/|$)|(?:^|\/)App(?:\/|$)/.test(specifier)) {
						violations.push(`${path.relative(
							PROJECT_ROOT,
							filePath,
						)} -> ${specifier}`)
					}
				}
			}
		}

		assert.deepEqual(
			violations,
			[],
			`domain/infra must stay independent of feature/application modules:\n${violations.join("\n")}`,
		)
	},
)

// BR-ARCH-003
void test(
	"BR-ARCH-003 Rust crate modules are declared at the crate root before split implementation includes",
	async () => {
		const crateRoot = await readFile(
			path.join(
				PROJECT_ROOT,
				"src-tauri/src/lib.rs",
			),
			"utf8",
		)
		const coreImplementation = await readFile(
			path.join(
				PROJECT_ROOT,
				"src-tauri/src/lib/core_types_and_state.rs",
			),
			"utf8",
		)
		const requiredModules = [
			"config_database",
			"diagnostics",
			"external_integration",
			"git_context",
			"native_drop",
			"operation_id",
			"overlay",
			"project_ignore",
			"process_tree",
			"project_logs",
			"resource_limits",
			"runtime_utils",
			"safe_fs",
			"storage",
		]

		for (const moduleName of requiredModules) {
			assert.match(
				crateRoot,
				new RegExp(
					`^mod ${moduleName};$`,
					"m",
				),
			)
			assert.doesNotMatch(
				coreImplementation,
				new RegExp(
					`^mod ${moduleName};$`,
					"m",
				),
			)
		}

		assert.match(
			crateRoot,
			/include!\("lib\/core_types_and_state[.]rs"\);/,
		)
	},
)
