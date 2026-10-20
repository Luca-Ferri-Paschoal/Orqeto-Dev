import {
	buildDirectorySizeReport,
	childrenOfDirectory,
	isSafeIgnoreSuggestion,
	largestOverBudgetFolders,
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

void test("Native ./ paths produce directory diagnostics for a 3.4 GB project", () => {
	const report = buildDirectorySizeReport([
		{ relativePath: "./node_modules/pkg/index.js", sizeBytes: 2_500_000_000 },
		{ relativePath: ".\\venv\\lib\\code.py", sizeBytes: 800_000_000 },
		{ relativePath: "./src/main.ts", sizeBytes: 1024 },
	])
	assert.equal(
		report.find(dir => dir.path === "node_modules")?.byteCount,
		2_500_000_000,
	)
	assert.equal(
		report.find(dir => dir.path === "venv")?.byteCount,
		800_000_000,
	)
	assert.deepEqual(
		childrenOfDirectory(
			report,
			"",
		).map(dir => dir.path),
		["node_modules", "venv", "src"],
	)
})

void test("Traversal and absolute discovery paths never become ignore suggestions", () => {
	const report = buildDirectorySizeReport([
		{ relativePath: "./../private.txt", sizeBytes: 99_999 },
		{ relativePath: "/outside/folder/file.ts", sizeBytes: 99_999 },
		{ relativePath: "C:\\Windows\\System32\\file.dll", sizeBytes: 99_999 },
		{ relativePath: "./vendor/pkg/file.ts", sizeBytes: 10 },
	])
	assert.deepEqual(
		report.map(dir => dir.path),
		["vendor", "vendor/pkg"],
	)
})

void test("Oversized nested dependency folders are suggested directly, without root-level navigation", () => {
	const mib = 1024 * 1024
	const report = buildDirectorySizeReport([
		{ relativePath: "./apps/api/node_modules/a/file.js", sizeBytes: 700 * mib },
		{ relativePath: "./apps/api/src/main.ts", sizeBytes: 10 * mib },
		{ relativePath: "./packages/vendor/dependency.bin", sizeBytes: 220 * mib },
		{ relativePath: "./README.md", sizeBytes: 10 },
	])
	assert.deepEqual(largestOverBudgetFolders(report).map(entry => entry.path), [
		"apps/api/node_modules/a",
		"packages/vendor",
	])
})
