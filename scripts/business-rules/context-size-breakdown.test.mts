import {
	buildDirectorySizeReport,
	childrenOfDirectory,
	isSafeIgnoreSuggestion,
	MAX_CONTEXT_CONTENT_BYTES,
} from "../../src/features/context/projectContextSizeReport.ts"
import { strict as assert } from "node:assert"
import { test } from "node:test"

void test("Full-project Scan diagnoses nested library folders without opening files", () => {
	const report = buildDirectorySizeReport([
		{ relativePath: "src/index.ts", sizeBytes: 600 },
		{ relativePath: "vendor/python/dependency.bin", sizeBytes: 250 * 1024 * 1024 },
		{ relativePath: "vendor/python/metadata.json", sizeBytes: 200 },
		{ relativePath: "vendor/js/bundle.bin", sizeBytes: 180 * 1024 * 1024 },
		{ relativePath: "README.md", sizeBytes: 500 },
	])
	const vendor = report.find(entry => entry.path === "vendor")
	assert.equal(
		vendor?.fileCount,
		3,
	)
	assert.equal(
		vendor?.byteCount,
		430 * 1024 * 1024 + 200,
	)
	assert.equal(
		childrenOfDirectory(
			report,
			"",
		).map(entry => entry.path).join(","),
		"vendor,src",
	)
	assert.equal(
		childrenOfDirectory(
			report,
			"vendor",
		)[0]?.path,
		"vendor/python",
	)
	assert.ok((vendor?.byteCount ?? 0) > MAX_CONTEXT_CONTENT_BYTES)
})

void test("No duplicated contribution from a file to its ancestor", () => {
	const report = buildDirectorySizeReport([
		{ relativePath: "src/a/one.txt", sizeBytes: 5 },
		{ relativePath: "src/a/two.txt", sizeBytes: 7 },
		{ relativePath: "src/b/file.txt", sizeBytes: 11 },
	])
	assert.deepEqual(
		report.find(entry => entry.path === "src")?.byteCount,
		23,
	)
	assert.deepEqual(
		report.find(entry => entry.path === "src/a")?.fileCount,
		2,
	)
	assert.deepEqual(
		report.find(entry => entry.path === "src/b")?.parentPath,
		"src",
	)
})

void test("Candidate exclusion is limited to safe project-relative directories", () => {
	for (const unsafe of ["", "/tmp", "./src", "a/../b", "a//b", "C:/Windows", "a\\b", "a/\\0"]) {
		assert.equal(
			isSafeIgnoreSuggestion(unsafe),
			false,
			unsafe,
		)
	}

	assert.equal(
		isSafeIgnoreSuggestion("node_modules"),
		true,
	)
	assert.equal(
		isSafeIgnoreSuggestion(".cache/large-library"),
		true,
	)
	assert.equal(
		isSafeIgnoreSuggestion("src-tauri/target"),
		true,
	)
})

void test("Invalid discovery path is not eligible as an ignore suggestion", () => {
	const report = buildDirectorySizeReport([
		{ relativePath: "../outside/private.txt", sizeBytes: 100000 },
		{ relativePath: "legitimate/file.ts", sizeBytes: 1000 },
	])
	assert.equal(
		report.length,
		1,
	)
	assert.equal(
		report[0]?.path,
		"legitimate",
	)
})
