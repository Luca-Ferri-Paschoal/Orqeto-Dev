import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

void test("project tabs stay level and only capture wheel scrolling when the strip overflows", async () => {
	const [component, styles, overlayScrollbar] = await Promise.all([
		read("src/features/context/components/ProjectTabs/index.tsx"),
		read("src/features/context/components/ProjectTabs/style.ts"),
		read("src/shared/components/OverlayScrollbarManager/index.tsx"),
	])

	assert.match(
		component,
		/maximumScrollLeft <= 1/,
	)
	assert.match(
		component,
		/event\.preventDefault\(\)/,
	)
	assert.match(
		component,
		/event\.stopPropagation\(\)/,
	)
	assert.match(
		component,
		/\{ passive: false \}/,
	)
	assert.doesNotMatch(
		component,
		/onWheel=\{handleWheel\}/,
	)
	assert.match(
		styles,
		/h-9 min-w-0 items-stretch/,
	)
	assert.match(
		styles,
		/min-w-28 flex-1 basis-0 shrink/,
	)
	assert.match(
		styles,
		/flex h-full w-full/,
	)
	assert.doesNotMatch(
		styles,
		/active \?[\s\S]*h-10[\s\S]*h-8/,
	)
	assert.match(
		styles,
		/overflow-x-auto overflow-y-hidden/,
	)
	assert.match(
		overlayScrollbar,
		/function handleDocumentScroll\(\): void/,
	)
	assert.doesNotMatch(
		overlayScrollbar,
		/target\.matches\(SCROLL_AREA_SELECTOR\)/,
	)
})
