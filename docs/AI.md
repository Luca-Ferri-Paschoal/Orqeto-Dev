# AI.md — Orqeto Dev

This file is the persistent technical context for AI-assisted maintenance of Orqeto Dev.

Canonical location: `docs/AI.md`.

The current repository code is always the source of truth. Before changing any behavior, read the current files involved. Do not assume that previous patches, conversations, or older versions accurately represent the current state.

Prefer minimal, localized changes, preserve existing functionality, and avoid refactors unrelated to the current request.

When generating patches for sharing, prefer incremental ZIP archives containing only new or changed files while preserving relative paths. If existing files are deleted or renamed, use the `.orqeto-dev-delete.json` manifest described in this document.

## 1. Identity and architecture

Current identity:

- product/UI: `Orqeto Dev`;
- root npm/package: `orqeto-dev`;
- Tauri identifier: `com.orqeto.dev`;
- SQLite database: `orqeto-dev.db`;
- VS Code extension: `orqeto-dev-vscode`;
- Windows Registry: `HKCU\\Software\\Orqeto\\Orqeto Dev`;
- project ignore file: `.orqeto-devignore`.

Extension commands:

- `orqetoDev.sendToContext`;
- `orqetoDev.removeFromContext`;
- `orqetoDev.openFolder`.

Do not reintroduce old naming such as Orqeto Context, `orqeto-context`, `orqetoContext`, `OrqetoContext`, `ORQETO_CONTEXT`, `com.orqeto.context`, or `.orqeto-contextignore`.

Main stack:

- Tauri v2;
- Rust;
- React;
- strict TypeScript;
- Vite;
- Tailwind CSS v4;
- SQLite via `@tauri-apps/plugin-sql`;
- companion VS Code integration;
- Windows Explorer integration.

The project is standalone. Do not introduce a monorepo, Prisma, an HTTP API, or shared packages without an explicit architectural need.

The application is Windows-first. Windows-specific integrations must remain isolated so native equivalents can be implemented for macOS/Linux in the future.

## 2. Versioning and releases

The root `package.json` is the source of truth for the Orqeto Dev version.

Use:

```bash
npm run version:set -- <version>
```

Example for the first stable release:

```bash
npm run version:set -- 1.0.0
```

Running `npm run version:set` without an argument synchronizes the remaining metadata from the current `package.json` version.

The version must remain synchronized across:

- `package.json`;
- `package-lock.json`;
- `src-tauri/Cargo.toml`;
- `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`;
- `integrations/vscode/package.json`;
- `integrations/vscode/package-lock.json`.

The VS Code extension uses the same version as the application.

`npm run version:check` must fail when any metadata is out of sync.

The UI must obtain the version from the Tauri runtime. Do not keep a hardcoded version string in React.

## 3. Build and distribution

Expected release build flow:

1. `version:check`;
2. project validations;
3. VSIX generation for the extension;
4. Vite frontend build;
5. Tauri/Rust build;
6. NSIS packaging on Windows.

The companion VSIX uses a stable resource name:

```text
integrations/vscode/orqeto-dev-vscode.vsix
```

The actual version remains inside the VSIX package and follows the app version.

Tauri includes this VSIX as a bundle resource so the application itself can install/update the extension.

The NSIS installer uses LZMA compression.

The Rust release profile is focused on reducing binary size:

```toml
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

Do not disable `zip` crate features only to reduce size. Current ZIP compatibility must be preserved.

## 4. Tabs and project lifecycle

The application supports multiple projects open simultaneously in tabs.

Rules:

- at least one tab always exists;
- the last tab cannot be removed, only emptied;
- adding a tab creates an empty tab and activates it;
- with two or more tabs, each tab can be closed;
- tabs can be reordered horizontally;
- a simple click must not be confused with reordering;
- on Windows, internal reordering must not depend on HTML5 drag and drop because Tauri's native file drop remains active;
- the tab name is the name of the selected root folder;
- a tab without a root uses the new-tab label;
- the same canonicalized root cannot exist in two tabs;
- when attempting to open a root that is already open, focus the existing tab.

Persistence in SQLite:

- tab order;
- each tab's root;
- active tab;
- expanded/collapsed state of the main sections.

Each tab keeps independent state for:

- root;
- accumulated in-memory context;
- current filter;
- `Paths only` mode;
- notice/processing state;
- application queue;
- temporary undo history.

The active context is not restored after restarting the app.

## 5. Global preferences

Settings in the drawer are global, not per tab.

Persisted preferences include:

- language;
- light/dark theme;
- automatically copy after adding context;
- clear after copy/download;
- open Explorer on startup;
- open Explorer when selecting/opening a project;
- close Explorer when closing a folder/tab;
- close Explorer when exiting;
- recent filter limit;
- saved context limit;
- limit of applications available for undo.

Configurable limits accept integers from 1 to 100. When a limit is reduced, discard the oldest entries beyond the new limit.

## 6. Visual theme

The theme is persisted in `app_settings` and uses the values `light` and `dark`.

Switching must be immediate and reflected by the `data-theme` applied to the document.

Application colors must come from global tokens defined in `src/styles/global.css`, not from palettes duplicated per component.

Examples of token responsibilities:

- primary text color;
- secondary/muted text;
- main background;
- surface/card backgrounds;
- borders;
- buttons;
- disabled states;
- success/warning/error;
- accent/action colors.

The current dark mode prioritizes an almost-black background and neutral surfaces, keeping blue mainly as the action/highlight color.

When creating new components, reuse existing tokens before adding a new variable.

## 7. Root folders and Windows Explorer

The root is selected through the directory dialog or an explicit external integration.

On startup, validate each persisted root independently. A missing root must empty only its own tab.

Preferences control when Windows Explorer should be opened/focused or closed.

Changing or closing a root clears only that tab's transient state:

- current context;
- pending application queue;
- temporary undo history.

Never change another tab's state as a consequence of this operation.

## 8. Create context

Context can be added through:

- drag and drop;
- explicit VS Code integration.

Accepts files, folders, and multiple selections. ZIP files are not added as context content.

Rules:

- the canonicalized path must remain inside the canonicalized root;
- folders are traversed recursively in Rust;
- symlinks/junctions that resolve outside the root must be rejected;
- final paths are relative to the root and use `/`;
- the root folder name is not part of the relative path;
- active context remains in memory;
- `.orqeto-devignore` must be respected;
- outside `Paths only`, non-text content or unsupported encodings may be ignored with a warning.

### Paths only

When enabled, new entries load only `relativePath`, without reading file contents.

The mode does not change:

- root safety;
- `.orqeto-devignore`;
- recursive collection;
- filtering;
- symlink/junction protection.

ZIP remains excluded from context.

Entries with content and path-only entries may coexist.

### Deduplication

Context is deduplicated by relative path.

When adding an existing path again:

- a different entry replaces the previous one and counts as updated;
- an identical entry remains and counts as already present.

The UI summarizes added, updated, already present, and ignored entries.

## 9. Context filtering

Scopes:

- File;
- Path.

Modes:

- Contains;
- Exact;
- Regex.

Rules:

- in simple modes, `|` represents alternatives;
- `File + Contains` compares only the file name;
- `Path` compares the full relative path;
- whitespace/empty input disables the filter;
- invalid regex is shown in the UI and blocks the operation;
- do not create implicit filters.

The same active filter applies to:

- adding by drag and drop;
- adding through VS Code;
- removing by drag and drop;
- removing through VS Code.

When removing a folder with an active filter, only context entries that are under the removed path **and** match the filter must be removed. The others remain.

Filter history:

- is persisted in SQLite;
- is scoped by root;
- allows entries to be reapplied and deleted;
- defaults to 10;
- has a configurable limit from 1 to 100.

## 10. Remove from context

Removing from context changes only the in-memory context. It never deletes real files from the filesystem.

A selected file removes its corresponding entry, provided it passes the active filter.

A selected folder removes descendant entries that pass the active filter.

Before removing:

- canonicalize paths in the backend;
- validate membership in the root;
- reject items outside the project.

A valid selection with no match is a no-op and must be reported as not present/ignored.

## 11. Context export and history

Copying and downloading do not clear by default.

The Clear button:

1. saves a context snapshot for the current root;
2. only then clears the context.

If snapshot creation fails, preserve the active context.

When `auto_clear_after_export` is enabled, a successful manual copy/download also saves a snapshot before clearing.

Automatic copying after adding:

- copies the full accumulated context;
- also works through VS Code;
- never triggers auto-clear;
- clipboard failure does not roll back the addition.

Persisted history:

- `context_export_history` table;
- exact final text;
- file count;
- size in bytes;
- timestamp;
- scoped by root;
- defaults to 5;
- configurable from 1 to 100;
- allows copying, downloading, and deleting individual entries.

## 12. Text protocol

Supported languages:

- `pt-BR`;
- `en`.

The persisted language also defines the context protocol.

Portuguese:

- `RAIZ`;
- `PASTA`;
- `VOLTAR`;
- `ARQUIVO`;
- `INÍCIO DO CONTEÚDO`;
- `FIM DO CONTEÚDO`.

English:

- `ROOT`;
- `FOLDER`;
- `BACK`;
- `FILE`;
- `CONTENT START`;
- `CONTENT END`.

Only content between the delimiters belongs to the file.

When `ARQUIVO` / `FILE` is not followed by delimiters, the entry represents only the path and no content should be inferred.

Actual content never receives indentation or artificial text.

## 13. Apply code

The Apply code area accepts:

- files;
- folders;
- ZIP archives;
- multiple items in the same operation.

Each item is resolved independently.

The resolver searches for the best destination using the existing project structure/path.

When there is more than one plausible match, present a manual choice to the user instead of applying to an arbitrary location.

`.orqeto-devignore` must also be respected by patch resolution.

A normal patch does not remove absent files. Deletions happen only when declared by the reserved manifest.

### Undo

Undo history is temporary, scoped by root/project, and is not restored after restart.

It must allow:

- removing files created by an application;
- restoring replaced files;
- restoring explicitly deleted files.

Defaults to 10 applications, configurable from 1 to 100.

## 14. Deletion manifest

Reserved name:

```text
.orqeto-dev-delete.json
```

Format:

```json
{"format":"orqeto-dev-delete","version":1,"delete":["src/old-file.ts"]}
```

Rules:

- `delete` contains only paths relative to the root;
- use `/`;
- list files, never directories;
- do not use absolute paths;
- do not use `./`;
- do not use `..`;
- do not use `\\`;
- list only existing files that actually need to be removed;
- do not apply and delete the same file in the same operation;
- omit the manifest when there are no deletions;
- the manifest is metadata and must never remain in the destination project.

When generating an incremental patch that **moves** a file, include the file at the new path and list the old path in the manifest.

## 15. VS Code integration

The companion extension is independent of the app process, but depends on the executable registered by Orqeto Dev to forward actions.

Visible commands:

- `Send to Orqeto Dev`;
- `Remove from Orqeto context`;
- `Open in Orqeto Dev`.

The commands must be available only while Orqeto Dev is running.

The extension must not automatically start the app when it is closed.

External selection must be routed to the tab whose canonicalized root contains all selected paths.

If no tab fully matches, no tab must be modified.

`Open in Orqeto Dev`:

- focuses the existing tab if the root is already open;
- otherwise reuses an empty tab or creates a new one.

### Installing the extension from the app

Settings contains a VS Code section with an `Install` button.

The button must:

- install the bundled VSIX when the extension is not already installed;
- update it when it already exists;
- use `--install-extension <vsix> --force`;
- locate common VS Code installations on Windows and try the CLI from PATH;
- report success briefly;
- on error, instruct the user to install VS Code and try again.

The Marketplace is not required for this flow.

## 16. Windows integration and single instance

The application registers its executable in Windows for external integrations.

The extension and Explorer actions can forward arguments to an already running instance.

The application uses single-instance behavior to prevent concurrent workspaces from the same main process.

Forwarding processes must not open a second full UI.

Windows-specific code must remain isolated.

## 17. SQLite persistence

Current persistence includes, among other things:

- `app_settings`;
- `project_tabs`;
- filter history;
- context history.

New simple preferences may use `app_settings` without a migration when they do not require a schema change.

Do not persist:

- active tab context;
- pending application queue;
- temporary undo snapshots.

## 18. Quality and validation

Before delivering relevant changes, prefer running:

```bash
npm run lint:fix
npm run validate
```

For the final build:

```bash
npm run build
```

If the environment does not allow dependencies to be installed or compilation to complete, clearly state what was and was not validated.

Do not claim that a build/test completed without actually running it.

## 19. Incremental patches

Patches delivered during development must contain only the delta required relative to the state the user has already applied.

Avoid republishing files from previous changes without need.

Preserve relative paths inside the ZIP.

When there is a rename/move and the old file still exists in the destination project, use `.orqeto-dev-delete.json` to remove it safely.

## 20. Maintenance priorities

When choosing between technically equivalent solutions, prioritize:

1. project path and data safety;
2. predictable and explicit behavior;
3. preservation of existing functionality;
4. simple UX;
5. small, testable changes;
6. size/runtime without sacrificing required compatibility;
7. documentation consistent with the implementation.
