import type {
	CommonBatchOptions,
	DiagnosticScope,
} from "./model.mts"

export function parseCommonBatchOptions(
	argv: readonly string[],
	defaultFileLimit = 10,
): CommonBatchOptions {
	let fileLimit = defaultFileLimit
	let scope: DiagnosticScope = "all"
	let transfer = false
	let positionalLimitConsumed = false

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]

		if (!argument)
			continue

		if (argument === "--transfer" || argument === "--clipboard") {
			transfer = true
			continue
		}

		if (argument === "--scope" || argument === "--workspace") {
			const value = argv[index + 1]

			if (!value)
				throw new Error(`${argument} requires a value.`)

			scope = parseScope(value)
			index++
			continue
		}

		if (argument.startsWith("--scope=")) {
			scope = parseScope(argument.slice("--scope=".length))
			continue
		}

		if (argument.startsWith("--workspace=")) {
			scope = parseScope(argument.slice("--workspace=".length))
			continue
		}

		if (argument === "--limit") {
			const value = argv[index + 1]

			if (!value)
				throw new Error("--limit requires a value.")

			fileLimit = parseFileLimit(value)
			index++
			continue
		}

		if (argument.startsWith("--limit=")) {
			fileLimit = parseFileLimit(argument.slice("--limit=".length))
			continue
		}

		if (!positionalLimitConsumed && /^\d+$/.test(argument)) {
			fileLimit = parseFileLimit(argument)
			positionalLimitConsumed = true
			continue
		}

		throw new Error(`Unknown batch argument: ${argument}`)
	}

	return {
		fileLimit,
		scope,
		transfer,
	}
}

function parseScope(value: string): DiagnosticScope {
	switch (value.toLowerCase()) {
		case "all":
			return "all"
		case "app":
		case "desktop":
			return "app"
		case "vscode":
		case "extension":
			return "vscode"
		default:
			throw new Error(`Expected scope "all", "app", or "vscode", received "${value}".`)
	}
}

function parseFileLimit(value: string): number {
	const fileLimit = Number(value)

	if (!Number.isSafeInteger(fileLimit) || fileLimit < 1)
		throw new Error("The batch file limit must be a positive integer.")

	return fileLimit
}
