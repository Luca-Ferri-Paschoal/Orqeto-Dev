import {
	getCargoLockVersion,
	getCargoPackageVersion,
} from "./cargo.mts"
import {
	FILES,
	SEMVER_PATTERN,
} from "./config.mts"
import { readProjectFiles } from "./files.mts"
import {
	getStringProperty,
	isJsonObject,
	parseJsonObject,
} from "./json.mts"

export async function checkVersions(): Promise<void> {
	const files = await readProjectFiles()
	const packageJson = parseJsonObject(
		files.packageJsonContent,
		FILES.packageJson,
	)
	const packageLock = parseJsonObject(
		files.packageLockContent,
		FILES.packageLock,
	)
	const vscodePackageJson = parseJsonObject(
		files.vscodePackageJsonContent,
		FILES.vscodePackageJson,
	)
	const vscodePackageLock = parseJsonObject(
		files.vscodePackageLockContent,
		FILES.vscodePackageLock,
	)
	const tauriConfig = parseJsonObject(
		files.tauriConfigContent,
		FILES.tauriConfig,
	)
	const canonicalVersion = getStringProperty(
		packageJson,
		"version",
		FILES.packageJson,
	)
	if (!SEMVER_PATTERN.test(canonicalVersion))
		throw new Error(`package.json contains an invalid SemVer version: "${canonicalVersion}".`)

	const lockPackages = packageLock["packages"]
	if (!isJsonObject(lockPackages))
		throw new Error("package-lock.json does not contain packages as an object.")
	const lockRootPackage = lockPackages[""]
	if (!isJsonObject(lockRootPackage))
		throw new Error("package-lock.json does not contain the root package at packages[\"\"].")
	const vscodeLockPackages = vscodePackageLock["packages"]
	if (!isJsonObject(vscodeLockPackages))
		throw new Error("integrations/vscode/package-lock.json does not contain packages as an object.")
	const vscodeLockRootPackage = vscodeLockPackages[""]
	if (!isJsonObject(vscodeLockRootPackage))
		throw new Error("integrations/vscode/package-lock.json does not contain the root package at packages[\"\"].")

	const versions = new Map<string, string>([
		["package.json", canonicalVersion],
		["package-lock.json", getStringProperty(
			packageLock,
			"version",
			FILES.packageLock,
		)],
		["package-lock.json packages[\"\"]", getStringProperty(
			lockRootPackage,
			"version",
			FILES.packageLock,
		)],
		["integrations/vscode/package.json", getStringProperty(
			vscodePackageJson,
			"version",
			FILES.vscodePackageJson,
		)],
		["integrations/vscode/package-lock.json", getStringProperty(
			vscodePackageLock,
			"version",
			FILES.vscodePackageLock,
		)],
		["integrations/vscode/package-lock.json packages[\"\"]", getStringProperty(
			vscodeLockRootPackage,
			"version",
			FILES.vscodePackageLock,
		)],
		["src-tauri/Cargo.toml", getCargoPackageVersion(
			files.cargoTomlContent,
			FILES.cargoToml,
		)],
		["src-tauri/Cargo.lock", getCargoLockVersion(
			files.cargoLockContent,
			FILES.cargoLock,
		)],
		["src-tauri/tauri.conf.json", getStringProperty(
			tauriConfig,
			"version",
			FILES.tauriConfig,
		)],
	])
	const mismatches = [...versions.entries()].filter(([, version]) => version !== canonicalVersion)
	if (mismatches.length > 0) {
		const details = mismatches.map(([fileName, version]) => `- ${fileName}: ${version}`).join("\n")
		throw new Error(`Versions are out of sync. Source of truth package.json: ${canonicalVersion}\n${details}\nRun: npm run version:set`)
	}
	console.log(`[Version] ${canonicalVersion} is synchronized across all app and extension metadata.`)
}
