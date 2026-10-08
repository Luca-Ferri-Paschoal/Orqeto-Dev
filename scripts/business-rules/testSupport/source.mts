import {
	readdir,
	readFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(
	scriptDirectory,
	"..",
	"..",
	"..",
)

interface CompositeSource {
	directory: string
	extensions: string[]
	exclude?: string[]
}

async function readModuleParts(
	directory: string,
	extensions: string[],
	exclude: ReadonlySet<string>,
	baseDirectory = directory,
): Promise<string> {
	const entries = await readdir(
		directory,
		{ withFileTypes: true },
	)
	const chunks = await Promise.all(entries
		.sort((
			left,
			right,
		) => left.name.localeCompare(right.name))
		.map(async entry => {
			const entryPath = path.join(
				directory,
				entry.name,
			)
			if (entry.isDirectory()) {
				return readModuleParts(
					entryPath,
					extensions,
					exclude,
					baseDirectory,
				)
			}
			if (!extensions.some(extension => entry.name.endsWith(extension)))
				return ""
			const relativePath = path.relative(
				baseDirectory,
				entryPath,
			).replaceAll(
				"\\",
				"/",
			)
			if (exclude.has(relativePath))
				return ""
			return readFile(
				entryPath,
				"utf8",
			)
		}))
	return chunks.join("\n")
}

export async function readProjectFile(relativePath: string): Promise<string> {
	const projectPath = path.join(
		rootDirectory,
		relativePath,
	)
	const content = await readFile(
		projectPath,
		"utf8",
	)
	const compositeDirectories = new Map<string, CompositeSource>([
		["src-tauri/src/overlay.rs", { directory: "src-tauri/src/overlay", extensions: [".rs"] }],
		["src-tauri/src/lib.rs", { directory: "src-tauri/src/lib", extensions: [".rs"] }],
		["src-tauri/src/diagnostics.rs", { directory: "src-tauri/src/diagnostics", extensions: [".rs"] }],
		["src-tauri/src/git_context.rs", { directory: "src-tauri/src/git_context", extensions: [".rs"] }],
		["src-tauri/src/storage.rs", { directory: "src-tauri/src/storage", extensions: [".rs"] }],
		["src-tauri/src/safe_fs.rs", { directory: "src-tauri/src/safe_fs", extensions: [".rs"] }],
		["src-tauri/src/config_database.rs", { directory: "src-tauri/src/config_database", extensions: [".rs"] }],
		["src-tauri/src/project_ignore.rs", { directory: "src-tauri/src/project_ignore", extensions: [".rs"] }],
		["src-tauri/src/external_integration.rs", { directory: "src-tauri/src/external_integration", extensions: [".rs"] }],
		["src-tauri/src/resource_limits.rs", { directory: "src-tauri/src/resource_limits", extensions: [".rs"] }],
		["src-tauri/src/project_logs.rs", { directory: "src-tauri/src/project_logs", extensions: [".rs"] }],
		["src/features/context/components/FolderSettings/index.tsx", {
			directory: "src/features/context/components/FolderSettings",
			extensions: [".ts", ".tsx"],
			exclude: ["index.tsx"],
		}],
		["src/features/context/components/ProjectWorkspacePane/index.tsx", {
			directory: "src/features/context/components/ProjectWorkspacePane",
			extensions: [".ts", ".tsx"],
			exclude: ["index.tsx"],
		}],
		["src/features/context/components/ProjectTabs/index.tsx", {
			directory: "src/features/context/components/ProjectTabs",
			extensions: [".ts", ".tsx"],
			exclude: ["index.tsx"],
		}],
		["src/features/context/components/SettingsDrawer/index.tsx", {
			directory: "src/features/context/components/SettingsDrawer",
			extensions: [".ts", ".tsx"],
			exclude: ["index.tsx"],
		}],
		["src/features/context/components/SettingsDrawer/style.ts", { directory: "src/features/context/components/SettingsDrawer/style", extensions: [".ts"] }],
		["src/features/context/components/DropZone/index.tsx", {
			directory: "src/features/context/components/DropZone",
			extensions: [".ts", ".tsx"],
			exclude: ["index.tsx"],
		}],
		["src/features/context/components/ApplyDropZone/index.tsx", { directory: "src/features/context/components/ApplyDropZone", extensions: [".ts", ".tsx"], exclude: ["index.tsx"] }],
		["src/features/context/components/DropZone/style.ts", { directory: "src/features/context/components/DropZone/style", extensions: [".ts"] }],
		["src/shared/components/OverlayScrollbarManager/index.tsx", {
			directory: "src/shared/components/OverlayScrollbarManager",
			extensions: [".ts", ".tsx"],
			exclude: ["index.tsx"],
		}],
		["src/features/context/useContextWorkspace.ts", { directory: "src/features/context/workspace", extensions: [".ts", ".tsx"] }],
		["src/features/context/operationOutcome.ts", { directory: "src/features/context/operationOutcome", extensions: [".ts"] }],
		["src/App/index.tsx", { directory: "src/App", extensions: [".ts", ".tsx"], exclude: ["index.tsx"] }],
		["integrations/vscode/src/extension.ts", { directory: "integrations/vscode/src/extension", extensions: [".ts"] }],
		["src/infra/configDatabase.ts", { directory: "src/infra/configDatabase", extensions: [".ts"] }],
		["src/infra/desktop.ts", { directory: "src/infra/desktop", extensions: [".ts"] }],
		["src/infra/i18n/locales/pt-BR.ts", { directory: "src/infra/i18n/locales/ptBR", extensions: [".ts"] }],
		["src/infra/i18n/locales/en.ts", { directory: "src/infra/i18n/locales/en", extensions: [".ts"] }],
	])
	const composite = compositeDirectories.get(relativePath)
	if (composite === undefined)
		return content

	return `${content}\n${await readModuleParts(
		path.join(
			rootDirectory,
			composite.directory,
		),
		composite.extensions,
		new Set(composite.exclude ?? []),
	)}`
}
