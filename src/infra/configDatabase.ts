import type {
	ContextFilterHistoryEntry,
	ContextFilterMode,
	ContextFilterTarget,
} from "@/features/context/contextPathFilter"
import {
	type AppSettings,
	type AppTheme,
	type ContextHistoryEntry,
	DEFAULT_APP_THEME,
	DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
	DEFAULT_CONTEXT_HISTORY_LIMIT,
	DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
	HISTORY_LIMIT_MAX,
	HISTORY_LIMIT_MIN,
	type ProjectSection,
	type ProjectTab,
} from "@/features/context/types"
import {
	isLocale,
	type Locale,
} from "@/infra/i18n"
import Database from "@tauri-apps/plugin-sql"

interface SettingRow {
	key: string
	value: string
}

interface ProjectTabRow {
	id: string
	rootFolder: string | null
	position: number
	folderSectionExpanded: number
	contextSectionExpanded: number
	applySectionExpanded: number
}

interface ContextFilterHistoryRow {
	pattern: string
	target: string
	mode: string
	lastUsedAt: number
}

interface ContextHistoryRow {
	id: number
	content: string
	fileCount: number
	byteCount: number
	createdAt: number
}

const DATABASE_URL = "sqlite:orqeto-dev.db"

const settingKeys = {
	activeProjectTabId: "active_project_tab_id",
	locale: "locale",
	theme: "theme",
	autoCopyContextAfterAdd: "auto_copy_context_after_add",
	autoClearAfterExport: "auto_clear_after_export",
	contextFilterHistoryLimit: "context_filter_history_limit",
	contextHistoryLimit: "context_history_limit",
	overlayUndoHistoryLimit: "overlay_undo_history_limit",
	openExplorerOnAppStart: "open_explorer_on_app_start",
	openExplorerOnProjectOpen: "open_explorer_on_project_open",
	closeExplorerOnFolderClose: "close_explorer_on_folder_close",
	closeExplorerOnAppExit: "close_explorer_on_app_exit",
} as const

let databasePromise: Promise<Database> | undefined

async function getDatabase(): Promise<Database> {
	databasePromise ??= Database.load(DATABASE_URL)

	return databasePromise
}

function isContextFilterTarget(value: string): value is ContextFilterTarget {
	return value === "fileName" || value === "path"
}

function isContextFilterMode(value: string): value is ContextFilterMode {
	return value === "contains" || value === "exact" || value === "regex"
}

function parseHistoryLimit(
	value: string,
	fallback: number,
): number {
	const parsed = Number.parseInt(
		value,
		10,
	)

	return Number.isInteger(parsed) &&
		parsed >= HISTORY_LIMIT_MIN &&
		parsed <= HISTORY_LIMIT_MAX ?
		parsed :
		fallback
}

function validateHistoryLimit(limit: number): void {
	if (
		!Number.isInteger(limit) ||
		limit < HISTORY_LIMIT_MIN ||
		limit > HISTORY_LIMIT_MAX
	)
		throw new Error(`O limite de histórico deve ficar entre ${HISTORY_LIMIT_MIN} e ${HISTORY_LIMIT_MAX}.`)
}

