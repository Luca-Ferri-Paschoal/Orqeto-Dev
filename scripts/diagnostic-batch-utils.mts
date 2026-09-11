import { spawn } from "node:child_process"
import {
	copyFile,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type DiagnosticScope = "all" | "app" | "vscode"

export interface CommonBatchOptions {
	fileLimit: number
	scope: DiagnosticScope
	transfer: boolean
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

export const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
)

export interface CommandExecutionResult {
	exitCode: number
	output: string
}

export function runNpmCommand(args: readonly string[]): Promise<CommandExecutionResult> {
	const npmExecPath = process.env.npm_execpath

	if (npmExecPath) {
		return runCapturedCommand(
			process.execPath,
			[
				npmExecPath,
				...args,
			],
		)
	}

	return runCapturedCommand(
		"npm",
		args,
		process.platform === "win32",
	)
}

function runCapturedCommand(
	command: string,
	args: readonly string[],
	shell = false,
): Promise<CommandExecutionResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			command,
			args,
			{
				cwd: rootDirectory,
				shell,
				stdio: [
					"ignore",
					"pipe",
					"pipe",
				],
				windowsHide: true,
			},
		)
		child.stdout.setEncoding("utf8")
		child.stderr.setEncoding("utf8")

		const chunks: string[] = []

		child.stdout.on(
			"data",
			(chunk: string) => chunks.push(chunk),
		)
		child.stderr.on(
			"data",
			(chunk: string) => chunks.push(chunk),
		)
		child.on(
			"error",
			reject,
		)
		child.on(
			"close",
			code => resolve({
				exitCode: code ?? 1,
				output: chunks.join(""),
			}),
		)
	})
}

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

		if (
			argument === "--transfer" ||
			argument === "--clipboard"
		) {
			transfer = true
			continue
		}

		if (
			argument === "--scope" ||
			argument === "--workspace"
		) {
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

		if (
			!positionalLimitConsumed &&
			/^\d+$/.test(argument)
		) {
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

export async function prepareOutputDirectory(outputDirectory: string): Promise<string> {
	await rm(
		outputDirectory,
		{
			recursive: true,
			force: true,
		},
	)

	const filesDirectory = path.join(
		outputDirectory,
		"files",
	)

	await mkdir(
		filesDirectory,
		{
			recursive: true,
		},
	)

	return filesDirectory
}

export function getMarkdownLanguage(filePath: string): string {
	switch (path.extname(filePath)) {
		case ".ts":
		case ".mts":
		case ".cts":
			return "ts"

		case ".tsx":
			return "tsx"

		case ".js":
		case ".mjs":
		case ".cjs":
			return "js"

		case ".jsx":
			return "jsx"

		case ".json":
			return "json"

		default:
			return ""
	}
}

export function escapeInlineMarkdown(value: string): string {
	return value.replaceAll(
		"`",
		"\\`",
	)
}

export function isInsideRoot(filePath: string): boolean {
	const relativePath = path.relative(
		rootDirectory,
		filePath,
	)

	return relativePath !== "" &&
		!relativePath.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relativePath)
}

export async function appendSourceFiles(
	report: string[],
	filesDirectory: string,
	filePaths: readonly string[],
): Promise<void> {
	report.push(
		"## Files",
		"",
	)

	for (const filePath of [...new Set(filePaths)]) {
		if (!isInsideRoot(filePath))
			continue

		const relativeFilePath = path.relative(
			rootDirectory,
			filePath,
		)
		const source = await readFile(
			filePath,
			"utf8",
		)
		const copiedFilePath = path.join(
			filesDirectory,
			relativeFilePath,
		)

		await mkdir(
			path.dirname(copiedFilePath),
			{
				recursive: true,
			},
		)

		await copyFile(
			filePath,
			copiedFilePath,
		)

		const language = getMarkdownLanguage(filePath)

		report.push(
			`### ${relativeFilePath}`,
			"",
			"````" + language,
			source,
			"````",
			"",
		)
	}
}

export async function writeReport(
	reportPath: string,
	report: readonly string[],
): Promise<void> {
	await writeFile(
		reportPath,
		`${report.join("\n")}\n`,
		"utf8",
	)
}

export async function transferReportIfRequested(
	reportPath: string,
	transfer: boolean,
): Promise<void> {
	if (!transfer)
		return

	const report = await readFile(
		reportPath,
		"utf8",
	)

	await copyTextToClipboard(report)
	console.log("Copied report to the clipboard.")
}

async function copyTextToClipboard(value: string): Promise<void> {
	const commands = getClipboardCommands()

	for (const command of commands) {
		if (await tryClipboardCommand(
			command.command,
			command.args,
			value,
		))
			return
	}

	throw new Error("Could not find a supported clipboard command. Run without --transfer and use the generated report.md file.")
}

function getClipboardCommands(): readonly {
	command: string
	args: readonly string[]
}[] {
	switch (process.platform) {
		case "win32":
			return [
				{
					command: "clip.exe",
					args: [],
				},
				{
					command: "powershell.exe",
					args: [
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						"Set-Clipboard -Value ([Console]::In.ReadToEnd())",
					],
				},
				{
					command: "pwsh.exe",
					args: [
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						"Set-Clipboard -Value ([Console]::In.ReadToEnd())",
					],
				},
			]

		case "darwin":
			return [
				{
					command: "pbcopy",
					args: [],
				},
			]

		default:
			return [
				{
					command: "wl-copy",
					args: [],
				},
				{
					command: "xclip",
					args: [
						"-selection",
						"clipboard",
					],
				},
				{
					command: "xsel",
					args: [
						"--clipboard",
						"--input",
					],
				},
			]
	}
}

function tryClipboardCommand(
	command: string,
	args: readonly string[],
	input: string,
): Promise<boolean> {
	return new Promise(resolve => {
		const child = spawn(
			command,
			args,
			{
				stdio: [
					"pipe",
					"ignore",
					"ignore",
				],
			},
		)
		let settled = false

		const finish = (success: boolean): void => {
			if (settled)
				return

			settled = true
			resolve(success)
		}

		child.on(
			"error",
			() => finish(false),
		)
		child.on(
			"close",
			code => finish(code === 0),
		)
		child.stdin.end(input)
	})
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

	if (
		!Number.isSafeInteger(fileLimit) ||
		fileLimit < 1
	)
		throw new Error("The batch file limit must be a positive integer.")

	return fileLimit
}
