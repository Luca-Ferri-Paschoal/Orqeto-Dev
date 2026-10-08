# AI.md — Orqeto Dev

This file is the persistent technical context for AI-assisted maintenance of Orqeto Dev.

Canonical location: `docs/AI.md`.

The current repository code is always the source of truth. Before changing any behavior, read the current files involved. Do not assume that previous patches, conversations, or older versions accurately represent the current state.

Prefer minimal, localized changes, preserve existing functionality, and avoid refactors unrelated to the current request.

When generating patches for sharing, prefer incremental ZIP archives containing only new or changed files while preserving relative paths. If existing files or folders are deleted or renamed, use the `.orqeto-dev-delete.json` manifest described in this document.

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
- `orqetoDev.sendToContextAndCopy`;
- `orqetoDev.removeFromContext`;
- `orqetoDev.sendToIgnore`;
- `orqetoDev.removeFromIgnore`;
- `orqetoDev.openFolder`.

Do not reintroduce old naming such as Orqeto Context, `orqeto-context`, `orqetoContext`, `OrqetoContext`, `ORQETO_CONTEXT`, `com.orqeto.context`, or `.orqeto-contextignore`.

Main stack:

- Tauri v2;
- Rust;
- React;
- strict TypeScript;
- Vite;
- Tailwind CSS v4;
- SQLite via the Rust `tauri-plugin-sql` pool, exposed to the WebView only through typed Orqeto IPC commands;
- companion VS Code integration;
- Windows Explorer integration.

The project is standalone. Do not introduce a monorepo, Prisma, an HTTP API, or shared packages without an explicit architectural need.

The application is Windows-first. Windows-specific integrations must remain isolated so native equivalents can be implemented for macOS/Linux in the future.

**BR-ARCH-001:** production and maintenance source modules under `src`, `scripts`, `src-tauri/src`, and `integrations/vscode/src` must remain specialized and at or below 300 physical lines. Entry points and orchestration files should be thin facades over focused modules. When a module approaches the limit, split it by responsibility rather than compressing unrelated logic or moving a monolith unchanged into a new file. Generated metadata and lockfiles are outside this source-module rule.

**BR-ARCH-002:** `src/domain` and `src/infra` are lower-level layers and must not import from `src/features` or `src/App`. Shared contracts belong in `src/domain`; desktop/IPC adapters belong in `src/infra`; React workflows consume those layers rather than reversing the dependency direction.

**BR-ARCH-003:** crate-level Rust modules must be declared in `src-tauri/src/lib.rs`, before the split `include!("lib/*.rs")` implementation files. Do not place those `mod ...;` declarations inside an included implementation file, because Rust resolves their child paths relative to that included file and will look under `src/lib/` instead of `src/`.

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

Do not disable `zip` crate features only to reduce size. Current ZIP compatibility must be preserved. Routine VSIX packaging assumes both the root dependencies and the standalone `integrations/vscode` dependencies were installed during setup/CI (`npm install` plus `npm --prefix integrations/vscode install`, or the corresponding `npm ci` commands) and must not run dependency installation on every package command. The release build type-checks the app once before packaging; Tauri's before-build step performs only the Vite bundle so it does not compile the same app TypeScript project a second time.

## 4. Tabs and project lifecycle

The application supports multiple projects open simultaneously in tabs.

Rules:

- at least one tab always exists;
- the last tab cannot be removed, only emptied;
- adding a tab creates an empty tab and activates it;
- with two or more tabs, each tab can be closed;
- tabs can be reordered horizontally;
- during an external file/folder/ZIP drag, hovering another rooted tab briefly activates it without ending the drag so the same item can then be dropped into that project;
- every rooted project tab is also a direct **Apply code** drop target: dropping a supported payload on the tab invokes Apply under the current global Files/Git work mode and locks project routing to that tab; Files mode may still use that project's internal destination resolver, while Git mode validates the patch only against that tab;
- both the normal Apply area and direct tab drops prepare and apply only within their owning project; no operation scans other open projects;
- valid Context add/remove, Apply, Dev Ignore add/remove, and project-tab Apply surfaces expose an explicit copy/drop cursor affordance because Orqeto never moves or deletes the external source item; a rooted tab additionally highlights and shows an Apply icon while the external drag is over it;
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
- shared expanded/collapsed state of the main Folder, Context, and Apply sections;
- shared selected project-folder action (`select`, `explorer`, `vscode`, or `close`).

The main section expansion state and the selected project-folder action are global across project tabs: changing either in one tab immediately applies to every other compatible open tab and to tabs opened later. If a selected action is unavailable in the current tab (for example, an empty tab or VS Code not detected), that tab shows the safe folder-selection fallback without discarding the persisted global action.

Each tab keeps independent state for:

- root;
- accumulated in-memory context;
- current filter;
- `Paths only` mode;
- notice/processing state;
- application queue;
- application/Undo history view for the selected root; the underlying per-root history is persistent.

The active context is not restored after restarting the app.

## 5. Global preferences

Settings in the drawer are global, not per tab.

Persisted preferences include:

- language;
- light/dark theme;
- global work mode (`files` or `git`);
- automatically copy after adding context;
- automatically copy generated Commit/TypeScript/ESLint reports (default `true`);
- clear after copy/download;
- clear project logs after successful Copy (default `true`);
- open Explorer on startup;
- open Explorer when selecting/opening a project;
- close Explorer when closing a folder/tab;
- close Explorer when exiting;
- hide `Open in Orqeto Dev` for subfolders of projects that are already open (default `true`);
- selected project-folder action;
- recent filter limit;
- saved context limit;
- limit of applications available for undo.

Configurable limits accept integers from 1 to 100. When a limit is reduced, discard the oldest entries beyond the new limit.

The work mode is global for the application, not per tab. Default to `files`. Changing it must affect all open tabs immediately and must not erase existing persistent application/Undo history. Persist it in `app_settings` under a simple key; no schema migration is required.

Settings must expose a **Copy AI prompt** action next to the work-mode control. The prompt is generic for any project, is generated in the currently selected UI language, and explains the active delivery contract. In Files mode it requests complete ROOT-relative files/incremental ZIPs and the deletion manifest when needed, including direct folder paths rather than enumerating all descendants. In Git mode it requests one strict textual UTF-8 Git unified diff and explicitly tells the AI to build every hunk from the current provided code, never from an assumed or remembered older version. In both modes the prompt also explains the explicit `package.json` namespace `orqetoDev.validation` (`lintFix` and `test`). The AI must not invent tests merely to satisfy Orqeto: it should add or update `orqetoDev.validation.test` only when the user explicitly requests tests and the delivered implementation actually includes tests that should be run, and that value should point to the project's real aggregate test command. Copying this prompt changes no project state.

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

Every enabled `<button>` must expose `cursor: pointer`. On hover-capable fine-pointer devices, enabled buttons also receive a global visible hover treatment from `src/styles/global.css`; disabled buttons are excluded. Component-local button variants may add stronger hover styling but must not remove the global interaction affordance.

## 7. Root folders and Windows Explorer

The root is selected through the directory dialog or an explicit external integration. `Open in Orqeto Dev` from VS Code or the Windows Explorer shell must start the application when it is closed. If the exact requested root is already open, focus that tab instead of creating a duplicate. When the global `hideOpenProjectSubfolders` preference is enabled (default), an external request to open a descendant of an already open root must focus the containing project rather than create a nested root.

On startup, validate each persisted root independently. A missing root must empty only its own tab.

Preferences control when Windows Explorer should be opened/focused or closed. The project-folder actions label this explicitly as **Open in Explorer**. When a local VS Code installation is detected, the same row also exposes **Open in VS Code**; the action is hidden when VS Code is unavailable and the backend revalidates the executable before launching it.

Changing or closing a root clears only that tab's transient state:

- current context;
- pending application queue.

Persistent Context history and application/Undo history are scoped to the canonical root and are not deleted merely because its tab is closed or repointed. Never change another tab's state as a consequence of this operation.

### Dev Ignore editor

The root-folder row includes a **Dev Ignore** action for `.orqeto-devignore`.

- When the file is absent, the first action creates it atomically without overwriting an existing file. The generated template contains explicit `.gitignore`-compatible defaults for common dependency directories, build output, caches, VCS/editor metadata, and major development ecosystems.
- When the file exists, the action opens the shared accessible dialog component.
- The dialog uses a 60/40 add/remove drop layout.
- Added paths are exact root-relative rules. Literal Git-ignore metacharacters in file names must be escaped.
- Removing a path means making it available again. When a broader rule ignores an ancestor, append the parent unignore rules required by Git-ignore semantics.
- Reject paths outside the project and reject `.orqeto-devignore` itself.
- Serialize updates per project so local drops and external actions cannot race file writes.
- The dialog is project-scoped and may affect VS Code routing only while it is open for that project.

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
- the active manual context stores only deduplicated ROOT-relative file paths in memory; file contents are never treated as the long-lived source of truth;
- `.orqeto-devignore` must be respected;
- outside `Paths only`, non-text content or unsupported encodings may be ignored with a warning during selection and are revalidated during export.

### Paths only