export async function getAppSettings(): Promise<AppSettings> {
	const database = await getDatabase()
	const rows = await database.select<SettingRow[]>(
		"SELECT key, value FROM app_settings WHERE key IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
		[
			settingKeys.locale,
			settingKeys.theme,
			settingKeys.autoCopyContextAfterAdd,
			settingKeys.autoClearAfterExport,
			settingKeys.contextFilterHistoryLimit,
			settingKeys.contextHistoryLimit,
			settingKeys.overlayUndoHistoryLimit,
			settingKeys.openExplorerOnAppStart,
			settingKeys.openExplorerOnProjectOpen,
			settingKeys.closeExplorerOnFolderClose,
			settingKeys.closeExplorerOnAppExit,
		],
	)

	let locale: Locale = "pt-BR"
	let theme: AppTheme = DEFAULT_APP_THEME
	let autoCopyContextAfterAdd = false
	let autoClearAfterExport = false
	let contextFilterHistoryLimit = DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT
	let contextHistoryLimit = DEFAULT_CONTEXT_HISTORY_LIMIT
	let overlayUndoHistoryLimit = DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT
	let openExplorerOnAppStart = true
	let openExplorerOnProjectOpen = true
	let closeExplorerOnFolderClose = false
	let closeExplorerOnAppExit = false

	for (const row of rows) {
		if (row.key === settingKeys.locale) {
			if (isLocale(row.value))
				locale = row.value

			continue
		}

		if (row.key === settingKeys.theme) {
			if (row.value === "light" || row.value === "dark")
				theme = row.value

			continue
		}

		if (row.key === settingKeys.autoCopyContextAfterAdd) {
			autoCopyContextAfterAdd = row.value === "1"
			continue
		}

		if (row.key === settingKeys.autoClearAfterExport) {
			autoClearAfterExport = row.value === "1"
			continue
		}

		if (row.key === settingKeys.contextFilterHistoryLimit) {
			contextFilterHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_CONTEXT_FILTER_HISTORY_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.contextHistoryLimit) {
			contextHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_CONTEXT_HISTORY_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.overlayUndoHistoryLimit) {
			overlayUndoHistoryLimit = parseHistoryLimit(
				row.value,
				DEFAULT_OVERLAY_UNDO_HISTORY_LIMIT,
			)
			continue
		}

		if (row.key === settingKeys.openExplorerOnAppStart) {
			openExplorerOnAppStart = row.value === "1"
			continue
		}

		if (row.key === settingKeys.openExplorerOnProjectOpen) {
			openExplorerOnProjectOpen = row.value === "1"
			continue
		}

		if (row.key === settingKeys.closeExplorerOnFolderClose) {
			closeExplorerOnFolderClose = row.value === "1"
			continue
		}

		if (row.key === settingKeys.closeExplorerOnAppExit)
			closeExplorerOnAppExit = row.value === "1"
	}

	return {
		locale,
		theme,
		autoCopyContextAfterAdd,
		autoClearAfterExport,
		contextFilterHistoryLimit,
		contextHistoryLimit,
		overlayUndoHistoryLimit,
		openExplorerOnAppStart,
		openExplorerOnProjectOpen,
		closeExplorerOnFolderClose,
		closeExplorerOnAppExit,
	}
}

export async function getProjectTabs(): Promise<ProjectTab[]> {
	const database = await getDatabase()
	const rows = await database.select<ProjectTabRow[]>(`
			SELECT
				id,
				root_folder AS rootFolder,
				position,
				folder_section_expanded AS folderSectionExpanded,
				context_section_expanded AS contextSectionExpanded,
				apply_section_expanded AS applySectionExpanded
			FROM project_tabs
			ORDER BY position ASC, id ASC
		`)

	return rows.map(row => ({
		id: row.id,
		rootFolder: row.rootFolder,
		folderSectionExpanded: row.folderSectionExpanded !== 0,
		contextSectionExpanded: row.contextSectionExpanded !== 0,
		applySectionExpanded: row.applySectionExpanded !== 0,
	}))
}

export async function getActiveProjectTabId(): Promise<string | null> {
	const database = await getDatabase()
	const rows = await database.select<SettingRow[]>(
		"SELECT key, value FROM app_settings WHERE key = $1",
		[settingKeys.activeProjectTabId],
	)

	return rows[0]?.value ?? null
}

export async function upsertProjectTab(
	tab: ProjectTab,
	position: number,
): Promise<void> {
	const database = await getDatabase()

	await database.execute(
		`
			INSERT INTO project_tabs (
				id,
				root_folder,
				position,
				folder_section_expanded,
				context_section_expanded,
				apply_section_expanded
			)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT(id) DO UPDATE SET
				root_folder = excluded.root_folder,
				position = excluded.position,
				folder_section_expanded = excluded.folder_section_expanded,
				context_section_expanded = excluded.context_section_expanded,
				apply_section_expanded = excluded.apply_section_expanded
		`,
		[
			tab.id,
			tab.rootFolder,
			position,
			tab.folderSectionExpanded ?
				1 :
				0,
			tab.contextSectionExpanded ?
				1 :
				0,
			tab.applySectionExpanded ?
				1 :
				0,
		],
	)
}

export async function deleteProjectTab(id: string): Promise<void> {
	const database = await getDatabase()

	await database.execute(
		"DELETE FROM project_tabs WHERE id = $1",
		[id],
	)
}

