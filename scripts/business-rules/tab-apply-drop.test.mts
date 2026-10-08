import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

void test(
	"BR-ROUTE-006 rooted project tabs are direct Apply targets locked to that project and drop surfaces advertise their action cursor",
	async () => {
		const [
			app,
			nativeWorkspaceDrop,
			nativeDrop,
			tabs,
			tabStyles,
			contextStyles,
			applyStyles,
			ignoreStyles,
		] = await Promise.all([
			read("src/App/index.tsx"),
			read("src/features/context/components/ProjectWorkspacePane/hooks/useNativeWorkspaceDrop.ts"),
			read("src/features/context/components/ProjectWorkspacePane/nativeDrop.ts"),
			read("src/features/context/components/ProjectTabs/index.tsx"),
			read("src/features/context/components/ProjectTabs/style.ts"),
			read("src/features/context/components/DropZone/style.ts"),
			read("src/features/context/components/ApplyDropZone/style.ts"),
			read("src/features/context/components/DevIgnoreDialog/style.ts"),
		])

		assert.match(
			tabs,
			/data-project-tab-apply-target=\{tab\.rootFolder === null[\s\S]*?"true"\}/,
		)
		assert.match(
			tabs,
			/onApplyDropRef\.current\([\s\S]*id,[\s\S]*payload\.paths \?\? \[\],[\s\S]*payload\.temporaryRoot \?\? null/,
		)
		assert.match(
			nativeDrop,
			/PROJECT_TAB_APPLY_SELECTOR = "\[data-project-tab-apply-target\]\[data-project-tab-id\]"/,
		)
		assert.match(
			nativeWorkspaceDrop,
			/return getProjectTabApplyTarget\(position\) === null \?\s*null\s*:\s*"applyTab"/,
		)
		assert.match(
			nativeWorkspaceDrop,
			/if \(target !== "applyTab"\)[\s\S]*cleanupTemporaryRoot/,
		)
		assert.match(
			app,
			/const sourceTab: ProjectTab & \{ rootFolder: string \} = \{ \.\.\.tab, rootFolder: tab\.rootFolder \}/,
		)
		assert.match(
			app,
			/<ProjectTabs[\s\S]*onApplyDrop=\{\([\s\S]*controller\.routeApplyDrop\(/,
		)
		assert.match(
			tabs,
			/setExternalDropTabId\(id\)/,
		)
		assert.match(
			tabStyles,
			/externalDrop && !dragging && \[[\s\S]*"cursor-copy"/,
		)

		for (const styles of [
			contextStyles,
			applyStyles,
			ignoreStyles,
		]) {
			assert.match(
				styles,
				/"cursor-copy"/,
			)
		}
	},
)