The manual selection always stores only `relativePath`. `Paths only` changes export formatting: when enabled, Copy/Download emits only the selected paths; when disabled, Copy/Download materializes the current file contents from disk.

The mode does not change:

- root safety;
- `.orqeto-devignore`;
- recursive collection;
- filtering;
- symlink/junction protection.

ZIP remains excluded from context.

### Live materialization and deduplication

Context membership is deduplicated by relative path. Re-adding a selected file never replaces cached content because manual context has no cached content. It counts as already present. Re-adding a folder may add newly discovered files while reporting its already-selected files separately.

Copy, Download, automatic copy-after-add, and VS Code **Send and copy Orqeto Dev context** materialize the complete selected path set again from the current project immediately before formatting/export. Materialization runs under the backend project read coordinator, revalidates ROOT ownership, `.orqeto-devignore`, symlink/reparse safety, text/size limits, and fails closed when project/selection revisions change during the operation. Missing or newly ignored files are reported as unavailable rather than silently exporting stale bytes. When a normal Copy/Download can only materialize part of the selection, it may export the available subset with an explicit warning, but automatic clearing is suppressed so unavailable members are never silently dropped. VS Code **Send and copy** requires a complete materialization and fails closed if any selected member is unavailable.

The UI status is structured by outcome and reports file and folder counts for newly added, already present, skipped, removed, filtered/not-present, and materialized/unavailable entries. Folder counts include traversed child directories rather than only the top-level dropped folders.

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
- regex matching runs outside the renderer main thread in a disposable worker with a bounded runtime, so catastrophic backtracking cannot freeze the application UI;
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

Manual Copy/Download never formats stale cached source text. It first materializes the current bytes for the selected ROOT-relative paths and only then formats, copies/saves, and optionally archives the result. The selection itself remains stable until the user explicitly adds, removes, clears, changes root, or auto-clear runs. Files created later inside a previously selected folder are not implicitly added; re-send that folder to add those new paths explicitly.

Copying and downloading do not clear by default.

The Clear button:

1. attempts to materialize the current selection and save a complete context snapshot for the current root;
2. when every selected item is available, clears only after that complete snapshot is saved successfully;
3. when one or more selected items are unavailable, skips the history snapshot rather than saving a misleading partial snapshot, but still clears the active selection and reports the result as partial.

If complete snapshot persistence fails for reasons other than unavailable selected items, preserve the active context. Manual Clear is an explicit discard action and must not become permanently blocked merely because a previously selected file was deleted, moved, or newly ignored.

When `auto_clear_after_export` is enabled, a successful manual copy/download also saves a snapshot before clearing. Automatic clear remains suppressed when export materialization is partial because of unavailable items.

Automatic copying after adding:

- copies the full accumulated context;
- also works through VS Code;
- never triggers auto-clear;
- clipboard failure does not roll back the addition.

Context resource safety:

- recursive discovery is iterative and bounded to 500,000 files, 1,000,000 visited directories, and 1,500,000 combined entries per operation;
- a single text file is bounded to 16 MiB;
- aggregate text content is bounded to 128 MiB;
- oversized input fails explicitly rather than allocating without limit.

Persisted history:

- `context_export_history` table;
- exact final text;
- file count;
- size in bytes;
- timestamp;
- scoped by root;
- defaults to 5;
- configurable from 1 to 100;
- allows copying, downloading, and deleting individual entries;
- is surfaced once beside the `Create context` heading for the current project instead of being repeated below Custom/Full-project/Commit/validation action groups;
- opens as a header overlay so the closed History control does not consume an extra bottom row and opening it does not permanently reflow the context card;
- leaves Custom `Copy`, `Download`, and `Clear` in one horizontal action row, including the narrow-layout fallback.

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

The protocol must also state the active global work mode and tell the receiving AI how to return changes:

- `files`: return complete files preserving ROOT-relative paths; for multiple files prefer an incremental ZIP; use `.orqeto-dev-delete.json` for file/folder deletions or renames and list a folder path once instead of every descendant; do not return `.patch`/`.diff`;
- `git`: return one textual UTF-8 `.patch` or `.diff` in Git unified-diff format compatible with strict `git apply`, using ROOT-relative `/` paths; do not depend on binary patches, symlinks, submodules, copy operations, file-mode changes, `--3way`, or whitespace tolerance.

## 13. Apply code

Application behavior is controlled by the global `workMode` preference. The modes are exclusive; never infer, auto-switch, or silently reinterpret the mode from dropped content.

Apply routing is local to the tab that owns the drop target. A busy, changed, or closed owner tab is rejected; no other tab is inspected as a possible destination.

### Files mode

Files mode accepts:

- files;
- folders;
- ZIP archives;
- multiple items in the same drop.


### Explicit irreversible deletion of generated directories

In Files mode, an optional `deletePermanent` field in `.orqeto-dev-delete.json` (format/version remain 1) declares only disposable, rebuildable **directory** roots such as `src-tauri/target` or `node_modules`. Example: `{"format":"orqeto-dev-delete","version":1,"delete":["src/obsolete.ts"],"deletePermanent":["src-tauri/target"]}`. AI may propose these paths but cannot approve their destruction: the app requires a separate in-app user confirmation, validates ROOT-relative paths, rejects symlinks/reparse points and suspicious credentials, and restricts terminal directory names to its generated-artifact allowlist. `deletePermanent` overrides `.orqeto-devignore` **only for the explicitly approved generated directories**; ordinary `delete` continues to honor that file. Limits of 10,000 declared entries total and 256 KiB per manifest remain unchanged.

`deletePermanent` is **never backed up, journaled for rollback, included in recoverable history, or added to Undo**. The normal `delete` list and ordinary code modifications remain undoable through their existing snapshots. Paths in the two deletion lists (or file writes) may not overlap, including parent/child paths. To permanently remove `src-tauri/target` while removing other `src-tauri` source files with Undo, list source paths separately in `delete`, not the parent `src-tauri`. Never mark source code, source `lib`/`packages`, `.env`, real secrets, user data or configurations for permanent deletion. The two steps are not one atomic operation: reversible Apply commits first and the explicitly confirmed permanent cleanup runs second; partial failure is reported, and already erased files cannot be recovered with Undo. No source tree-wide content scan is promised for arbitrary unknown credentials within generated output; review the targets before approving.

`.patch` and `.diff` inputs must be rejected with a message telling the user to switch to Git mode. `.orqeto-devignore` remains authoritative at both candidate resolution and final write/delete planning, including explicit root placement and deletion manifests. Deletions happen only through `.orqeto-dev-delete.json`. Each manifest entry may target an existing file or folder; folder targets expand under bounded traversal and remain subject to `.orqeto-devignore`, no-link/reparse, canonical-root, and race-revalidation protections. Invalid/oversized deletion manifests must surface their real validation error during current-project preparation rather than being collapsed into “no destination”. Directory sources use the large-project discovery budget: at most 500,000 files, 1,000,000 directories, and 1,500,000 combined entries, with independent per-path and aggregate path-byte ceilings. ZIP ingestion keeps its separate archive-specific limits. Project destination discovery uses the same large-project filesystem budget and fails closed on any structural read/metadata error that could hide a candidate. Routing discovery is operation-scoped: one temporary scan gathers cheap name evidence, and expensive file-by-file candidate validation is bounded. If cheap discovery produces more than the bounded validation shortlist, the result is explicit ambiguity with no automatic recommendation rather than candidate×file work.

Each dropped item is analyzed **only against the ROOT of the tab where Apply started**. The normal Apply zone and direct drops onto rooted tabs share this ownership rule. No source is inspected against the other open project tabs. The first-level project selection dialog and cross-project confidence comparison have been removed.

Within the owning project, preserve the backend destination recommendation, candidate discovery limits, archive-envelope handling, and validated in-project resolution. A single credible candidate applies directly; several candidates require the existing destination dialog, with the safe project ROOT offered as an explicit alternative. When there are no credible matches, request explicit confirmation for ROOT placement. Ambiguity above the safe candidate budget fails closed; no fallback may bypass it.

The initiating tab ID and root path are captured before asynchronous preparation and checked again before handing the plan to the workspace. A changed, closed, busy, or unregistered source project causes an explicit refusal. Distinct dropped items are processed sequentially against that same root, and successful changes retain grouped Undo behavior. Secret review and destination revalidation still run on the authoritative backend Apply path.

#### Already-applied detection

Before Files-mode writes are performed, replacement sources must be compared to their current destinations **byte-for-byte**. Unchanged replacements are removed from the write plan.

If the final plan has no file writes and no remaining deletion:

- do not create a backup snapshot;
- do not add an Undo/history entry;
- do not touch the filesystem;
- show the localized equivalent of **“No changes were made. The code was already applied.”**

For mixed operations, apply only the files that differ and keep the unchanged count in the batch summary.

ZIP equality must compare the continuous byte stream, not assume both `Read` implementations return the same chunk size. Reapplying the same ZIP to an unchanged project therefore reports every ZIP entry as unchanged/already applied and produces no new mutation snapshot, regardless of decompressor/file read chunk boundaries.

### Git mode