export async function saveProjectTabOrder(ids: readonly string[]): Promise<void> {
	const database = await getDatabase()

	for (const [position, id] of ids.entries()) {
		await database.execute(
			"UPDATE project_tabs SET position = $1 WHERE id = $2",
			[
				position,
				id,
			],
		)
	}
}

export async function setProjectTabSectionExpanded(
	id: string,
	section: ProjectSection,
	expanded: boolean,
): Promise<void> {
	const database = await getDatabase()
	const column = section === "folder" ?
		"folder_section_expanded" :
		section === "context" ?
			"context_section_expanded" :
			"apply_section_expanded"

	await database.execute(
		`UPDATE project_tabs SET ${column} = $1 WHERE id = $2`,
		[
			expanded ?
				1 :
				0,
			id,
		],
	)
}

export async function setActiveProjectTabId(id: string): Promise<void> {
	await setSetting(
		settingKeys.activeProjectTabId,
		id,
	)
}

export async function getContextFilterHistory(
	rootFolder: string,
	limit: number,
): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)

	const database = await getDatabase()
	const rows = await database.select<ContextFilterHistoryRow[]>(
		`
			SELECT pattern, target, mode, last_used_at AS lastUsedAt
			FROM context_filter_history
			WHERE root_folder = $1
			ORDER BY last_used_at DESC
			LIMIT $2
		`,
		[
			rootFolder,
			limit,
		],
	)

	return rows.flatMap(row => {
		if (
			!isContextFilterTarget(row.target) ||
			!isContextFilterMode(row.mode)
		)
			return []

		return [{
			pattern: row.pattern,
			target: row.target,
			mode: row.mode,
			lastUsedAt: row.lastUsedAt,
		}]
	})
}

async function trimContextFilterHistory(limit: number): Promise<void> {
	validateHistoryLimit(limit)

	const database = await getDatabase()

	await database.execute(
		`
			DELETE FROM context_filter_history
			WHERE rowid IN (
				SELECT rowid
				FROM (
					SELECT
						rowid,
						ROW_NUMBER() OVER (
							PARTITION BY root_folder
							ORDER BY last_used_at DESC, rowid DESC
						) AS history_position
					FROM context_filter_history
				)
				WHERE history_position > $1
			)
		`,
		[limit],
	)
}

export async function saveContextFilterHistoryEntry(
	rootFolder: string,
	entry: ContextFilterHistoryEntry,
	limit: number,
): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)

	const database = await getDatabase()

	await database.execute(
		`
			INSERT INTO context_filter_history (
				root_folder,
				pattern,
				target,
				mode,
				last_used_at
			)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT(root_folder, pattern, target, mode)
			DO UPDATE SET last_used_at = excluded.last_used_at
		`,
		[
			rootFolder,
			entry.pattern,
			entry.target,
			entry.mode,
			entry.lastUsedAt,
		],
	)

	await database.execute(
		`
			DELETE FROM context_filter_history
			WHERE root_folder = $1
				AND rowid NOT IN (
					SELECT rowid
					FROM context_filter_history
					WHERE root_folder = $1
					ORDER BY last_used_at DESC, rowid DESC
					LIMIT $2
				)
		`,
		[
			rootFolder,
			limit,
		],
	)

	return getContextFilterHistory(
		rootFolder,
		limit,
	)
}

export async function deleteContextFilterHistoryEntry(
	rootFolder: string,
	entry: ContextFilterHistoryEntry,
	limit: number,
): Promise<ContextFilterHistoryEntry[]> {
	validateHistoryLimit(limit)

	const database = await getDatabase()

	await database.execute(
		`
			DELETE FROM context_filter_history
			WHERE root_folder = $1
				AND pattern = $2
				AND target = $3
				AND mode = $4
		`,
		[
			rootFolder,
			entry.pattern,
			entry.target,
			entry.mode,
		],
	)

	return getContextFilterHistory(
		rootFolder,
		limit,
	)
}

