import { FILES } from "./config.mts"
import { readFile } from "node:fs/promises"

export interface ProjectVersionFiles {
	packageJsonContent: string
	packageLockContent: string
	vscodePackageJsonContent: string
	vscodePackageLockContent: string
	cargoTomlContent: string
	cargoLockContent: string
	tauriConfigContent: string
}

export async function readProjectFiles(): Promise<ProjectVersionFiles> {
	const [
		packageJsonContent,
		packageLockContent,
		vscodePackageJsonContent,
		vscodePackageLockContent,
		cargoTomlContent,
		cargoLockContent,
		tauriConfigContent,
	] = await Promise.all([
		readFile(
			FILES.packageJson,
			"utf8",
		),
		readFile(
			FILES.packageLock,
			"utf8",
		),
		readFile(
			FILES.vscodePackageJson,
			"utf8",
		),
		readFile(
			FILES.vscodePackageLock,
			"utf8",
		),
		readFile(
			FILES.cargoToml,
			"utf8",
		),
		readFile(
			FILES.cargoLock,
			"utf8",
		),
		readFile(
			FILES.tauriConfig,
			"utf8",
		),
	])
	return {
		packageJsonContent,
		packageLockContent,
		vscodePackageJsonContent,
		vscodePackageLockContent,
		cargoTomlContent,
		cargoLockContent,
		tauriConfigContent,
	}
}