Git mode accepts **exactly one** textual UTF-8 `.patch` or `.diff` per application. Files, folders, ZIPs, and multiple patch files must be rejected explicitly. Git must be available.

A Git patch already declares its paths. Git mode never relocates these paths and never validates the patch against other open tabs. It prepares a patch only against the tab that initiated Apply. Invalid patch diagnostics from that project must be surfaced; no project-level selector is offered. A previously applied patch can be skipped only when the existing post-apply fingerprint proof holds. Otherwise the normal strict Git preview and user confirmation remain required.

The patch contract is deliberately strict and predictable:

- textual UTF-8 only;
- maximum patch size: 32 MiB;
- maximum affected files: 5,000;
- Git unified diff with `diff --git` headers;
- ROOT-relative paths using `/`;
- when the Orqeto root is a subdirectory of a larger repository, use Git from the real repository root and prepend the selected-root prefix internally; the AI-facing paths remain relative to the Orqeto ROOT;
- reject absolute paths, `..`, unsafe path components, backslash paths, and unsupported quoted path forms;
- reject affected paths outside the selected Orqeto root;
- respect `.orqeto-devignore`;
- reject binary patches;
- reject symlinks/junction targets and submodules;
- reject Git copy operations;
- reject patches that change file mode/permissions; newly created files must use normal regular-file mode;
- do not use `--3way`;
- do not automatically ignore or fix whitespace;
- do not stage or commit anything.

The AI-facing Git instructions must explicitly require every hunk to be based on the **current code supplied in the context/report**, not an earlier, assumed, or remembered version. Runtime safety is still based on applicability, not on trusting that instruction.

Preparation flow for each candidate project:

1. validate extension, size, encoding, and patch metadata and freeze the patch bytes for that preparation;
2. fingerprint those exact immutable bytes with SHA-256 and discover the repository root;
3. feed the same frozen bytes to `git apply --numstat -z` to obtain the exact affected paths and line statistics;
4. validate every affected path against ROOT and `.orqeto-devignore`;
5. feed the same frozen bytes to strict `git apply --check`;
6. when that project is selected, show the preview listing create/modify/delete/rename operations and `+/-` lines.

Application flow after preview confirmation:

1. read and freeze the current patch source once, and require its SHA-256 fingerprint to equal the previewed fingerprint;
2. simulate the same immutable patch over a private copy of the affected pre-application files and relevant `.gitattributes`, producing the exact expected after-state fingerprints without mutating the project;
3. create the Orqeto Undo snapshot and persist the simulated expected after-state fingerprints in the recovery journal before the first project mutation;
4. rerun strict `git apply --check` using those frozen bytes and the same isolated Git-apply environment;
5. run `git apply` using the same frozen bytes and isolated environment;
6. require the resulting filesystem to match the simulated fingerprints exactly;
7. record the snapshot in Orqeto history.

`git apply --check` may still accept a hunk after harmless line-number offsets when its required surrounding content remains valid. This is intentional. Do not require an exact commit hash as the universal base because AI-generated patches and uncommitted working trees may not have one. The safety requirement is that the patch remains strictly applicable to the current content immediately before application.

If application, final verification, or history registration fails, Orqeto must attempt to restore the safety snapshot. Git mode must never use `git reset`, `checkout`, `restore`, `clean`, or other destructive Git commands for rollback. Git subprocesses must use a resolved executable, remove inherited `GIT_*` variables that can redirect repository/configuration ownership, and enforce bounded runtime plus combined stdout/stderr output. Every `git apply` operation (statistics, check, simulation, and mutation) must run with a private Orqeto Git directory/work-tree binding plus isolated global/system Git configuration. This prevents repository/user configuration such as whitespace tolerance or executable clean/smudge filter drivers from changing validation semantics or executing project-configured commands. Relevant work-tree `.gitattributes` remain declarative input and are mirrored into the private simulation so expected output stays aligned with the real apply.

### Mutation atomicity and interrupted-operation recovery

Critical project access is coordinated per canonical root, including overlapping roots: preparation/context/diagnostic operations take read access while Apply, Undo, and Dev Ignore mutations take exclusive write access. Frontend busy flags are not the concurrency boundary. Files-mode preview fingerprints the incoming source state and routing evidence. After Apply acquires exclusive project mutation access, it first reserves Orqeto-owned storage for the expected staging bytes, copies the current external source into a fresh random private staging directory, verifies each copied file against stable before/frozen/after fingerprints, and then rebuilds final source/routing fingerprints **from that frozen representation**. The previewed fingerprints and selected candidate must still match. The real project mutation then reads only the same frozen manifest/staged bytes; it never rebuilds the source from the original external path after final validation.

Project parent directories are created component-by-component beneath the canonical root, with symlink/reparse and canonical-parent checks. On Windows, project-relative paths continue to reject reserved device names, alternate-data-stream syntax, trailing dot/space aliases, and ambiguous existing short-name spellings. Files-mode writes fully build and flush same-directory temporary files, revalidate the destination and project path immediately before commit, and then use atomic replacement or no-clobber creation. A concurrent destination change detected at that last validation is preserved and the operation fails instead of overwriting it. Windows virtual-drop staging also uses fresh GUID-backed directories created atomically and refuses reparse staging directories. Undo/rollback apply the same last-moment validation and must never learn an expected Orqeto state by rereading a file that another process may already have changed.

Before the first project mutation, persist a recovery journal beside the safety snapshot. The journal records whether each destination existed and, when known, the exact fingerprint expected after the operation. Only the primary application instance may scan stale snapshots at startup. A secondary single-instance forwarding process must never clean another live instance's Undo/recovery files.

Recovery and rollback must never silently overwrite or delete a destination whose current fingerprint cannot be proven to be either the pre-operation state or the exact Orqeto-produced state recorded by the journal. A crash may occur after the atomic destination commit but before the per-file `applied` flag reaches the journal; in that narrow case recovery may infer that the mutation happened only when the current destination exactly matches the already-journaled expected Orqeto after-state (or another explicitly journaled allowed intermediate state). If automatic recovery cannot make that proof, preserve both project data and backup data, surface a localized blocking status, and reject new Apply/Undo mutations until the conflict is resolved. Rollback errors are first-class failures; do not discard a snapshot after a partial/failed rollback.

### Undo/Recovery storage authority, quotas, and garbage collection

All Orqeto-owned Apply staging, Undo snapshots, recovery journals, and content-addressed backup blobs are governed by one backend storage authority under the Orqeto temporary-storage root. The manager accounts real on-disk usage globally and per project, includes outstanding in-process reservations, checks real filesystem free space, and reserves expected staging/snapshot/journal bytes plus a safety margin before the first project mutation. The default hard logical quotas are **10 GiB per project** and **100 GiB globally**; project source size itself is not capped by these values. Soft thresholds are 80% of each hard quota and trigger garbage collection before the hard-cap decision is made. If logical quota or physical free-space reservation cannot be satisfied, Apply/Undo fails before mutating the project.

Undo/recovery stores only affected pre-operation states. Created files are represented by prior absence plus the expected after-state fingerprint. Modified and deleted files retain exact prior bytes plus the expected Orqeto-produced after state (or expected absence for deletion). Exact prior bytes are stored as permission-aware content-addressed blobs so identical snapshot content can be shared safely. Blob references are persisted in snapshot metadata before mutation; a shared blob is collectible only after no live snapshot references it. When multiple Files applications are merged into one Undo entry, committed snapshot metadata is compacted so superseded intermediate backup blobs that are no longer needed by the merged rollback are released. Compression is intentionally not applied blindly; content-addressed deduplication is the active storage-reduction mechanism, avoiding pointless recompression of already-compressed source formats.

Storage classes distinguish rebuildable cache, ordinary history, completed staging, active Undo, active staging, and recovery-critical data. Normal GC may reclaim rebuildable/stale temporary data and unreferenced blobs, but it must never delete active Undo, active staging, or recovery-critical snapshots to satisfy quota. Stale Files staging and native-drop directories are cleaned only through no-follow managed-path validation; an active descendant protects its containing temporary subtree, and symlink/reparse escapes are rejected. Recovery/Undo revalidates content-addressed blobs against both their managed no-follow path and their hash/permission-derived identifier before reading them, then revalidates the exact backup identity again immediately before the atomic restore commit so a concurrent backup change cannot be installed. Startup recovery validates managed snapshot/journal paths before reading and runs before post-recovery GC so a crash cannot make the only recovery copy collectible.
If startup recovery cannot safely resolve a previous operation, the UI keeps Apply/Undo blocked and shows a persistent recovery banner. That banner may offer an explicit **Discard Apply history** action only behind an in-app destructive confirmation. The discard path preserves current project files, removes all Orqeto-managed Apply/Undo snapshots and recovery backups, clears in-memory history, and releases mutation protection only after managed cleanup succeeds; a cleanup error leaves the safety block in place.

### Current-project feedback and Undo

Apply never changes the active project because of path similarity. Only the initiating workspace receives its Apply status. Internal destination review and Git patch preview must remain decision states rather than success messages. The project's normal persistent Undo history remains authoritative, including stale-operation protection and grouped Undo for a multi-item Files drop.