export async function getContextHistory(
	rootFolder: string,
	limit: number,
): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)

	const database = await getDatabase()
	return database.select<ContextHistoryRow[]>(
		`
			SELECT
				id,
				content,
				file_count AS fileCount,
				byte_count AS byteCount,
				created_at AS createdAt
			FROM context_export_history
			WHERE root_folder = $1
			ORDER BY created_at DESC, id DESC
			LIMIT $2
		`,
		[
			rootFolder,
			limit,
		],
	)
}

async function trimContextHistory(limit: number): Promise<void> {
	validateHistoryLimit(limit)

	const database = await getDatabase()

	await database.execute(
		`
			DELETE FROM context_export_history
			WHERE id IN (
				SELECT id
				FROM (
					SELECT
						id,
						ROW_NUMBER() OVER (
							PARTITION BY root_folder
							ORDER BY created_at DESC, id DESC
						) AS history_position
					FROM context_export_history
				)
				WHERE history_position > $1
			)
		`,
		[limit],
	)
}

export async function saveContextHistoryEntry(
	rootFolder: string,
	entry: Omit<ContextHistoryEntry, "id">,
	limit: number,
): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)

	const database = await getDatabase()

	await database.execute(
		`
			INSERT INTO context_export_history (
				root_folder,
				content,
				file_count,
				byte_count,
				created_at
			)
			VALUES ($1, $2, $3, $4, $5)
		`,
		[
			rootFolder,
			entry.content,
			entry.fileCount,
			entry.byteCount,
			entry.createdAt,
		],
	)

	await database.execute(
		`
			DELETE FROM context_export_history
			WHERE root_folder = $1
				AND id NOT IN (
					SELECT id
					FROM context_export_history
					WHERE root_folder = $1
					ORDER BY created_at DESC, id DESC
					LIMIT $2
				)
		`,
		[
			rootFolder,
			limit,
		],
	)

	return getContextHistory(
		rootFolder,
		limit,
	)
}

export async function deleteContextHistoryEntry(
	rootFolder: string,
	id: number,
	limit: number,
): Promise<ContextHistoryEntry[]> {
	validateHistoryLimit(limit)

	const database = await getDatabase()

	await database.execute(
		`
			DELETE FROM context_export_history
			WHERE root_folder = $1
				AND id = $2
		`,
		[
			rootFolder,
			id,
		],
	)

	return getContextHistory(
		rootFolder,
		limit,
	)
}

async function setSetting(
	key: string,
	value: string,
): Promise<void> {
	const database = await getDatabase()

	await database.execute(
		`
			INSERT INTO app_settings (key, value)
			VALUES ($1, $2)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`,
		[
			key,
			value,
		],
	)
}

export async function setLocaleSetting(locale: Locale): Promise<void> {
	await setSetting(
		settingKeys.locale,
		locale,
	)
}

export async function setThemeSetting(theme: AppTheme): Promise<void> {
	await setSetting(
		settingKeys.theme,
		theme,
	)
}

export async function setAutoCopyContextAfterAddSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.autoCopyContextAfterAdd,
		enabled ?
			"1" :
			"0",
	)
}

export async function setAutoClearAfterExportSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.autoClearAfterExport,
		enabled ?
			"1" :
			"0",
	)
}

export async function setContextFilterHistoryLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.contextFilterHistoryLimit,
		String(limit),
	)
	await trimContextFilterHistory(limit)
}

export async function setContextHistoryLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.contextHistoryLimit,
		String(limit),
	)
	await trimContextHistory(limit)
}

export async function setOverlayUndoHistoryLimitSetting(limit: number): Promise<void> {
	validateHistoryLimit(limit)
	await setSetting(
		settingKeys.overlayUndoHistoryLimit,
		String(limit),
	)
}

export async function setOpenExplorerOnAppStartSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.openExplorerOnAppStart,
		enabled ?
			"1" :
			"0",
	)
}

export async function setOpenExplorerOnProjectOpenSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.openExplorerOnProjectOpen,
		enabled ?
			"1" :
			"0",
	)
}

export async function setCloseExplorerOnFolderCloseSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.closeExplorerOnFolderClose,
		enabled ?
			"1" :
			"0",
	)
}

export async function setCloseExplorerOnAppExitSetting(enabled: boolean): Promise<void> {
	await setSetting(
		settingKeys.closeExplorerOnAppExit,
		enabled ?
			"1" :
			"0",
	)
}
