import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readFile(
		path,
		"utf8",
	)
}

// BR-UI-003
void test("BR-UI-003 enabled buttons expose pointer and visual hover affordance without styling disabled controls", async () => {
	const globalCss = await read("src/styles/global.css")

	assert.match(
		globalCss,
		/button:not\(:disabled\)\s*\{[\s\S]*cursor:\s*pointer;/,
	)
	assert.match(
		globalCss,
		/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*button:not\(:disabled\):hover\s*\{[\s\S]*outline:[\s\S]*filter:\s*brightness\(/,
	)
	assert.doesNotMatch(
		globalCss,
		/button:disabled:hover/,
	)
})

// BR-UI-004
void test("BR-UI-004 shared dialogs are modal, keyboard cancellable, focus-trapped, and restore prior focus", async () => {
	const dialog = await read("src/shared/components/Dialog/index.tsx")

	assert.match(
		dialog,
		/role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby=\{labelledBy\}/,
	)
	assert.match(
		dialog,
		/event\.key === "Escape"[\s\S]*onCancelRef\.current\(\)/,
	)
	assert.match(
		dialog,
		/event\.key !== "Tab"[\s\S]*event\.shiftKey && document\.activeElement === first[\s\S]*!event\.shiftKey && document\.activeElement === last/,
	)
	assert.match(
		dialog,
		/previouslyFocused\?\.isConnected[\s\S]*previouslyFocused\.focus\(\)/,
	)
})