### Undo and application history

Undo/application history is persistent and scoped by canonical root/project. Its metadata and exact Orqeto safety snapshot are retained across normal app restart and closing/reopening a project tab, then reconstructed at startup before the project is reopened. It is shared across both work modes so switching modes does not remove previous Undo entries.

Files-mode entries keep created/replaced/deleted counts, the application date/time, a source-content fingerprint, and a human-readable source label when one can be derived (ZIP filename, applied folder, or common parent folder). Git-mode entries also retain the source fingerprint and additionally retain:

- source kind = `git`;
- patch file name;
- added-line count;
- deleted-line count.

Each Git patch creates its own history entry; it must not be merged into a previous Files-mode batch. The UI should identify Git entries distinctly. Before a retained source is applied again, compare its source-content fingerprint with the retained history. A match in an older entry requires an explicit localized confirmation that says how many applications ago the source was used. A match in the newest Files entry must not short-circuit destination-aware Files behavior; continue through the existing byte-for-byte no-op path so current code reports no changes and creates no extra history entry. A newest matching Git patch may bypass preview as an already-applied no-op only when the current project still matches every exact post-apply fingerprint/absence recorded by that newest history entry. If any affected path differs, run the normal strict Git preparation; history alone must never claim that current code is unchanged. Display names are informational only and must never be used as duplicate identity.

Undo must allow:

- removing files created by an application;
- restoring replaced files;
- restoring explicitly deleted files;
- restoring rename source/destination state captured before a Git patch.

Before undoing, keep the existing safety check that refuses to overwrite files that no longer match the state left by the application. Revalidate each destination again immediately before its Undo mutation, and make multi-file Undo itself recoverable so a process interruption or mid-sequence failure cannot silently leave an untracked partial reversal.

The history limit defaults to 10 applications and remains configurable from 1 to 100.

## Context secret redaction

Context emission is safe-by-default and must redact likely credentials before text leaves the backend. The redactor runs only after a file has already been read/decoded for Context, so it adds no extra filesystem pass and remains linear in the emitted text size.

Rules:

- `.env`, `.env.*`, `*.env`, and `*.env.*` files redact every non-empty assignment value, not only names that happen to contain `TOKEN` or `SECRET`; this keeps accidental `.env` sharing safe even for project-specific variable names;
- non-assignment, non-comment lines inside an env-like file are also replaced with `[REDACTED]` so multiline secret bodies cannot leak after the first assignment line;
- JSON/YAML/TOML/INI/CONF/CONFIG/properties content uses normalized sensitive key names/suffixes such as password, credential, secret, token, API key, private/signing/encryption/HMAC key, Authorization, Cookie, and Set-Cookie;
- URL user-info credentials and sensitive query parameters are redacted when a URL is present;
- high-confidence token signatures may be redacted in any text without enabling broad heuristic scanning;
- Git Commit Context applies the same policy to staged/unstaged diff content and untracked text files, including env-like diff hunks;
- custom validation command text/stdout/stderr and diagnostic source excerpts pass through the same output redaction boundary before they become Context;
- `[REDACTED]` is output-only metadata. Never write it back to the project automatically and never try to infer the original value;
- a file whose emitted Context contains a redacted/sensitive value is informational only for AI delivery: copied AI prompts and generated Context protocol explicitly tell the model not to create, edit, replace, rename, or delete that file;
- Files-mode Apply performs a final secret-protection pass only on the selected/frozen application input and the destination files that would actually be mutated. Secret-bearing writes and deletes are removed from the mutation plan, safe siblings may continue, and the result carries protected-file plus detected-secret counters; folder deletion keeps protected descendants and therefore keeps any ancestor folder required to contain them;
- Git-mode Apply cannot safely strip individual files from a unified patch, so preview validation rejects the entire patch when a hunk exposes protected material or an affected existing file already contains detected secrets;
- Apply protection uses the same filename/format and high-confidence detection rules as Context redaction, with a bounded 16 MiB text inspection per file and fail-closed handling for oversized/invalid env-like or config-like files. It does not scan the whole project and therefore does not add a project-wide filesystem pass;
- all existing Context file-count, byte, ignore, path, and traversal limits are evaluated on the real source input, so redaction cannot be used to bypass safety budgets.

The implementation should prefer a filename/format fast path plus a single linear text pass over regex-heavy parsing or a second filesystem scan.

## 14. Deletion manifest

Reserved name:

```text
.orqeto-dev-delete.json
```

Format:

```json
{"format":"orqeto-dev-delete","version":1,"delete":["src/old-file.ts","src/old-folder"]}
```

Rules:

- `delete` contains only existing file or folder paths relative to the root;
- use `/`;
- a folder path deletes its complete safe subtree, so list the folder once instead of enumerating every descendant;
- the manifest is capped at 10,000 entries and 256 KiB; folder expansion uses the normal bounded project traversal limits;
- do not use absolute paths, `./`, `..`, or `\\`;
- reject symlinks/junctions/reparse points, missing targets, paths outside the root, and any file/folder protected by `.orqeto-devignore`;
- reject applying a file at the same path as a deletion or inside a folder being deleted;
- delete files first and directories deepest-first, revalidating immediately before mutation;
- Undo/recovery recreates explicitly deleted folders before restoring file backups, including empty folders;
- omit the manifest when there are no deletions;
- the manifest is metadata and must never remain in the destination project.

When generating an incremental patch that **moves** a file, include the file at the new path and list the old path in the manifest.

## 15. VS Code integration

The companion extension is independent of the app UI process, but uses the executable and versioned integration snapshot registered by Orqeto Dev on Windows. The app is the source of truth.

For each refresh, the snapshot exposes:

- the current Orqeto process ID used for cheap liveness validation;
- all currently open project roots;
- the one project root whose Dev Ignore dialog is currently open, or `null`;
- the global `hideOpenProjectSubfolders` preference;
- the current app locale (`pt-BR` or `en`) so extension menus and notifications follow Orqeto Dev instead of the VS Code UI language.

Context/Ignore commands are project-scoped. They must be visible only when the current VS Code workspace resolves safely to a project that is currently open in Orqeto Dev. A project that is not open in Orqeto must not expose Context or Dev Ignore actions. Context actions remain available whenever that project is open, not busy, and its Dev Ignore dialog is not active; they are never gated by the currently selected Project Full/Custom, Commit, or Validation view in the app. Their launcher remains forward-only: it must not start a closed app, and it must receive a definitive forwarding result so a primary-instance shutdown race is surfaced as a delivery failure rather than silently dropping the action. Once received by the primary instance, actions are queued with stable IDs and removed one at a time only after the renderer acknowledges that specific action; one failed action must not drain or silently discard later actions.

Normal mode exposes, localized to the current Orqeto Dev locale:

- `Send to Orqeto Dev`;
- `Send and copy Orqeto Dev context`;
- `Remove from Orqeto Dev context`.

`Send and copy Orqeto Dev context` is an atomic user workflow: resolve the current project, finish registering the complete path selection, materialize every selected path from the current project, format that fresh result, and copy it exactly once. It must use the same live Copy/export semantics as the app Copy action, including the configured archive/auto-clear behavior. If adding or live materialization fails, do not copy an older/incomplete context. If Dev Ignore becomes active before execution, reject the stale command rather than reinterpret it as an Ignore action. Explorer/native-drop and VS Code entry points must converge on these same workspace handlers rather than maintaining separate cached context state. On receipt, Context/Ignore actions focus the owning Orqeto project tab. Context add/remove/add-and-copy actions switch that tab to Project > Custom (the manual Create context view) before using the normal selection pipeline. Send and copy completes the add first and then copies the freshly materialized complete selection. Busy-state and project/Ignore ownership are still revalidated immediately before mutation; while the owning project is busy, the extension hides its Context/Ignore commands, and a stale command is rejected if it still arrives.

While the matching project's Dev Ignore dialog is open, only that project switches to:

- `Send to Orqeto Dev Ignore`;
- `Remove from Orqeto Dev Ignore`.

Opening the Dev Ignore dialog for project A must never switch project B, another VS Code window, or another Orqeto tab into Ignore mode. The extension refreshes labels/availability from the published state, but every action must re-read current state at execution time. The app must also route the incoming action from its current authoritative state rather than trusting a possibly stale flag from the extension. Liveness refresh must not run a permanent PowerShell/CIM process scan: the published process ID is checked cheaply, and registry refresh uses an adaptive fallback cadence (shorter while the VS Code window is focused, longer while inactive).

External selection must be routed to the deepest open project root that contains all selected paths. If no open project fully matches, no tab may be modified.

`Open in Orqeto Dev` is deliberately different from Context/Ignore commands:

