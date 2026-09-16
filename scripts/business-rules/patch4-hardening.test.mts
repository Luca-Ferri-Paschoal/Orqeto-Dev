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
	"BR-STAGE-002 native virtual-drop staging uses unpredictable fresh directories",
	async () => {
		const source = await readProjectFile("src-tauri/windows/native_drop.cpp")

		assert.ok(source.includes("CoCreateGuid"))
		assert.ok(source.includes("CreateFreshChildDirectory"))
		assert.ok(source.includes("CreateDirectoryW"))
		assert.ok(!source.includes("GetTickCount64"))
	},
)

void test(
	"Patch 4 Files Apply freezes source input before mutation",
	async () => {
		const source = await readProjectFile("src-tauri/src/overlay.rs")

		assert.ok(source.includes("freeze_overlay_input"))
		assert.ok(source.includes("validate_frozen_overlay_for_apply"))
		assert.ok(source.includes("apply_overlay_manifest_blocking"))
	},
)
