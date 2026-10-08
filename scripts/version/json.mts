import { PROJECT_ROOT } from "./config.mts"
import path from "node:path"

export interface JsonObject {
	[key: string]: unknown
}

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseJsonObject(
	content: string,
	filePath: string,
): JsonObject {
	const parsed: unknown = JSON.parse(content)
	if (!isJsonObject(parsed)) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} must contain a JSON object.`)
	}
	return parsed
}

export function stringifyJson(value: JsonObject): string {
	return `${JSON.stringify(
		value,
		null,
		"\t",
	)}\n`
}

export function getStringProperty(
	object: JsonObject,
	property: string,
	filePath: string,
): string {
	const value = object[property]
	if (typeof value !== "string") {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} does not contain ${property} as a string.`)
	}
	return value
}
