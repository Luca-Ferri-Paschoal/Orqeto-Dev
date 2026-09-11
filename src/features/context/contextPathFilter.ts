import type {
	GeneratedFile,
	SkippedFile,
} from "./types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

export type ContextFilterTarget = "fileName" | "path"
export type ContextFilterMode = "contains" | "exact" | "regex"

export interface ContextFilter {
	pattern: string
	target: ContextFilterTarget
	mode: ContextFilterMode
}

export interface ContextFilterHistoryEntry extends ContextFilter {
	lastUsedAt: number
}

export function normalizeContextPathFilter(pattern: string): string {
	return pattern.trim()
}

export function getContextPathFilterError(
	filter: ContextFilter,
	locale: Locale,
): string | null {
	const normalizedPattern = normalizeContextPathFilter(filter.pattern)

	if (
		normalizedPattern.length === 0 ||
		filter.mode !== "regex"
	)
		return null

	try {
		new RegExp(normalizedPattern)
		return null
	} catch {
		return translate(
			locale,
			"context.filter.invalid",
		)
	}
}

export function filterContextFiles(
	files: readonly GeneratedFile[],
	filter: ContextFilter,
): GeneratedFile[] {
	const matcher = createMatcher(filter)

	if (matcher === null)
		return [...files]

	return files.filter(file => matcher(getFilterValue(
		file.relativePath,
		filter.target,
	)))
}

export function filterSkippedFiles(
	files: readonly SkippedFile[],
	filter: ContextFilter,
): SkippedFile[] {
	const matcher = createMatcher(filter)

	if (matcher === null)
		return [...files]

	return files.filter(file => matcher(getFilterValue(
		file.relativePath,
		filter.target,
	)))
}

function getFilterValue(
	relativePath: string,
	target: ContextFilterTarget,
): string {
	const normalizedPath = relativePath
		.replaceAll("\\", "/")
		.replace(/^\.\//, "")

	if (target === "path")
		return normalizedPath

	return normalizedPath
		.split("/")
		.at(-1) ?? normalizedPath
}

function createMatcher(filter: ContextFilter): ((value: string) => boolean) | null {
	const normalizedPattern = normalizeContextPathFilter(filter.pattern)

	if (normalizedPattern.length === 0)
		return null

	if (filter.mode === "regex") {
		const regex = new RegExp(normalizedPattern)

		return value => regex.test(value)
	}

	const terms = normalizedPattern
		.split("|")
		.map(term => term.trim().toLocaleLowerCase())
		.filter(term => term.length > 0)

	if (terms.length === 0)
		return null

	if (filter.mode === "exact")
		return value => terms.includes(value.toLocaleLowerCase())

	return value => {
		const normalizedValue = value.toLocaleLowerCase()
		return terms.some(term => normalizedValue.includes(term))
	}
}