- it is available even when Orqeto Dev is not running and must start the registered executable when needed;
- launching/focusing must rely on the single-instance handoff without a process-discovery race that can drop an `--open-root` request when the previously detected primary exits during launch;
- Explorer open-root actions and VS Code Context/Ignore/open-root actions bring the main Orqeto window to the foreground when received; this is a transient raise/focus operation and must never leave the window permanently always-on-top;
- the VS Code Explorer menu must not offer `Open in Orqeto Dev` for an exact root that is already open; Context/Ignore actions are shown there instead when applicable;
- if an exact-open-root request still arrives through a stale menu, command palette, Explorer shell, or another external path, focus that tab instead of opening a duplicate;
- when `hideOpenProjectSubfolders` is enabled, descendants of already open projects should not be offered as new roots by the VS Code Explorer menu, and the app must still enforce the rule if a stale/external command reaches it;
- when that preference is disabled, descendants may be opened as independent roots.

The common single-root VS Code case must reflect these rules exactly. Multi-root workspaces should fail conservatively when a single safe Orqeto owner cannot be established.

### Installing the extension from the app

The VS Code Settings section is an environment capability and is rendered only when Orqeto Dev detects a usable local VS Code installation. Detection checks the normal Windows install locations, the registered `Code.exe` app path, and the process `PATH`; it is refreshed while the app is running. The project-folder **Open in VS Code** action follows the same capability state. Backend commands revalidate availability so a stale UI state cannot launch or install through an executable that disappeared.

The Settings action must:

- install the bundled VSIX when the extension is not already installed;
- update it when it already exists;
- use `--install-extension <vsix> --force`;
- locate common VS Code installations on Windows and try the CLI from PATH;
- report success briefly;
- fail explicitly if VS Code becomes unavailable or installation/update fails.

The Marketplace is not required for this flow.

## 16. Windows integration and single instance

The application registers its executable in Windows for external integrations. At startup it removes Orqeto-owned legacy shell verbs from the common directory/folder shell classes before registering the current canonical Directory and Directory Background verbs, so upgrades cannot leave duplicate Explorer entries behind.

The extension and Explorer actions can forward arguments to an already running instance. The Explorer shell command invokes the registered executable directly, so the same action starts the app when it is closed and is forwarded by single-instance handling when it is already running. External actions restore and transiently raise/focus the main window before the renderer handles the queued request.

The native Windows drop target also transiently raises/focuses Orqeto when a supported file/folder drag first enters any visible portion of the app window. The raise happens only for a valid drag payload and only on drag-enter, not ordinary pointer hover or every drag-over event, and it immediately returns the window to normal non-topmost behavior. Because that drag-enter focus transition can itself produce a Tauri focus/resize notification, native drop-target refresh must preserve the currently registered OLE target for the full accepted drag lifetime; it may refresh registrations only when no supported native drag is active.

Business-rule invariants:

- **BR-WIN-001**: a valid native drag-enter and any Explorer/VS Code external action restore and transiently raise/focus the Orqeto window without leaving it permanently topmost;
- **BR-WIN-002**: Windows integration registration removes Orqeto-owned legacy shell verbs from common folder/directory classes before writing the canonical Explorer verbs, so upgrades converge to one visible Orqeto entry per applicable menu;
- **BR-WIN-003**: native drop-target refresh never revokes the registered OLE target while a supported drag is active, so an accepted file/folder/ZIP drag keeps its copy/drop effect until drag-leave or drop.

The application publishes external-integration state in a serialized order so rapid project/modal changes cannot leave an older registry snapshot after a newer one.

The application uses single-instance behavior to prevent concurrent workspaces from the same main process.

Forwarding processes must not open a second full UI.

Windows-specific code must remain isolated.

## 17. SQLite persistence

Current persistence includes, among other things:

- `app_settings` (including `theme` and global `work_mode`);
- `project_tabs`;
- filter history;
- context history.

New simple preferences may use `app_settings` without a migration when they do not require a schema change.

Do not persist:

- active tab context;
- pending application queue;
- pending application queues or other in-progress UI-only operation state.

Application history/Undo snapshots are not stored in SQLite: committed ActiveUndo snapshots carry bounded persistent history metadata in Orqeto-managed backend storage. Startup recovery preserves validated committed history snapshots, reconstructs the per-root history, and only then allows normal GC. Closing a project tab does not discard those snapshots.

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

## 20. Git commit context

When the selected root belongs to a Git work tree, the project-folder section exposes **Commit context** actions for copying or downloading an AI-ready report.

Rules:

- repository detection and report generation use the local Git CLI;
- on Windows, common Git for Windows installation paths may be tried before falling back to `git` from `PATH`;
- Git commands used by this feature are read-only and must not stage, reset, commit, checkout, or otherwise mutate the index or working tree;
- read-only Git context commands must neutralize executable repository/config extensions that are not required by the report: force `core.fsmonitor=false`, keep external diff disabled, and pass `--no-textconv` to diff commands;
- every Git subprocess has bounded combined stdout/stderr and a 5-minute runtime limit;
- the resulting Commit context is subject to the normal 50,000-file and 128 MiB aggregate text limits and must fail explicitly when either bound is exceeded;
- report generation is scoped to the selected tab root using the current directory/pathspec, even when that root is a subdirectory of a larger repository;
- do not include changes outside the selected project root;
- include `git status --short`, staged diff, and unstaged diff;
- list untracked files while respecting Git ignore rules;
- include untracked file contents only when they are regular text files no larger than 256 KiB;
- do not follow untracked symlinks to read content;
- binary, non-text, symlinked, or larger untracked files remain represented in Git status and in the untracked-file section without embedding their content;
- the report contains the repository/project name and current branch but must not expose an absolute local path;
- the generated instructions explicitly ask the receiving AI to create a commit title and an optional short body, preferring Conventional Commits when appropriate;
- Commit context remains available in both work modes; its final delivery instruction follows the active mode (`files` => complete files/incremental ZIP, `git` => one strict unified `.patch`/`.diff`);
- output follows the current application language (`pt-BR` or `en`);
- copying writes the report to the clipboard; downloading writes a `.txt` file through the existing export flow;
- one global **Copy automatically after generating reports** setting defaults to enabled. When enabled, successful Commit generation writes that fresh report to the clipboard exactly once in addition to retaining the manual Copy action. Clipboard failure is reported but does not discard the prepared report;
- when there are no Git changes, do not create an empty report; show an informational notice instead;
- the prepared Commit report in React is transient, but each successful generation is archived in the unified persistent Context history in SQLite.

The feature must degrade safely when Git is unavailable or the selected root is not inside a Git work tree.

## 21. Full-project and diagnostic contexts

The project-folder section exposes additional transient context generators alongside Commit context.

Rules:

- **Full project context** is available whenever a project root is configured, but entering Full mode is intentionally lazy: it must not traverse the project or materialize source bodies automatically. The user explicitly starts **Scan**. Scan uses the same bounded reference-only discovery pipeline as normal Context ingestion, applies the shared Context filter (file name/path plus contains/exact/regex), respects `.orqeto-devignore`, and records the filtered relative-path snapshot together with file count and aggregate discovered byte size. Copy and Download remain disabled until a valid scan exists. They reuse that scanned path snapshot and materialize/revalidate current filesystem content only when export is requested. Changing the configured root or any Context filter field invalidates the scan; files created after a scan are not implicitly included until the next scan. The shared **Paths only** choice is honored without requiring a rescan because it affects export formatting/materialization rather than membership. Project mode shows those filter controls but not the manual add/remove drop targets. Traversal limits, text decoding, binary handling, per-file limits, and aggregate content limits remain authoritative. Full-project scanning/export never replaces or mutates the tab's accumulated manual Context selection.
- **TypeScript context** is shown only when the selected root contains at least one `tsconfig*.json` outside excluded dependency/VCS/build scan directories. Type Check is an Orqeto-owned standardized diagnostic: it resolves the project's local TypeScript installation/configurations directly and always produces Orqeto's structured AI report. `package.json` must not override Type Check execution.
- **ESLint context** is shown only when the selected root contains a supported `eslint.config.*` or `.eslintrc*` file outside excluded dependency/VCS/build scan directories. ESLint reporting is also an Orqeto-owned standardized diagnostic and must not be replaced by arbitrary project scripts. It uses the local ESLint/configuration directly and preserves Orqeto's structured AI report format.
- The Validation row exposes **Lint Fix** between Type Check and ESLint whenever either ESLint fallback capability exists or the root project explicitly configures `orqetoDev.validation.lintFix`. If that explicit command exists, it is authoritative for Lint Fix and Orqeto runs the exact string from the canonical project root. If it does not exist, Lint Fix falls back to Orqeto's internal local-ESLint auto-fix pipeline: bounded `--fix-dry-run`, `.orqeto-devignore` filtering, checked canonical in-root paths, source-byte revalidation, conflicting-config rejection, atomic replacement, and checked rollback attempts after a mid-write failure.
- The Validation row exposes **Test** only when the root `package.json` contains a non-empty string at `orqetoDev.validation.test`. Test deliberately has no inferred fallback. Adding, changing, or removing this field must be reflected when the active project's diagnostic capabilities refresh; removing it removes the Test button and adding it restores the button without restarting Orqeto.
- The custom validation schema is deliberately narrow:

```json
{
  "orqetoDev": {
    "validation": {
      "lintFix": "npm run lint:fix",
      "test": "npm test"
    }
  }
}
```

  Only `lintFix` and `test` are recognized. Do not add custom `typecheck` or `lint` execution here: Type Check and ESLint remain standardized Orqeto diagnostics. Do not infer commands from conventional `scripts.lint`, `scripts.lint:fix`, `scripts.test`, or similarly named npm scripts.
