import {
	FORWARD_DELIVERY_TIMEOUT_MS,
	FORWARD_ONLY_ARG,
	FORWARD_ONLY_NO_PRIMARY_EXIT_CODE,
} from "./constants.js"
import {
	isPublishedProcessAlive,
	queryExecutablePath,
	queryRegistryIntegrationState,
} from "./state.js"
import { spawn } from "node:child_process"

export async function launchOrForwardToOrqeto(
	args: readonly string[],
	startIfClosed: boolean,
): Promise<boolean> {
	const executablePath = await queryExecutablePath()
	if (executablePath === null)
		return false
	if (!startIfClosed) {
		const state = await queryRegistryIntegrationState()
		if (!isPublishedProcessAlive(state))
			return false
	}

	const processArgs = startIfClosed ?
		[...args] :
		[FORWARD_ONLY_ARG, ...args]
	if (startIfClosed) {
		return new Promise(resolveLaunch => {
			const child = spawn(executablePath, processArgs, {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			})
			child.once(
				"error",
				() => resolveLaunch(false),
			)
			child.once("spawn", () => {
				child.unref()
				resolveLaunch(true)
			})
		})
	}

	return new Promise(resolveLaunch => {
		let settled = false
		const child = spawn(executablePath, processArgs, {
			detached: false,
			stdio: "ignore",
			windowsHide: true,
		})
		const finish = (delivered: boolean): void => {
			if (settled)
				return
			settled = true
			clearTimeout(timeout)
			resolveLaunch(delivered)
		}
		const timeout = setTimeout(() => {
			if (!settled)
				child.kill()
			finish(false)
		}, FORWARD_DELIVERY_TIMEOUT_MS)
		child.once(
			"error",
			() => finish(false),
		)
		child.once(
			"exit",
			code => finish(code !== FORWARD_ONLY_NO_PRIMARY_EXIT_CODE && code === 0),
		)
	})
}
