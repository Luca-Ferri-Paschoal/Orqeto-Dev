import {
	replaceCargoLockVersion,
	replaceCargoPackageVersion,
} from "./cargo.mts"
import { checkVersions } from "./check.mts"
import {
	FILES,
	normalizeRequestedVersion,
} from "./config.mts"
import { readProjectFiles } from "./files.mts"
import {
	getStringProperty,
	isJsonObject,
	parseJsonObject,
	stringifyJson,
} from "./json.mts"
import { writeFile } from "node:fs/promises"

interface PreparedFile {
	path: string
	original: string
	next: string
}

export async function setVersion(requestedVersion: string | undefined): Promise<void> {
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
	const currentPackageVersion = getStringProperty(
		packageJson,
		"version",
		FILES.packageJson,
	)
	const version = normalizeRequestedVersion(requestedVersion ?? currentPackageVersion)

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

	packageJson["version"] = version
	packageLock["version"] = version
	lockRootPackage["version"] = version
	vscodePackageJson["version"] = version
	vscodePackageLock["version"] = version
	vscodeLockRootPackage["version"] = version
	tauriConfig["version"] = version

	const preparedFiles: PreparedFile[] = [
		{ path: FILES.packageJson, original: files.packageJsonContent, next: stringifyJson(packageJson) },
		{ path: FILES.packageLock, original: files.packageLockContent, next: stringifyJson(packageLock) },
		{ path: FILES.vscodePackageJson, original: files.vscodePackageJsonContent, next: stringifyJson(vscodePackageJson) },
		{ path: FILES.vscodePackageLock, original: files.vscodePackageLockContent, next: stringifyJson(vscodePackageLock) },
		{
			path: FILES.cargoToml,
			original: files.cargoTomlContent,
			next: replaceCargoPackageVersion(
				files.cargoTomlContent,
				version,
				FILES.cargoToml,
			),
		},
		{
			path: FILES.cargoLock,
			original: files.cargoLockContent,
			next: replaceCargoLockVersion(
				files.cargoLockContent,
				version,
				FILES.cargoLock,
			),
		},
		{ path: FILES.tauriConfig, original: files.tauriConfigContent, next: stringifyJson(tauriConfig) },
	]
	const writtenFiles: PreparedFile[] = []
	try {
		for (const file of preparedFiles) {
			if (file.next === file.original)
				continue
			await writeFile(
				file.path,
				file.next,
				"utf8",
			)
			writtenFiles.push(file)
		}
	} catch (error) {
		for (const file of writtenFiles.reverse()) {
			try {
				await writeFile(
					file.path,
					file.original,
					"utf8",
				)
			} catch {
				// Best-effort rollback. The original write error remains primary.
			}
		}
		throw error
	}
	console.log(`[Version] App and extension updated to ${version}.`)
	if (requestedVersion !== undefined && requestedVersion.trim() !== version)
		console.log(`[Version] "${requestedVersion.trim()}" was normalized to "${version}".`)
	await checkVersions()
}