- A custom Lint Fix/Test command is arbitrary project shell code. Each distinct configured command requires an explicit command-specific approval once per app session, even when the project root has already been trusted for internal TypeScript/ESLint execution. The confirmation must show the exact command and must be rendered by Orqeto's in-app confirmation dialog rather than an operating-system permission dialog. Backend execution re-reads current project configuration, uses the canonical root as `cwd`, keeps stdin closed, disables color where possible, applies the existing bounded output/runtime policy, and terminates the process tree on timeout where the platform supports it. While Lint Fix/Test executable work is active, the loading overlay must expose the normal cancellation action (labelled only **Cancel** / **Cancelar**). Cancelling marks the frontend operation discarded immediately and signals the backend operation token so the active process tree is terminated. No validation context/history/auto-copy result may be published from that cancelled run. Internal fallback Lint Fix is covered too and attempts rollback if cancellation is observed after fallback writes begin. Arbitrary custom Lint Fix cancellation is not equivalent to Undo and cannot promise to revert filesystem mutations already performed by the custom command.
- A custom command that starts successfully and exits non-zero is a completed validation with issues, not an operational failure. Orqeto preserves stdout and stderr in separate sections and wraps them with command, exit code, duration, and completion status. Spawn failure, timeout, output-limit failure, trust refusal, or invalid/missing configuration are operational failures instead.
- Custom Lint Fix/Test output becomes an AI-usable validation context. It supports Copy and Download, follows **Copy automatically after generating reports**, and is persisted in the unified per-project Context history under its own typed history kind. The raw command output must be preserved rather than semantically reinterpreted.
- Internal fallback Lint Fix also generates a compact validation context describing changed files and remaining diagnostics, with the same Copy/Download, auto-copy, and Context-history behavior. ESLint remains a separate action so the user can generate the standard residual ESLint report after automatic fixing.
- Any completed Lint Fix invalidates prepared Commit, TypeScript, ESLint, and Full-project scan/export state because those artifacts may refer to pre-fix bytes. Manual Custom Context membership remains valid because it is reference-only and materializes current bytes at export time.
- **BR-DIAG-001:** Type Check and ESLint are fixed Orqeto diagnostics; Lint Fix uses explicit `orqetoDev.validation.lintFix` when configured and otherwise falls back to the safe internal ESLint fixer; residual ESLint reporting remains separate.
- **BR-DIAG-002:** Test exists only through explicit `orqetoDev.validation.test`; capability refresh must add/remove the button dynamically, and package configuration must not customize Type Check/ESLint.
- **BR-DIAG-003:** Custom validation commands are command-specific-trust-gated and bounded; their stdout/stderr, command, exit code, duration, and status form a persistent Copy/Download/auto-copy validation report, and non-zero exit is a reportable result rather than an execution failure.
- **BR-DIAG-004:** Lint Fix and Test are cancellable during active execution; cancellation requests backend process-tree termination and the cancelled run must not publish a validation report.
- Projects that expose `orqetoDev.validation.test` must make it the single aggregate automated-test entry point expected by Orqeto. The project's own AI-maintenance documentation (preferably `docs/AI.md`) must state that every automated suite required for final validation is reachable through that command and that adding/removing/renaming required suites also updates the aggregate command. Orqeto Dev itself uses `npm test` for this purpose.
- capability detection is scoped per project and only the active project tab refreshes diagnostic/custom-command capabilities when the app regains focus or relevant Orqeto work completes; inactive tabs keep their logical state without repeating filesystem discovery on every global focus event. One project must never cause validation actions to appear for another project.
- internal diagnostic execution uses the project's locally installed `typescript` / `eslint` package through Node. Since these local JavaScript entry points and ESLint configuration/plugins can execute project code, the first internal diagnostic or fallback Lint Fix for a root in each app session requires explicit user trust; the backend also rejects execution unless that approval is supplied. This root trust uses the same in-app confirmation system, is remembered only for the lifetime of the current app process, and must be requested again after restart. Historical reapply warnings also use the in-app dialog instead of the native OS message API.
- resolved TypeScript/ESLint entry points must canonicalize to a path still inside the selected project root; symlink/reparse-point escapes are rejected.
- diagnostic and custom validation subprocesses have bounded runtime and captured-output limits; timeout handling terminates the launched process tree where the platform permits it, and exceeding either bound fails explicitly.
- TypeScript reports include every parsed TypeScript error for each selected file plus supported global diagnostics.
- ESLint reports prioritize files containing errors when the file limit truncates the report; every selected file retains all of its messages, including warnings.
- Settings persists one global diagnostic-file limit shared across tabs. The default is **20 files** and valid values are **1 through 100**. This limit counts files, never individual diagnostic messages.
- Settings also persists the global **Copy automatically after generating reports** preference, defaulting to enabled. It applies to Commit, TypeScript, ESLint, Lint Fix, and Test reports: successful generation copies the freshly produced report once, clipboard failure is explicit without discarding the report, and the manual Copy action remains available.
- selected diagnostic source files are filtered again through `.orqeto-devignore` before they are embedded. File and aggregate content-size limits remain mandatory.
- Full-project, Commit, TypeScript, ESLint, Lint Fix, Test, and Custom/manual outputs share one persistent per-project Context history. Every entry records its context kind and exact finalized text, subject to the configured Context-history count limit plus the existing per-entry/per-project byte ceilings. Commit and validation reports are archived once generation succeeds; Custom/manual content is archived after successful Copy/Download and complete Clear; Full-project content is archived when Copy/Download materializes the scanned snapshot. Full-project Copy/Download require the explicit Scan result, reuse its filtered relative-path snapshot, and apply the current Paths-only choice. Export still revalidates/materializes the scanned paths against the current filesystem and `.orqeto-devignore`; stale bytes are never cached by Scan. Download sends only the scanned relative-path set across the frontend boundary, then materializes, formats, writes, and archives it inside the Rust backend so the largest report does not make an avoidable Rust→React→Rust giant-string round trip.
- all generated AI instructions continue to follow the active Files/Git work-mode contract.

### Development log execution

A project may opt into one long-running development process through the root `package.json` only:

```json
{
  "orqetoDev": {
    "logs": {
      "development": "npm run dev"
    }
  }
}
```

Rules:

- `orqetoDev.logs.development` must be a non-empty explicit string. Never infer monitoring from `scripts.dev` or another conventional package script. The **Logs** project mode is exposed only while that explicit capability exists.
- Starting logs is arbitrary project shell-code execution. The frontend confirmation shows the exact command, trust is retained only for that exact root+command during the current Orqeto session, and the backend re-reads configuration and independently rejects execution without matching approval. Execution uses the canonical project root as `cwd`, closed stdin, piped stdout/stderr, and the existing cross-platform process-tree boundary.
- stdout and stderr must be continuously drained off the UI/event thread. Captured messages pass through the same unstructured secret-redaction boundary before being retained. Backend storage is bounded by both entry count and aggregate bytes; an oversized single unterminated stream chunk is split. Reaching a limit discards oldest retained entries and marks the export/list as truncated rather than allowing unbounded memory growth.
- The development process is intentionally independent from normal Orqeto workspace busy state so editing, Context, validation, and Apply workflows remain usable while it runs. The active Logs view polls snapshots in small batches; inactive tabs do not poll, but backend capture continues. Poll requests must not overlap, and Clear/Start must ignore stale in-flight snapshots so cleared output cannot reappear.
- **Stop** requests termination of the complete launched process tree and waits for the session to stop. Changing/closing the root, closing the tab, and application shutdown must also stop the owned development process so no hidden child survives the Orqeto lifecycle.
- **Copy logs** formats a fresh retained-buffer snapshot plus command/start metadata and writes it to the clipboard. The persisted global `clear_logs_after_copy` preference defaults to `true`; only a successful Copy may trigger that automatic clear, and the backend clears only through the exact copied sequence so output arriving during clipboard work is preserved. **Download** writes a fresh retained-buffer snapshot and never clears. Manual **Clear** clears the retained buffer without stopping the process; subsequent output continues into a fresh list.
- **BR-LOG-001:** Development-log execution is explicit-only, exact-command trust-gated, canonical-root scoped, background captured, process-tree stoppable, secret-redacted, and bounded.
- **BR-LOG-002:** The Logs UI exposes Start/Stop/live list/Copy/Download/Clear; Copy-clear is a persisted default-on preference, inactive tabs stop polling without stopping capture, and project/application lifecycle closes owned log processes.

### Global loading and interaction blocking

Startup and long-running operations must never look frozen or allow conflicting UI actions. `index.html` provides a dependency-free boot spinner before React mounts. After React commits, the application uses a global modal-style loading overlay for project initialization and long-running operations such as context collection/generation, diagnostics, Apply/Undo, Dev Ignore updates, routing analysis, and VS Code extension install/update.

