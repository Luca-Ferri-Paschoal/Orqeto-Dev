import type {
	GeneratedFile,
	WorkMode,
} from "./types"
import {
	type Locale,
	translate,
} from "@/infra/i18n"

interface TreeFile {
	name: string
	file: GeneratedFile
}

interface DirectoryNode {
	files: TreeFile[]
	directories: Map<string, DirectoryNode>
}

interface CompressedDirectory {
	path: string
	node: DirectoryNode
}

function normalizeFileContent(content: string): string {
	return content.endsWith("\n") ?
		content :
		`${content}\n`
}

function createDirectoryNode(): DirectoryNode {
	return {
		files: [],
		directories: new Map<string, DirectoryNode>(),
	}
}

function getOrCreateDirectory(
	node: DirectoryNode,
	name: string,
): DirectoryNode {
	const existingDirectory = node.directories.get(name)

	if (existingDirectory !== undefined)
		return existingDirectory

	const directory = createDirectoryNode()

	node.directories.set(
		name,
		directory,
	)

	return directory
}

function getRelativePathParts(relativePath: string): string[] {
	return relativePath
		.replaceAll(
			"\\",
			"/",
		)
		.replace(
			/^\.\//,
			"",
		)
		.split("/")
		.filter(part => part.length > 0)
}

function buildDirectoryTree(files: readonly GeneratedFile[]): DirectoryNode {
	const root = createDirectoryNode()

	for (const file of files) {
		const parts = getRelativePathParts(file.relativePath)
		const fileName = parts.at(-1)

		if (fileName === undefined)
			continue

		let currentDirectory = root

		for (const directoryName of parts.slice(
			0,
			-1,
		)) {
			currentDirectory = getOrCreateDirectory(
				currentDirectory,
				directoryName,
			)
		}

		currentDirectory.files.push({
			name: fileName,
			file,
		})
	}

	return root
}

function getSortedDirectories(node: DirectoryNode): [string, DirectoryNode][] {
	return [...node.directories.entries()].sort((
		[leftName],
		[rightName],
	) => leftName.localeCompare(rightName))
}

function getCompressedDirectory(
	name: string,
	node: DirectoryNode,
): CompressedDirectory {
	const pathParts = [name]
	let currentNode = node

	while (
		currentNode.files.length === 0 &&
		currentNode.directories.size === 1
	) {
		const nextDirectory = getSortedDirectories(currentNode)[0]

		if (nextDirectory === undefined)
			break

		pathParts.push(nextDirectory[0])
		currentNode = nextDirectory[1]
	}

	return {
		path: pathParts.join("/"),
		node: currentNode,
	}
}

function formatFile(
	name: string,
	content: string | null,
	locale: Locale,
): string {
	const fileMarker = `===== ${translate(
		locale,
		"protocol.file",
	)}: ${name} =====`

	if (content === null)
		return fileMarker

	return [
		fileMarker,
		`===== ${translate(
			locale,
			"protocol.contentStart",
		)} =====`,
		normalizeFileContent(content) +
		`===== ${translate(
			locale,
			"protocol.contentEnd",
		)} =====`,
	].join("\n")
}

function appendDirectoryContent(
	node: DirectoryNode,
	blocks: string[],
	isRoot: boolean,
	locale: Locale,
): void {
	const sortedFiles = [...node.files].sort((
		left,
		right,
	) => left.name.localeCompare(right.name))

	for (const treeFile of sortedFiles) {
		blocks.push(formatFile(
			treeFile.name,
			treeFile.file.content,
			locale,
		))
	}

	for (const [directoryName, directoryNode] of getSortedDirectories(node)) {
		const compressedDirectory = getCompressedDirectory(
			directoryName,
			directoryNode,
		)
		const nestedDirectories = getSortedDirectories(compressedDirectory.node)

		if (
			compressedDirectory.node.files.length === 1 &&
			nestedDirectories.length === 0
		) {
			const treeFile = compressedDirectory.node.files[0]

			if (treeFile !== undefined) {
				const relativeFileName = `${compressedDirectory.path}/${treeFile.name}`

				blocks.push(formatFile(
					isRoot ?
						`./${relativeFileName}` :
						relativeFileName,
					treeFile.file.content,
					locale,
				))
			}

			continue
		}

		blocks.push(`===== ${translate(
			locale,
			"protocol.folder",
		)}: ${isRoot ?
			`./${compressedDirectory.path}` :
			compressedDirectory.path} =====`)

		appendDirectoryContent(
			compressedDirectory.node,
			blocks,
			false,
			locale,
		)

		blocks.push(`===== ${translate(
			locale,
			"protocol.back",
		)} =====`)
	}
}

function getProtocolHeader(
	locale: Locale,
	workMode: WorkMode,
): string {
	const modeInstructions = workMode === "git" ?
		[
			translate(
				locale,
				"protocol.workModeGit",
			),
			translate(
				locale,
				"protocol.gitPatchInstruction",
			),
			translate(
				locale,
				"protocol.gitPatchSafety",
			),
		] :
		[
			translate(
				locale,
				"protocol.workModeFiles",
			),
			translate(
				locale,
				"protocol.filesPatchInstruction",
			),
			translate(
				locale,
				"protocol.deleteManifestDescription",
			),
			translate(
				locale,
				"protocol.deleteManifestFormat",
			),
			translate(
				locale,
				"protocol.deleteManifestPaths",
			),
			translate(
				locale,
				"protocol.deleteManifestOptional",
			),
		]

	return [
		translate(
			locale,
			"protocol.header",
		),
		translate(
			locale,
			"protocol.label",
		),
		...modeInstructions,
		translate(
			locale,
			"protocol.rootDescription",
		),
		translate(
			locale,
			"protocol.folderDescription",
		),
		translate(
			locale,
			"protocol.backDescription",
		),
		translate(
			locale,
			"protocol.fileDescription",
		),
		translate(
			locale,
			"protocol.contentDescription",
		),
		translate(
			locale,
			"protocol.pathOnlyDescription",
		),
		`===== ${translate(
			locale,
			"protocol.root",
		)}: ./ =====`,
	].join("\n")
}

export function formatGeneratedContent(
	files: readonly GeneratedFile[],
	locale: Locale,
	workMode: WorkMode,
): string {
	if (files.length === 0)
		return ""

	const blocks = [getProtocolHeader(
		locale,
		workMode,
	)]
	const tree = buildDirectoryTree(files)

	appendDirectoryContent(
		tree,
		blocks,
		true,
		locale,
	)

	blocks.push(translate(
		locale,
		"protocol.end",
	))

	return `${blocks.join("\n\n")}\n`
}

export function getGeneratedContentByteCount(content: string): number {
	return new TextEncoder().encode(content).length
}

export function formatByteSize(bytes: number): string {
	if (bytes < 1024)
		return `${bytes} B`

	const kilobytes = bytes / 1024

	if (kilobytes < 1024)
		return `${kilobytes.toFixed(1)} KB`

	return `${(kilobytes / 1024).toFixed(1)} MB`
}

export function getGeneratedContentSize(content: string): string {
	return formatByteSize(getGeneratedContentByteCount(content))
}
