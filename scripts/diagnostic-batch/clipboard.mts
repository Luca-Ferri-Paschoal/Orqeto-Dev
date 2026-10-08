import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"

interface ClipboardCommand {
	command: string
	args: readonly string[]
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
	for (const command of getClipboardCommands()) {
		if (await tryClipboardCommand(
			command,
			value,
		))
			return
	}

	throw new Error("Could not find a supported clipboard command. Run without --transfer and use the generated report.md file.")
}

function getClipboardCommands(): readonly ClipboardCommand[] {
	switch (process.platform) {
		case "win32":
			return [
				{ command: "clip.exe", args: [] },
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
			return [{ command: "pbcopy", args: [] }]
		default:
			return [
				{ command: "wl-copy", args: [] },
				{ command: "xclip", args: ["-selection", "clipboard"] },
				{ command: "xsel", args: ["--clipboard", "--input"] },
			]
	}
}

function tryClipboardCommand(
	clipboardCommand: ClipboardCommand,
	input: string,
): Promise<boolean> {
	return new Promise(resolve => {
		const child = spawn(
			clipboardCommand.command,
			clipboardCommand.args,
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
