import {
	readFile,
	writeFile,
} from "node:fs/promises"
import path from "node:path"

const PROJECT_ROOT = process.cwd()

const FILES = {
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

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SHORT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/

interface JsonObject {
	[key: string]: unknown
}

interface PreparedFile {
	path: string
	original: string
	next: string
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonObject(
	content: string,
	filePath: string,
): JsonObject {
	const parsed: unknown = JSON.parse(content)

	if (!isJsonObject(parsed)) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} deve conter um objeto JSON.`)
	}

	return parsed
}

function stringifyJson(value: JsonObject): string {
	return `${JSON.stringify(
		value,
		null,
		"\t",
	)}\n`
}

function getStringProperty(
	object: JsonObject,
	property: string,
	filePath: string,
): string {
	const value = object[property]

	if (typeof value !== "string") {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} não possui ${property} como string.`)
	}

	return value
}

function normalizeRequestedVersion(value: string): string {
	const trimmed = value.trim()

	if (SHORT_VERSION_PATTERN.test(trimmed))
		return `${trimmed}.0`

	if (!SEMVER_PATTERN.test(trimmed))
		throw new Error(`Versão inválida: "${value}". Use SemVer, por exemplo 0.9.0 ou 1.0.0-beta.1.`)

	return trimmed
}

function replaceCargoPackageVersion(
	content: string,
	version: string,
	filePath: string,
): string {
	const packageHeader = "[package]"
	const sectionStart = content.indexOf(packageHeader)

	if (sectionStart < 0) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} não possui a seção [package].`)
	}

	const followingSection = content.indexOf(
		"\n[",
		sectionStart + packageHeader.length,
	)
	const sectionEnd = followingSection < 0 ?
		content.length :
		followingSection + 1
	const section = content.slice(
		sectionStart,
		sectionEnd,
	)
	const versionMatches = section.match(/^version\s*=\s*"[^"]+"\s*$/gm) ?? []

	if (versionMatches.length !== 1) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} deve possuir exatamente uma versão em [package].`)
	}

	const nextSection = section.replace(
		/^version\s*=\s*"[^"]+"\s*$/m,
		`version = "${version}"`,
	)

	return `${content.slice(
		0,
		sectionStart,
	)}${nextSection}${content.slice(sectionEnd)}`
}

function getCargoPackageVersion(
	content: string,
	filePath: string,
): string {
	const packageHeader = "[package]"
	const sectionStart = content.indexOf(packageHeader)

	if (sectionStart < 0) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} não possui a seção [package].`)
	}

	const followingSection = content.indexOf(
		"\n[",
		sectionStart + packageHeader.length,
	)
	const sectionEnd = followingSection < 0 ?
		content.length :
		followingSection + 1
	const section = content.slice(
		sectionStart,
		sectionEnd,
	)
	const match = section.match(/^version\s*=\s*"([^"]+)"\s*$/m)
	const version = match?.[1]

	if (!version) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} não possui uma versão válida em [package].`)
	}

	return version
}

function findCargoLockPackageBlock(
	content: string,
	filePath: string,
): {
	start: number
	end: number
	block: string
} {
	const headers = [...content.matchAll(/^\[\[package\]\]\s*$/gm)]
	const matches = headers.flatMap((header, index) => {
		const start = header.index ?? 0
		const end = headers[index + 1]?.index ?? content.length
		const block = content.slice(
			start,
			end,
		)

		return /^name\s*=\s*"orqeto-dev"\s*$/m.test(block) ?
			[{ start, end, block }] :
			[]
	})

	if (matches.length !== 1) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} deve possuir exatamente um pacote orqeto-dev.`)
	}

	const match = matches[0]

	if (match === undefined) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} não possui o pacote orqeto-dev.`)
	}

	return match
}

function replaceCargoLockVersion(
	content: string,
	version: string,
	filePath: string,
): string {
	const { start, end, block } = findCargoLockPackageBlock(
		content,
		filePath,
	)
	const versionMatches = block.match(/^version\s*=\s*"[^"]+"\s*$/gm) ?? []

	if (versionMatches.length !== 1) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} deve possuir exatamente uma versão no pacote orqeto-dev.`)
	}

	const nextBlock = block.replace(
		/^version\s*=\s*"[^"]+"\s*$/m,
		`version = "${version}"`,
	)

	return `${content.slice(
		0,
		start,
	)}${nextBlock}${content.slice(end)}`
}

function getCargoLockVersion(
	content: string,
	filePath: string,
): string {
	const { block } = findCargoLockPackageBlock(
		content,
		filePath,
	)
	const match = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)
	const version = match?.[1]

	if (!version) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} não possui uma versão válida no pacote orqeto-dev.`)
	}

	return version
}