Interaction blocking begins immediately when the operation starts; the visual operation spinner may be delayed briefly to avoid flicker for work that completes almost instantly. User-decision states such as project/destination selection and Git patch preview are not background loading and must remain interactive. When routing transitions from analysis into one of those decision states, the loading overlay must be removed immediately rather than waiting for its minimum-visible timer. After the user confirms, the decision dialog closes and normal Apply loading feedback may resume while mutation runs.

### Authoritative operation outcomes and top status

User-visible operation results are rendered from one structured outcome contract instead of optimistic strings inferred independently by the UI. An outcome carries a stable operation ID, operation type, project root, semantic status (`success`, `partial`, `no_op`, `cancelled`, `failed`, or `blocked` where applicable), semantic counters, warnings/failures, and an optional exact Undo reference. Backend mutation commands own the filesystem result and operation identity; frontend aggregation is allowed only for explicitly defined batch workflows.

Context outcome rows distinguish added, already-present, removed, not-present, filtered/skipped, materialized, and currently unavailable members. Files Apply distinguishes created, edited, deleted, unchanged/already-applied, rejected, and skipped files. Git Apply uses the same filesystem categories plus added/deleted line counts. Apply directory counters describe the affected directory hierarchy as **affected folders**; they must not claim that directories were physically created or deleted merely because files beneath them changed.

A no-op never carries an Undo reference. Only the owning project presents its ordinary operation status and persistent Undo history; no cross-project switch or routed Undo banner is generated. An internal Files destination decision or Git preview is not reported as a completed Apply. All outcome/status labels and representative singular/plural forms exist in both `pt-BR` and `en`. Project-local feedback uses one shared notice channel. Dev Ignore must not maintain a second independently rendered notice state beside the workspace notice: a new Dev Ignore, Apply, Context, validation, or other project action replaces the previous local banner so only the latest project action is visible.

### Idle/performance invariants

Idle operation must avoid recurring expensive project work. Apply preparation performs filesystem work only for the initiating project, with no cross-tab scans; CPU/resource ceilings continue to use the shared conservative backend policy. Manual Context freshness remains on-demand and never adds periodic content hashing/scanning. Context history lists remain metadata-only and history Download resolves only the requested blob in the backend.

**BR-PERF-005 — production frontend chunking:** reduce oversized output structurally rather than hiding Vite diagnostics. Vite 8/Rolldown `output.codeSplitting` groups third-party `node_modules` code into vendor chunks with a 350,000-byte `maxSize` target; do not raise `chunkSizeWarningLimit` merely to silence an oversized-chunk warning. This is an output-layout optimization only and must not remove application behavior or supported dependencies.

## 22. Maintenance priorities

When choosing between technically equivalent solutions, prioritize:

1. project path and data safety;
2. predictable and explicit behavior;
3. preservation of existing functionality;
4. simple UX;
5. small, testable changes;
6. size/runtime without sacrificing required compatibility;
7. documentation consistent with the implementation.

Business-rule changes that materially affect AI delivery contracts, current-project Apply routing, validation behavior, application safety, or Undo behavior must be kept synchronized in `README.md`, this canonical `docs/AI.md`, and `docs/docs.md`. These documentation files are written in English even though the application UI supports both Portuguese and English.

## 23. Business-rule verification

High-value behavior and safety invariants use stable `BR-*` identifiers and executable regression tests. The permanent rule registry lives in `scripts/business-rules/registry.mts`. A rule enters the active registry only when the implementation that satisfies it exists in the same repository state.

Use these commands during maintenance:

```bash
npm run test:business:contracts
npm run test:business:rust
npm run test:business
npm run verify:business
```

`verify:business` checks synchronized version metadata and then runs the complete active business-rule test suite. It does not run formatting fixes. `npm run verify:patch` is the normal maintenance gate and runs TypeScript type checking, `lint:fix`, and `verify:business` in that order. `npm run test:adversarial` reruns the hostile final Node/Rust safety suite, and `npm run verify:final` combines both gates for release-candidate hardening.

Current baseline rule IDs introduced with the verification harness:

- **BR-CTX-001** — active manual Context long-lived selection state keeps path membership and does not retain supplied source content;
- **BR-CTX-002** — re-adding an already selected path reports it as already present and does not replace selection state with newly supplied content;
- **BR-CTX-003** — re-sending a selection may add newly discovered paths while preserving deduplication of already-selected paths;
- **BR-CTX-004** — materialization reads current filesystem bytes rather than treating selection-time bytes as authoritative;
- **BR-CTX-005** — selection discovers path membership without opening or decoding regular source-file bodies;
- **BR-CTX-006** — missing or newly ignored selected members are reported unavailable at materialization and stale selection-time bytes are never substituted;
- **BR-CTX-007** — files created later under a previously selected folder remain unselected until that folder/file is explicitly sent again;
- **BR-CTX-008** — manual Clear remains usable when selected paths are unavailable, skips incomplete history snapshots, and clears the active selection with partial feedback;
- **BR-CTX-009** — Commit/TypeScript/ESLint generation auto-copies by default without removing manual Copy or discarding prepared output on clipboard failure;
- **BR-CTX-010** — Full-project context discovery is explicit: entering Full mode performs no automatic traversal, Scan records the filtered path snapshot/count/size, and Copy/Download remain unavailable until that scan exists;
- **BR-HISTORY-001** — routine Context-history listing returns metadata only and excludes archived text blobs;
- **BR-HISTORY-002** — one archived Context snapshot is loaded lazily and reproduced exactly when requested;
- **BR-HISTORY-003** — routine React history state is metadata-only and Copy lazily retrieves only the selected snapshot;
- **BR-HISTORY-004** — history Download resolves archived content in the Rust backend instead of routing the blob through React state;
- **BR-HISTORY-005** — applied-source history keeps a human-readable origin plus content fingerprint, requires confirmation before an older retained source is reused, and recognizes a newest repeated Git patch as already applied only while its recorded post-apply state still matches;
- **BR-HISTORY-006** — Custom/manual, Commit, Full-project, TypeScript, Lint Fix, ESLint, and Test outputs share one persisted typed Context history per project, bounded by the configured history limit and existing byte ceilings;
- **BR-HISTORY-007** — committed Files/Git application history and exact Undo snapshots survive normal app restart and project-tab close/reopen, while no-op work still creates no entry;
- **BR-HISTORY-008** — Context history is exposed once beside Create context without reserving a repeated bottom row, and Custom Copy/Download/Clear stay in one horizontal action row;
- **BR-RES-001** — a bounded traversal accepts work exactly at its configured file/directory/entry ceilings;
- **BR-RES-002** — the first file, directory, entry, or overlong path beyond a configured traversal ceiling is rejected explicitly;
- **BR-RES-003** — large-project discovery ceilings are 500,000 files, 1,000,000 directories, and 1,500,000 combined entries;
- **BR-RES-004** — each large-project ceiling succeeds exactly at the limit and rejects limit+1 without retaining project contents;
- **BR-RES-005** — machine resource policy caps background I/O worker planning and stream-buffer size even on very large machines;
- **BR-RES-006** — generated scale tiers exercise 1k/10k/50k/100k/500k files and 10k/100k/500k/1M directories with constant-size budget state;
- **BR-SCAN-001** — a routing branch that cannot be inspected fails closed instead of being treated as absence of a candidate;
- **BR-SCAN-002** — directory-source traversal is iterative rather than recursive, so deep trees do not consume the call stack;
- **BR-ROUTE-001** — repeated basename discovery cannot cause unbounded candidate-by-file validation; excessive cheap candidates become explicit ambiguity with no automatic recommendation.
- **BR-ROUTE-002** — root-relative ZIP routing requires strong no-prefix exact file-path coverage; that exact ROOT mapping outranks source-prefix relocation inside one project, while generic directory overlap remains weak evidence within the selected project.
- **BR-ROUTE-003** — both Files and Git Apply prepare the initiating project only, never another open tab.
- **BR-ROUTE-004** — one archive-name top-level ZIP envelope may be stripped onto project ROOT when the stripped paths have strong exact-file coverage; zero-file generic directory overlap from that wrapper is not sufficient for automatic placement.
- **BR-ROUTE-005** — the project-level selector is removed; only internal path ambiguity can require a destination dialog.
- **BR-STATUS-007** — project-local action feedback has one banner channel; newer Dev Ignore/Apply/Context/validation feedback replaces the prior local notice instead of stacking another message;
- **BR-STATUS-008** — cancellable validation work has a dedicated client operation-ID namespace without widening authoritative user-visible outcome types;
- **BR-ROUTE-006** — dropping a supported payload on a rooted project tab invokes Apply under the current Files/Git mode with routing locked to that tab; the normal Apply zone also stays on its owning tab, and actionable drop surfaces expose copy/drop cursor feedback.
- **BR-ROUTE-007** — destination ambiguity above the backend limit blocks Apply; in-project choices and ROOT fallback do not bypass this limit.
- **BR-ROUTE-008** — invalid Files input and manifest preparation errors in the initiating project are propagated instead of reported as missing destinations.
- **BR-FILE-001** — Files Apply uses the exact frozen bytes that passed final validation even if the original external source changes afterward;
- **BR-FILE-002** — a source change between preview and final freeze invalidates the preview before project mutation;
- **BR-FILE-003** — changed routing evidence invalidates the preview before Files Apply mutation;
- **BR-FILE-004** — an unchanged-only frozen Files Apply remains a true no-op and creates no mutation snapshot;
- **BR-FILE-005** — reapplying the same byte-identical ZIP reports every entry unchanged even when decompressor and destination reads use different chunk boundaries;
- **BR-FILE-006** — `.orqeto-dev-delete.json` accepts safe existing folder paths, recursively deletes their protected tree without enumerating descendants in the manifest, and exact Undo/recovery restores files plus empty folders;
- **BR-CTX-011** — Context emission redacts env-like values, strongly sensitive config fields, URL credentials/query secrets, and high-confidence token signatures before content is exposed to AI, including Git Commit Context.
- **BR-CTX-012** — AI-delivered Apply never mutates detected secret-bearing files: Files mode skips protected files and reports counts, while Git mode rejects a patch that touches protected secret material; prompts/protocol mark redacted files as informational only.
- **BR-FS-001** — checked atomic replacement refuses to overwrite a destination changed immediately before commit;
- **BR-FS-002** — project parent directories are created beneath the canonical root using component-level symlink/reparse and canonical-parent validation;
- **BR-STAGE-001** — Files Apply staging is fresh, random, operation-scoped, and non-reparse;
- **BR-STAGE-002** — Windows virtual-drop staging uses fresh GUID-backed atomic directories instead of predictable tick/counter paths;
- **BR-STORAGE-001** — storage reservations enforce project/global quotas, soft-GC thresholds, and real free-space margin before mutation;
- **BR-STORAGE-002** — exact Undo/recovery bytes use content-addressed shared blobs that remain live until their final snapshot reference is gone;
- **BR-STORAGE-003** — merged Files-mode Undo entries prune intermediate blob references that are no longer required to restore the merged batch;
- **BR-GC-001** — GC never selects active Undo, active staging, or recovery-critical storage;
- **BR-GC-002** — stale-storage cleanup refuses symlink/reparse escape paths;
- **BR-GC-003** — an active temporary descendant protects its containing managed subtree from GC;
- **BR-RECOVERY-001** — recovery-critical snapshots and their referenced blobs survive normal GC;
- **BR-RECOVERY-002** — multi-step Undo is itself recoverable and restores sequential replacements to the exact original state;
- **BR-RECOVERY-003** — an injected mid-Apply failure rolls recorded partial mutation back to the exact pre-Apply state;
- **BR-RECOVERY-004** — an injected mid-Undo failure rolls the partial Undo back and leaves the same exact Undo retryable;
- **BR-RECOVERY-005** — content-addressed recovery blobs are revalidated against their hash/permission identity and no-follow managed path before use;
- **BR-RECOVERY-006** — if a crash occurs after an atomic file commit but before its per-file applied flag is persisted, recovery proceeds only when the destination exactly matches the journaled Orqeto after-state;
- **BR-UNDO-001** — Created/Modified/Deleted state is represented precisely enough to restore a mixed operation exactly;
- **BR-UNDO-002** — user edits after Apply block Undo rather than being overwritten;
- **BR-UNDO-003** — a destination edit racing with the final restore commit is revalidated and preserved instead of being overwritten.
- **BR-STATUS-001** — an authoritative Files Apply backend result maps to exact top-status counters while preserving the backend operation identity;
- **BR-STATUS-002** — mixed changed/unchanged/failed work is partial rather than unconditional success;
- **BR-STATUS-003** — a no-op Files Apply never exposes contextual Undo;
- **BR-STATUS-004** — contextual Undo is eligible only while its exact operation ID remains the newest Undo entry;
- **BR-STATUS-005** — Apply directory rows use affected-folder semantics and representative 0/1/many grammar in both locales;
- **BR-STATUS-006** — routed Files/Git destination/preview states use decision/review messages and do not claim Apply before completion.
- **BR-VSCODE-001** — VS Code liveness uses published process identity plus cheap adaptive refresh, never a permanent PowerShell/CIM process scan;
- **BR-VSCODE-002** — forwarded VS Code commands revalidate the live published instance and authoritative project state when execution begins;
- **BR-VSCODE-003** — VS Code Context actions remain mode-independent for every open non-busy project, then focus the owning tab and switch it to Project > Custom before add/copy/remove;
- **BR-DIAG-001** — Type Check and ESLint remain standardized Orqeto diagnostics while Lint Fix prefers explicit `orqetoDev.validation.lintFix` and otherwise uses the safe internal fallback;
- **BR-DIAG-002** — Test exists only when `orqetoDev.validation.test` is explicitly configured, refreshes dynamically, and project configuration cannot override Type Check/ESLint report generation;
- **BR-DIAG-003** — custom Lint Fix/Test commands require exact-command session trust and preserve bounded stdout/stderr plus exit metadata as persistent validation context, including non-zero diagnostic results;
- **BR-DIAG-004** — active Lint Fix/Test execution can be cancelled; the backend receives a cancellation token, stops the process tree where applicable, and the cancelled run is not published as Context;
- **BR-DIAG-005** — execution trust and historical reapply warnings use Orqeto in-app confirmations, with root and exact-command trust retained only for the current app session;
- **BR-LOG-001** — development logs run only from explicit `orqetoDev.logs.development`, require exact-command session trust, capture/redact bounded stdout/stderr off the UI thread, and terminate the launched process tree on Stop;
- **BR-LOG-002** — Logs exposes Start/Stop/live output/Copy/Download/Clear, Copy-clear defaults on and persists globally, inactive tabs stop polling without stopping capture, and root/tab/app lifecycle stops owned log processes;
- **BR-DOCS-001** — permanent business documentation lives at `docs/docs.md`, and project AI documentation defines the single aggregate Test command contract;
- **BR-DOCS-002** — the mirrored business-rules references stay synchronized and permanent docs cover conditional AI test integration, in-app execution trust, repeated-ZIP no-op semantics, and button hover affordance;
- **BR-PERF-001** — inactive tabs do not refresh diagnostic capability discovery on every global focus event;
- **BR-PERF-002** — Apply performs no filesystem analysis across other open project tabs;
- **BR-PERF-003** — full-project Download stays in the backend and avoids a giant Rust→React→Rust content round trip;
- **BR-PERF-004** — routine VSIX packaging does not reinstall dependencies and the release build avoids duplicate app TypeScript compilation;
- **BR-UI-001** — Folder, Context, and Apply expansion state plus the selected project-folder action are persisted globally and shared across every project tab.
- **BR-UI-002** — routing/destination/Git-preview decision dialogs suppress loading overlays while awaiting input, live outside the inert busy-content subtree, and remain immediately interactive.
- **BR-UI-003** — every enabled button exposes pointer and visible hover affordance on hover-capable fine-pointer devices without styling disabled buttons as interactive;
- **BR-UI-004** — shared in-app dialogs provide modal semantics, Escape cancellation, keyboard focus trapping, and previous-focus restoration.
- **BR-ADV-001** — a 50,000-path manual Context membership remains reference-only and small materialization subsets do not require cached project source blobs;
- **BR-ADV-002** — race defenses revalidate Context root/membership revisions, `.orqeto-devignore` routing evidence, overlapping-root access, and exact contextual Undo identity;
- **BR-ADV-003** — injected snapshot/journal/temp-write/commit/recovery failures fail closed without losing the pre-operation or externally modified state;
- **BR-ADV-004** — the final Files/ZIP/delete-manifest path corpus rejects traversal/absolute/unsafe aliases while safe Unicode relative paths remain supported;
- **BR-ADV-005** — strict Git validation rejects binary, copy, mode, symlink, submodule, traversal, quoted, and backslash path forms forbidden by the delivery contract;
- **BR-ADV-006** — permanent docs describe the final implementation, final adversarial commands are wired, and ZIP support remains part of the Rust dependency contract.

Tests should prefer observable behavior and safety invariants over incidental implementation details. Static contract tests may verify the rule registry, required npm commands, documentation wiring, and test evidence, but runtime behavior must be covered by Node/TypeScript or Rust tests when the rule has executable behavior. Final adversarial validation deliberately reuses cumulative earlier rules for scale ceilings, repeated-basename routing, deep iterative traversal, storage pressure, race coordination, recovery rollback, and ZIP compatibility rather than maintaining weaker duplicate implementations.

For Windows runtime measurements, `npm run benchmark:runtime -- --pid=<orqeto-pid> --seconds=10 --label=<label>` samples normalized idle CPU plus working/private memory. Use the same build/machine to record 1/10/20-tab samples and the VS Code-active idle case. After `npm run build`, `npm run benchmark:release-size` reports available release binary/installer sizes for comparison with any retained baseline. These measurements are release evidence; they never relax Apply/Git/Undo validation or ZIP compatibility.

- **BR-FILE-007** — Permanent generated-directory deletion requires separate in-app consent, backend validation of disposable directory names/root/symlink and sensitive entries, and bypasses storage/Undo exclusively for those explicitly confirmed folders. Normal and permanent deletion paths must not overlap.
