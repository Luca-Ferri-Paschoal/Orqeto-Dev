import { checkVersions } from "./version/check.mts"
import { setVersion } from "./version/set.mts"

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const checkOnly = args.includes("--check")
	const positionalArgs = args.filter(argument => argument !== "--check")
	if (checkOnly) {
		if (positionalArgs.length > 0)
			throw new Error("--check does not accept a version. Use npm run version:check.")
		await checkVersions()
		return
	}
	if (positionalArgs.length > 1)
		throw new Error("Provide at most one version: npm run version:set -- 0.9.0")
	await setVersion(positionalArgs[0])
}

void main().catch(error => {
	console.error(`[Version] ${error instanceof Error ?
		error.message :
		String(error)}`)
	process.exitCode = 1
})
