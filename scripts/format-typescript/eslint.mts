import {
	formatEslintConfigPath,
	normalizeSource,
	rootDirectory,
} from "./config.mts"
import { ESLint } from "eslint"

const eslintFormatter = new ESLint({
	cwd: rootDirectory,
	overrideConfigFile: formatEslintConfigPath,
	fix: true,
})

export async function formatWithEslint(
	fileName: string,
	source: string,
): Promise<string> {
	const [result] = await eslintFormatter.lintText(
		source,
		{ filePath: fileName },
	)
	if (!result)
		throw new Error(`ESLint did not return a formatter result for ${fileName}.`)
	const fatalMessages = result.messages.filter(message => message.fatal)
	if (fatalMessages.length > 0) {
		const details = fatalMessages.map(message => `${message.line}:${message.column} ${message.message}`).join("\n")
		throw new Error(`Formatting parse error in ${fileName}:\n${details}`)
	}
	return normalizeSource(result.output ?? source)
}