async function readProjectFiles(): Promise<{
	packageJsonContent: string
	packageLockContent: string
	vscodePackageJsonContent: string
	vscodePackageLockContent: string
	cargoTomlContent: string
	cargoLockContent: string
	tauriConfigContent: string
}> {
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

async function checkVersions(): Promise<void> {
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
		throw new Error(`package.json possui uma versão SemVer inválida: "${canonicalVersion}".`)

	const lockPackages = packageLock["packages"]

	if (!isJsonObject(lockPackages))
		throw new Error("package-lock.json não possui packages como objeto.")

	const lockRootPackage = lockPackages[""]

	if (!isJsonObject(lockRootPackage))
		throw new Error("package-lock.json não possui o pacote raiz em packages[\"\"].")

	const vscodeLockPackages = vscodePackageLock["packages"]

	if (!isJsonObject(vscodeLockPackages))
		throw new Error("integrations/vscode/package-lock.json não possui packages como objeto.")

	const vscodeLockRootPackage = vscodeLockPackages[""]

	if (!isJsonObject(vscodeLockRootPackage))
		throw new Error("integrations/vscode/package-lock.json não possui o pacote raiz em packages[\"\"].")

	const versions = new Map<string, string>([
		["package.json", canonicalVersion],
		[
			"package-lock.json",
			getStringProperty(
				packageLock,
				"version",
				FILES.packageLock,
			),
		],
		[
			"package-lock.json packages[\"\"]",
			getStringProperty(
				lockRootPackage,
				"version",
				FILES.packageLock,
			),
		],
		[
			"integrations/vscode/package.json",
			getStringProperty(
				vscodePackageJson,
				"version",
				FILES.vscodePackageJson,
			),
		],
		[
			"integrations/vscode/package-lock.json",
			getStringProperty(
				vscodePackageLock,
				"version",
				FILES.vscodePackageLock,
			),
		],
		[
			"integrations/vscode/package-lock.json packages[\"\"]",
			getStringProperty(
				vscodeLockRootPackage,
				"version",
				FILES.vscodePackageLock,
			),
		],
		[
			"src-tauri/Cargo.toml",
			getCargoPackageVersion(
				files.cargoTomlContent,
				FILES.cargoToml,
			),
		],
		[
			"src-tauri/Cargo.lock",
			getCargoLockVersion(
				files.cargoLockContent,
				FILES.cargoLock,
			),
		],
		[
			"src-tauri/tauri.conf.json",
			getStringProperty(
				tauriConfig,
				"version",
				FILES.tauriConfig,
			),
		],
	])
	const mismatches = [...versions.entries()].filter(([, version]) => version !== canonicalVersion)

	if (mismatches.length > 0) {
		const details = mismatches
			.map(([fileName, version]) => `- ${fileName}: ${version}`)
			.join("\n")

		throw new Error(`Versões fora de sincronia. Fonte de verdade package.json: ${canonicalVersion}\n${details}\nExecute: npm run version:set`)
	}

	console.log(`[Version] ${canonicalVersion} está sincronizada em todos os metadados do app e da extensão.`)
}

async function setVersion(requestedVersion: string | undefined): Promise<void> {
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
	const version = requestedVersion === undefined ?
		normalizeRequestedVersion(currentPackageVersion) :
		normalizeRequestedVersion(requestedVersion)
	const lockPackages = packageLock["packages"]

	if (!isJsonObject(lockPackages))
		throw new Error("package-lock.json não possui packages como objeto.")

	const lockRootPackage = lockPackages[""]

	if (!isJsonObject(lockRootPackage))
		throw new Error("package-lock.json não possui o pacote raiz em packages[\"\"].")

	const vscodeLockPackages = vscodePackageLock["packages"]

	if (!isJsonObject(vscodeLockPackages))
		throw new Error("integrations/vscode/package-lock.json não possui packages como objeto.")

	const vscodeLockRootPackage = vscodeLockPackages[""]

	if (!isJsonObject(vscodeLockRootPackage))
		throw new Error("integrations/vscode/package-lock.json não possui o pacote raiz em packages[\"\"].")

	packageJson["version"] = version
	packageLock["version"] = version
	lockRootPackage["version"] = version
	vscodePackageJson["version"] = version
	vscodePackageLock["version"] = version
	vscodeLockRootPackage["version"] = version
	tauriConfig["version"] = version

	const preparedFiles: PreparedFile[] = [
		{
			path: FILES.packageJson,
			original: files.packageJsonContent,
			next: stringifyJson(packageJson),
		},
		{
			path: FILES.packageLock,
			original: files.packageLockContent,
			next: stringifyJson(packageLock),
		},
		{
			path: FILES.vscodePackageJson,
			original: files.vscodePackageJsonContent,
			next: stringifyJson(vscodePackageJson),
		},
		{
			path: FILES.vscodePackageLock,
			original: files.vscodePackageLockContent,
			next: stringifyJson(vscodePackageLock),
		},
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
		{
			path: FILES.tauriConfig,
			original: files.tauriConfigContent,
			next: stringifyJson(tauriConfig),
		},
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
				// Best-effort rollback. The original write error remains the primary failure.
			}
		}

		throw error
	}

	console.log(`[Version] App e extensão atualizados para ${version}.`)

	if (requestedVersion !== undefined && requestedVersion.trim() !== version)
		console.log(`[Version] "${requestedVersion.trim()}" foi normalizada para "${version}".`)

	await checkVersions()
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const checkOnly = args.includes("--check")
	const positionalArgs = args.filter(argument => argument !== "--check")

	if (checkOnly) {
		if (positionalArgs.length > 0)
			throw new Error("--check não aceita uma versão. Use npm run version:check.")

		await checkVersions()
		return
	}

	if (positionalArgs.length > 1)
		throw new Error("Use no máximo uma versão: npm run version:set -- 0.9.0")

	await setVersion(positionalArgs[0])
}

void main().catch(error => {
	const message = error instanceof Error ?
		error.message :
		String(error)

	console.error(`[Version] ${message}`)
	process.exitCode = 1
})
