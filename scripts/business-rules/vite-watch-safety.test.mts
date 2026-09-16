import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const viteConfig = await readFile(
	new URL(
		"../../vite.config.ts",
		import.meta.url,
	),
	"utf8",
)

void test(
	"Vite ignores Orqeto atomic-write sibling files so self-apply does not crash the dev watcher",
	() => {
		assert.match(
			viteConfig,
			/\/\\\.orqeto-tmp-\\d\+-\\d\+\$\//,
		)
	},
)
