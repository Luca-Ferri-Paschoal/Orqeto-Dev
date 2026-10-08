import {
	EXECUTABLE_VALUE_NAME,
	INTEGRATION_STATE_VALUE_NAME,
	ORQETO_REGISTRY_KEY,
	REGISTRY_QUERY_TIMEOUT_MS,
} from "./constants.js"
import type { ExtensionLocale } from "./messages.js"
import { execFile } from "node:child_process"
import { access } from "node:fs/promises"

export interface IntegrationState {
	version: 2
	processId: number
	openProjectRoots: string[]
	contextProjectRoots: string[]
	busyProjectRoots: string[]
	ignoreProjectRoot: string | null
	hideOpenProjectSubfolders: boolean
	locale: ExtensionLocale
}

export const EMPTY_INTEGRATION_STATE: IntegrationState = {
	version: 2,
	processId: 0,
	openProjectRoots: [],
	contextProjectRoots: [],
	busyProjectRoots: [],
	ignoreProjectRoot: null,
	hideOpenProjectSubfolders: true,
	locale: "pt-BR",
}

let cachedExecutablePath: string | undefined

function queryRegistryValue(
	registryKey: string,
	valueName: string,
): Promise<string | null> {
	if (process.platform !== "win32")
		return Promise.resolve(null)

	return new Promise(resolveQuery => {
		execFile(
			"reg.exe",
			["query", registryKey, "/v", valueName],
			{
				encoding: "utf8",
				windowsHide: true,
				timeout: REGISTRY_QUERY_TIMEOUT_MS,
			},
			(error, stdout) => {
				if (error) {
					resolveQuery(null)
					return
				}
				const line = stdout.split(/\r?\n/).find(value => value.includes(valueName))
				if (line === undefined) {
					resolveQuery(null)
					return
				}
				const typeMarkerIndex = line.indexOf("REG_")
				if (typeMarkerIndex < 0) {
					resolveQuery(null)
					return
				}
				const typeAndValue = line.slice(typeMarkerIndex)
				const valueStart = typeAndValue.search(/\s+/)
				resolveQuery(valueStart < 0 ?
					null :
					typeAndValue.slice(valueStart).trim() || null)
			},
		)
	})
}

export async function queryRegistryIntegrationState(): Promise<IntegrationState> {
	const serialized = await queryRegistryValue(
		ORQETO_REGISTRY_KEY,
		INTEGRATION_STATE_VALUE_NAME,
	)
	if (serialized === null)
		return EMPTY_INTEGRATION_STATE

	try {
		const parsed: unknown = JSON.parse(serialized)
		if (
			typeof parsed !== "object" || parsed === null ||
			!("version" in parsed) || parsed.version !== 2 ||
			!("processId" in parsed) || typeof parsed.processId !== "number" || !Number.isSafeInteger(parsed.processId) || parsed.processId <= 0 ||
			!("openProjectRoots" in parsed) || !Array.isArray(parsed.openProjectRoots) || !parsed.openProjectRoots.every(root => typeof root === "string") ||
			!("contextProjectRoots" in parsed) || !Array.isArray(parsed.contextProjectRoots) || !parsed.contextProjectRoots.every(root => typeof root === "string") ||
			!("ignoreProjectRoot" in parsed) || !(parsed.ignoreProjectRoot === null || typeof parsed.ignoreProjectRoot === "string") ||
			!("hideOpenProjectSubfolders" in parsed) || typeof parsed.hideOpenProjectSubfolders !== "boolean"
		)
			return EMPTY_INTEGRATION_STATE

		const locale: ExtensionLocale = "locale" in parsed && parsed.locale === "en" ?
			"en" :
			"pt-BR"
		const busyProjectRoots = "busyProjectRoots" in parsed && Array.isArray(parsed.busyProjectRoots) && parsed.busyProjectRoots.every(root => typeof root === "string") ?
			parsed.busyProjectRoots :
			[]
		return {
			version: 2,
			processId: parsed.processId,
			openProjectRoots: parsed.openProjectRoots,
			contextProjectRoots: parsed.contextProjectRoots,
			busyProjectRoots,
			ignoreProjectRoot: parsed.ignoreProjectRoot,
			hideOpenProjectSubfolders: parsed.hideOpenProjectSubfolders,
			locale,
		}
	} catch {
		return EMPTY_INTEGRATION_STATE
	}
}

export function isPublishedProcessAlive(state: IntegrationState): boolean {
	if (state.processId <= 0)
		return false
	try {
		process.kill(
			state.processId,
			0,
		)
		return true
	} catch {
		return false
	}
}

export async function queryExecutablePath(): Promise<string | null> {
	const executablePath = cachedExecutablePath ?? await queryRegistryValue(
		ORQETO_REGISTRY_KEY,
		EXECUTABLE_VALUE_NAME,
	)
	if (executablePath === null)
		return null
	cachedExecutablePath = executablePath
	try {
		await access(executablePath)
	} catch {
		cachedExecutablePath = undefined
		return null
	}
	return executablePath
}
