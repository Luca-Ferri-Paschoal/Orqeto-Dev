import { readProjectFile } from "./testSupport/source.mts"
import assert from "node:assert/strict"
import test from "node:test"

async function read(path: string): Promise<string> {
	return readProjectFile(path)
}

void test(
	"BR-WIN-001 external actions and valid native drag-enter transiently raise Orqeto without persistent topmost state",
	async () => {
		const [
			nativeDropCpp,
			nativeDropRust,
			externalIntegration,
			lib,
		] = await Promise.all([
			read("src-tauri/windows/native_drop.cpp"),
			read("src-tauri/src/native_drop.rs"),
			read("src-tauri/src/external_integration.rs"),
			read("src-tauri/src/lib.rs"),
		])

		assert.match(
			nativeDropCpp,
			/SetWindowPos\([\s\S]*HWND_TOPMOST[\s\S]*SetWindowPos\([\s\S]*HWND_NOTOPMOST/,
		)
		assert.match(
			nativeDropCpp,
			/DragEnter\([\s\S]*if \(valid_\) \{[\s\S]*BringRootWindowToFront\(hwnd_\);[\s\S]*Emit\(kEventEnter/,
		)
		assert.match(
			nativeDropRust,
			/pub fn bring_to_front\(window: &WebviewWindow\)/,
		)
		assert.match(
			externalIntegration,
			/crate::native_drop::bring_to_front\(&window\)/,
		)
		assert.match(
			lib,
			/current_process_has_external_actions\(\)[\s\S]*native_drop::bring_to_front\(&window\)/,
		)
	},
)

void test(
	"BR-WIN-003 native drop target refresh never revokes the active OLE drag target",
	async () => {
		const nativeDropCpp = await read("src-tauri/windows/native_drop.cpp")

		assert.match(
			nativeDropCpp,
			/g_drag_in_progress\.store\([\s\S]*valid_[\s\S]*BringRootWindowToFront\(hwnd_\)/,
		)
		assert.match(
			nativeDropCpp,
			/bool RefreshTargets\(\)[\s\S]*g_drag_in_progress\.load\(std::memory_order_acquire\)[\s\S]*return !g_registrations\.empty\(\);[\s\S]*ClearRegistrations\(\)/,
		)
		assert.match(
			nativeDropCpp,
			/DragLeave\(\)[\s\S]*g_drag_in_progress\.store\([\s\S]*false/,
		)
		assert.match(
			nativeDropCpp,
			/Drop\([\s\S]*g_drag_in_progress\.store\([\s\S]*false/,
		)
	},
)

void test(
	"BR-WIN-002 Explorer registration removes legacy Orqeto verbs before writing canonical entries",
	async () => {
		const [externalIntegration, hooks] = await Promise.all([
			read("src-tauri/src/external_integration.rs"),
			read("src-tauri/windows/hooks.nsh"),
		])

		assert.match(
			externalIntegration,
			/r"Software\\Classes\\Folder\\shell"/,
		)
		assert.match(
			externalIntegration,
			/r"Software\\Classes\\AllFilesystemObjects\\shell"/,
		)
		assert.match(
			externalIntegration,
			/label\.contains\("orqeto dev"\)/,
		)
		assert.match(
			externalIntegration,
			/remove_legacy_shell_verbs\(&hkcu\)\?[\s\S]*create_subkey\(APP_KEY\)/,
		)
		assert.match(
			hooks,
			/Software\\Classes\\Folder\\shell\\OrqetoDev/,
		)
		assert.match(
			hooks,
			/Software\\Classes\\AllFilesystemObjects\\shell\\OrqetoDev/,
		)
	},
)
