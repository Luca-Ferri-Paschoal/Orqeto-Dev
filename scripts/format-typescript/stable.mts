import {
	MAX_FORMAT_PASSES,
	normalizeSource,
	rootDirectory,
} from "./config.mts"
import { formatWithEslint } from "./eslint.mts"
import { formatSimpleJsxAttributeExpressions } from "./jsx.mts"
import { formatWithTypeScript } from "./typescript.mts"
import path from "node:path"

export async function formatToStable(
	fileName: string,
	source: string,
): Promise<string> {
	let current = normalizeSource(source)
	const seen = new Set<string>()
	for (let pass = 1; pass <= MAX_FORMAT_PASSES; pass++) {
		if (seen.has(current)) {
			throw new Error(`Formatter cycle detected for ${path.relative(
				rootDirectory,
				fileName,
			)}.`)
		}
		seen.add(current)
		const typeScriptFormatted = formatWithTypeScript(
			fileName,
			current,
		)
		const jsxAttributeFormatted = formatSimpleJsxAttributeExpressions(
			fileName,
			typeScriptFormatted,
		)
		const next = await formatWithEslint(
			fileName,
			jsxAttributeFormatted,
		)
		if (next === current)
			return current
		current = next
	}
	throw new Error(`Formatter did not converge after ${MAX_FORMAT_PASSES} passes for ${path.relative(
		rootDirectory,
		fileName,
	)}.`)
}

export async function assertStable(
	fileName: string,
	formatted: string,
): Promise<void> {
	if (await formatToStable(
		fileName,
		formatted,
	) !== formatted) {
		throw new Error(`Formatter is not idempotent for ${path.relative(
			rootDirectory,
			fileName,
		)}.`)
	}
}
