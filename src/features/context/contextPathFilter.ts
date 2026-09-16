import type {
	ContextSelectionFile,
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

const MAX_SAFE_REGEX_PATTERN_LENGTH = 1_024

interface RegexGroupState {
	hasBacktrackingConstruct: boolean
}

function isQuantifierStart(value: string | undefined): boolean {
	return value === "*" || value === "+" || value === "?" || value === "{"
}

function isSafeContextRegex(pattern: string): boolean {
	if (pattern.length > MAX_SAFE_REGEX_PATTERN_LENGTH)
		return false

	const groups: RegexGroupState[] = []
	let inCharacterClass = false

	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index]

		if (character === "\\") {
			const escaped = pattern[index + 1]

			if (escaped !== undefined && /[1-9]/.test(escaped))
				return false

			index += 1
			continue
		}

		if (inCharacterClass) {
			if (character === "]")
				inCharacterClass = false
			continue
		}

		if (character === "[") {
			inCharacterClass = true
			continue
		}

		if (character === "(") {
			if (pattern[index + 1] === "?") {
				if (pattern[index + 2] !== ":")
					return false

				index += 2
			}

			groups.push({ hasBacktrackingConstruct: false })
			continue
		}

		if (character === "|") {
			const current = groups.at(-1)

			if (current !== undefined)
				current.hasBacktrackingConstruct = true
			continue
		}

		if (character === ")") {
			const completed = groups.pop()

			if (completed === undefined)
				continue

			const quantified = isQuantifierStart(pattern[index + 1])

			if (quantified && completed.hasBacktrackingConstruct)
				return false

			const parent = groups.at(-1)

			if (parent !== undefined && (quantified || completed.hasBacktrackingConstruct))
				parent.hasBacktrackingConstruct = true
			continue
		}

		if (isQuantifierStart(character)) {
			const current = groups.at(-1)

			if (current !== undefined)
				current.hasBacktrackingConstruct = true
		}
	}

	return !inCharacterClass && groups.length === 0
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

	if (!isSafeContextRegex(normalizedPattern)) {
		return translate(
			locale,
			"context.filter.unsafeRegex",
		)
	}

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

export function filterContextFiles<TFile extends ContextSelectionFile>(
	files: readonly TFile[],
	filter: ContextFilter,
): TFile[] {
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
		if (!isSafeContextRegex(normalizedPattern))
			return null

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
