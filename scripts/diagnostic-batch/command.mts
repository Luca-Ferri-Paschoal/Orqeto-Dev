import type { CommandExecutionResult } from "./model.mts"
import { rootDirectory } from "./model.mts"
import { spawn } from "node:child_process"

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
