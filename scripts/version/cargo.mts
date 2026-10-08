import { PROJECT_ROOT } from "./config.mts"
import path from "node:path"

function packageSection(
	content: string,
	filePath: string,
): { start: number; end: number; section: string } {
	const packageHeader = "[package]"
	const start = content.indexOf(packageHeader)
	if (start < 0) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} does not contain a [package] section.`)
	}
	const followingSection = content.indexOf(
		"\n[",
		start + packageHeader.length,
	)
	const end = followingSection < 0 ?
		content.length :
		followingSection + 1
	return {
		start,
		end,
		section: content.slice(
			start,
			end,
		),
	}
}

export function replaceCargoPackageVersion(
	content: string,
	version: string,
	filePath: string,
): string {
	const { start, end, section } = packageSection(
		content,
		filePath,
	)
	const matches = section.match(/^version\s*=\s*"[^"]+"\s*$/gm) ?? []
	if (matches.length !== 1) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} must contain exactly one version in [package].`)
	}
	const next = section.replace(
		/^version\s*=\s*"[^"]+"\s*$/m,
		`version = "${version}"`,
	)
	return `${content.slice(
		0,
		start,
	)}${next}${content.slice(end)}`
}

export function getCargoPackageVersion(
	content: string,
	filePath: string,
): string {
	const { section } = packageSection(
		content,
		filePath,
	)
	const version = section.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
	if (!version) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} does not contain a valid version in [package].`)
	}
	return version
}

function findCargoLockPackageBlock(
	content: string,
	filePath: string,
): { start: number; end: number; block: string } {
	const headers = [...content.matchAll(/^\[\[package\]\]\s*$/gm)]
	const matches = headers.flatMap((header, index) => {
		const start = header.index ?? 0
		const end = headers[index + 1]?.index ?? content.length
		const block = content.slice(
			start,
			end,
		)
		return /^name\s*=\s*"orqeto-dev"\s*$/m.test(block) ?
			[{ start, end, block }] :
			[]
	})
	if (matches.length !== 1) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} must contain exactly one orqeto-dev package.`)
	}
	const match = matches[0]
	if (match === undefined) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} does not contain the orqeto-dev package.`)
	}
	return match
}

export function replaceCargoLockVersion(
	content: string,
	version: string,
	filePath: string,
): string {
	const { start, end, block } = findCargoLockPackageBlock(
		content,
		filePath,
	)
	const matches = block.match(/^version\s*=\s*"[^"]+"\s*$/gm) ?? []
	if (matches.length !== 1) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} must contain exactly one version in the orqeto-dev package.`)
	}
	const next = block.replace(
		/^version\s*=\s*"[^"]+"\s*$/m,
		`version = "${version}"`,
	)
	return `${content.slice(
		0,
		start,
	)}${next}${content.slice(end)}`
}

export function getCargoLockVersion(
	content: string,
	filePath: string,
): string {
	const { block } = findCargoLockPackageBlock(
		content,
		filePath,
	)
	const version = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
	if (!version) {
		throw new Error(`${path.relative(
			PROJECT_ROOT,
			filePath,
		)} does not contain a valid version in the orqeto-dev package.`)
	}
	return version
}
