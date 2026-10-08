import path from "node:path"

export const PROJECT_ROOT = process.cwd()

export const FILES = {
	packageJson: path.join(
		PROJECT_ROOT,
		"package.json",
	),
	packageLock: path.join(
		PROJECT_ROOT,
		"package-lock.json",
	),
	vscodePackageJson: path.join(
		PROJECT_ROOT,
		"integrations",
		"vscode",
		"package.json",
	),
	vscodePackageLock: path.join(
		PROJECT_ROOT,
		"integrations",
		"vscode",
		"package-lock.json",
	),
	cargoToml: path.join(
		PROJECT_ROOT,
		"src-tauri",
		"Cargo.toml",
	),
	cargoLock: path.join(
		PROJECT_ROOT,
		"src-tauri",
		"Cargo.lock",
	),
	tauriConfig: path.join(
		PROJECT_ROOT,
		"src-tauri",
		"tauri.conf.json",
	),
} as const

export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SHORT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function normalizeRequestedVersion(value: string): string {
	const trimmed = value.trim()
	if (SHORT_VERSION_PATTERN.test(trimmed))
		return `${trimmed}.0`
	if (!SEMVER_PATTERN.test(trimmed))
		throw new Error(`Invalid version: "${value}". Use SemVer, for example 0.9.0 or 1.0.0-beta.1.`)
	return trimmed
}
