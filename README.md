# Orqeto Dev

**Orqeto Dev** is a desktop application for turning local projects into structured AI context and safely applying code changes back to the project.

It was designed to reduce the manual work between the editor, file system, and AI assistants: you select a project, build the required context, send that context to the AI, and then apply the files or patches you receive directly to the correct project structure.

> Windows-first, built with Tauri v2, Rust, React, and TypeScript.

## Key features

Orqeto Dev shows a lightweight loading spinner from the first HTML frame and uses a dimmed global loading overlay for long-running operations. While that work is active, the main UI is temporarily inert so conflicting clicks, drops, tab changes, or Settings actions cannot race the operation. User-decision dialogs remain interactive when the app is waiting for a project, destination, or patch confirmation; the routing loader is removed immediately while those dialogs await input and resumes only after confirmation when work continues.

### AI context

- Add files and folders by drag and drop.
- Recursive directory reading.
- Accumulated context selection per project, stored as ROOT-relative paths. Adding files/folders discovers membership without reading regular source-file bodies; Copy/Download rereads the current file contents so selected context never becomes stale.
- Filter by **file name** or **path**, using:
  - contains;
  - exact;
  - regex.
- The same filter is respected when both **adding** and **removing** files from the context.
- Recent filter history per project.
- **Paths only** mode, useful for sharing the structure without sending file contents.
- Support for UTF-8, UTF-8 with BOM, and UTF-16 with BOM content.
- Non-text files can be safely ignored in normal mode.
- Copy to clipboard and export to `.txt`, with fresh on-demand materialization and structured status counts for files/folders added, already selected, skipped, removed, or unavailable. Partial live exports are reported explicitly; auto-clear preserves the selection whenever any selected item is unavailable.
- Manual **Clear** remains available when a selected path has disappeared or become ignored. Orqeto clears the selection but skips creating a partial history snapshot and reports that condition explicitly.
- Persistent history of finalized contexts. The history list keeps only lightweight metadata in the UI; exact archived text is loaded only for the selected Copy action, while Download resolves and writes the snapshot in the backend.

### Work modes

Orqeto Dev has one **global, persisted work mode** so every open tab follows the same delivery contract with the AI.

- **Files mode** keeps the original workflow: context instructs the AI to return complete files or an incremental ZIP, and **Apply code** accepts files, folders, and ZIP archives.
- **Git mode** instructs the AI to return one textual `.patch` or `.diff` as a Git unified diff compatible with `git apply`. In this mode, **Apply code** accepts only one `.patch`/`.diff` at a time and can route it only to open project roots that belong to Git repositories.
- Switching modes changes the generated AI instructions immediately, but does not discard the existing temporary Undo history.
- Settings also provides **Copy AI prompt**. The copied prompt is generic, follows the selected UI language, and explains the active Files/Git delivery contract to any AI assistant.

### Git commit context

When the selected project belongs to a Git repository, Orqeto Dev can generate an AI-ready commit report directly from the current working tree.

- Uses the local Git CLI and does not modify the index or working tree. Git-side executable helpers used by `core.fsmonitor`, external diff drivers, and textconv are disabled for report generation.
- Git subprocesses have bounded output and a 5-minute runtime limit. The complete report is also bounded to 50,000 changed/untracked files and 128 MiB of aggregate text content.
- Includes Git status plus staged and unstaged diffs for the selected project root.
- Includes the contents of small text files that are still untracked; binary, non-text, or large untracked files remain represented by path and size.
- Adds instructions asking the AI to produce a clear commit message, preferring Conventional Commits when appropriate.
- The report can be copied to the clipboard or downloaded as a `.txt` file.
- If the repository is clean, Orqeto Dev reports that there is nothing to commit.

### Project and diagnostic contexts

The project-folder section can also generate focused AI contexts without changing the project's normal accumulated Context selection.

- **Full project context** reads the selected root through the normal safe context collector and respects `.orqeto-devignore`. It reuses the normal file-name/path filters and **Paths only** option without showing the manual add/remove drop zones. Copy materializes the filtered result for the clipboard, while Download sends the filtered relative paths to the backend, where the report is materialized, formatted, and written without duplicating the complete content payload across the frontend IPC boundary.
- **TypeScript context** appears only when the open project contains a `tsconfig*.json`. It runs the project's locally installed TypeScript compiler directly, groups diagnostics by file, includes every diagnostic from each selected file, and embeds the selected source files.
- **ESLint context** appears only when the open project contains an ESLint configuration (`eslint.config.*` or supported `.eslintrc*`). It runs the project's locally installed ESLint directly and builds the same AI-ready file/error context.
- Diagnostic contexts do not execute arbitrary `package.json` scripts. They use the project's local `node_modules` tool installation and bounded process output/runtime. Because local TypeScript/ESLint JavaScript and ESLint configuration/plugins can execute project code, the first diagnostic run for a project in each app session requires an explicit trust confirmation.
- Tool entry points are canonicalized and must remain inside the selected project root.
- Settings controls how many files with diagnostics are embedded per report: **20 by default**, configurable from **1 to 100 files**. The limit is per file, not per error; files containing errors are prioritized, and all diagnostics (including warnings) from every selected file are kept.
- Diagnostic source files excluded by `.orqeto-devignore` are not embedded in the report.

### Multiple projects

- Multiple projects can remain open in independent tabs.
- Tabs can be reordered.
- While dragging files, folders, or ZIPs from the file system, hovering another tab briefly activates it without ending the drag.
- **Apply code** can route incoming changes across the open tabs when exactly one safe destination exists globally. Ambiguous routing is always resolved by the user.
- Each tab keeps its own:
  - root folder;
  - context selection;
  - filter;
  - code application queue;
  - undo session.
- Tab order and active project are persisted in SQLite. The Folder/Context/Apply collapse state is one persisted global preference shared by every tab, so collapsing or expanding a section updates all open projects at once.

### Apply code

Orqeto Dev also handles the reverse workflow: it receives code produced externally and applies it using the currently selected global work mode.

**Files mode**:

- accepts files, folders, and ZIP archives;
- analyzes destination candidates across all open project tabs using the same confidence/recommendation rules as the existing in-project resolver;
- treats generic directory overlap in root-relative multi-file ZIPs as weak evidence; once the exact ROOT mapping has strong strict-majority file-path coverage it outranks source-prefix relocation candidates inside that project, while equally strong exact matches in different open projects remain explicit ambiguity and the original project root remains a safe fallback;
- gives a unique strong no-prefix exact ROOT-relative match priority over relocated/context-only candidates in other projects, including incremental ZIPs where most files already exist and the remaining file is new;
- treats a project as internally unambiguous when that resolver has one safe recommended destination, even if weaker alternatives were discovered;
- outside the strong exact-ROOT precedence case above, applies automatically only when there is exactly one safe resolved destination globally and no project still has unresolved internal ambiguity;
- when multiple resolved projects or unresolved project destinations are possible, first asks which project to use and then reuses that project's existing internal destination resolver when needed;
- whenever routing is not globally unambiguous, keeps **Apply at the root of the original project** available when that root destination is safe;
- when no project has a concrete match, falls back to the existing confirmation for the original project root;
- compares replacement contents byte-for-byte before writing; if the received code is already identical and there are no other changes, no snapshot/history entry is created and the app reports that the code was already applied;
- enforces `.orqeto-devignore` again at final write/delete planning, including explicit root placement and deletion manifests;
- after the user confirms Apply, freezes the current external source into a fresh private random staging directory, verifies stable before/frozen/after fingerprints, recomputes the final source/routing fingerprints from that exact frozen representation, and mutates the project only from those staged bytes;
- creates missing project parent directories component-by-component beneath the canonical root, rechecks destination/path state immediately before commit, and preserves a concurrently changed destination instead of overwriting it;
- supports directory/project discovery up to 500,000 files, 1,000,000 directories, and 1,500,000 combined entries per operation, while keeping output/materialization limits separate; routing fails closed on incomplete filesystem evidence and bounds expensive candidate validation;
- supports explicit deletions through `.orqeto-dev-delete.json`.

**Git mode**:

- accepts one textual UTF-8 `.patch` or `.diff` at a time;
- tests the complete patch, read-only, against every compatible open Git project and routes automatically only when exactly one project passes strict validation;
- if more than one project accepts the whole patch, asks only which project to use because the paths are already declared by the diff;
- if no open project accepts the whole patch, rejects it without offering a root-placement fallback;
- requires Git and applies only to a target project root inside a Git work tree;
- uses strict `git apply --check` validation before anything is changed;
- validates every affected path against the selected Orqeto root and `.orqeto-devignore`;
- shows a preview with created, modified, deleted, and renamed files plus line statistics;
- freezes the patch bytes used for preview/check/application, fingerprints those exact bytes, and refuses a changed patch source before application;
- runs patch statistics/check/application in an isolated Git-apply environment that cannot inherit repository/user whitespace tolerance or executable clean/smudge filter drivers, simulates the expected post-apply state before mutation, and requires the real result to match it exactly;
- does not use `--3way`, automatic whitespace tolerance, binary patches, symlinks, submodules, Git copy operations, or permission/mode-changing patches;
- never runs `git add`, `commit`, `reset`, `checkout`, `restore`, or `clean`.

Both modes use the same Orqeto safety snapshot and **Undo** system. Git entries are identified in the history by patch name and line statistics, and history remains available when switching work modes. Undo restores the exact pre-application working-tree state captured by Orqeto rather than using Git reset/checkout operations. Critical reads and writes are coordinated per canonical project root (including overlapping roots); Files Apply freezes its final source before mutation, validates routing against that frozen input, and never rereads the original external source for project writes; Windows project paths reject reserved devices, alternate-data-stream syntax, trailing dot/space aliases, and ambiguous existing short-name spellings; file replacements validate completed temporary content and revalidate the destination immediately before durable atomic commit. Windows virtual-drop staging uses fresh GUID-backed directories instead of predictable reusable names. Orqeto-owned staging, Undo snapshots, recovery journals, and content-addressed backup blobs are managed by one backend storage authority with 10 GiB per-project and 100 GiB global hard logical quotas, 80% soft-GC thresholds, real filesystem free-space checks, and pre-mutation reservations. GC can clean stale/rebuildable staging and unreferenced blobs but never active Undo/recovery-critical data; active temporary descendants protect their containing storage subtree, shared backup blobs remain until their final live reference is gone, and merged Files-mode Undo entries release superseded intermediate backups. Recovery/Undo revalidates shared blobs against their content identity and managed no-follow path before use and again immediately before the atomic restore commit. An on-disk recovery journal protects interrupted Apply/Undo operations. On startup, only the primary app instance performs recovery. If a crash happens after an atomic file commit but before the per-file applied flag is persisted, recovery treats that mutation as known only when the destination exactly matches the journaled Orqeto after-state. If recovery cannot prove that a file still matches an expected Orqeto state, the conflicting file and backup are preserved and further Apply/Undo mutations are blocked instead of guessing.

When routing changes the active project, Orqeto shows a prominent status message. Operation results use one structured outcome model with a stable operation ID/type/project, semantic status, exact counters, warnings/failures, and an optional Undo reference. Backend mutation results are authoritative: Files Apply reports created/edited/deleted/unchanged/rejected or skipped files, Git Apply adds line counts, Context/Dev Ignore use their own semantic counters, and Apply directory counts are explicitly labeled as **affected folders** rather than implying physical directory creation/deletion. No-op outcomes never expose Undo. After a successful routed application the message includes a contextual **Undo** action tied to that exact backend `operationId`; it runs only while that application remains the newest eligible Undo entry. If a project switch still requires internal destination resolution or Git preview confirmation, the message says so instead of claiming that code was already applied.

ZIP reading in Files mode preserves the compatibility provided by the library used by the project; build optimization does not remove supported codecs or formats.

The project-folder row uses explicit actions: **Change**, **Open in Explorer**, **Close**, and — only when VS Code is detected — **Open in VS Code**.

## VS Code integration

The project includes a companion extension for Visual Studio Code. Integration state is published per open project together with the current Orqeto process ID, so separate VS Code windows do not inherit another project's temporary mode. Extension liveness uses that published PID and an adaptive lightweight refresh cadence instead of a permanent 2-second PowerShell/CIM process scan.

For a VS Code workspace that belongs to a project currently open in Orqeto Dev, the Explorer context menu provides:

- **Send to Orqeto Context**, **Send and copy Orqeto Context**, and **Remove from Orqeto Context** during normal context work;
- **Send to Orqeto Dev Ignore** and **Remove from Orqeto Dev Ignore** while that same project's Dev Ignore dialog is open.

**Send and copy Orqeto Context** first registers the full path selection, then rereads the current bytes for the complete selected set and copies that fresh context through the same export pipeline as the app Copy action. Context/Ignore actions are hidden when the corresponding project is not open in Orqeto Dev. The app remains authoritative at execution time, so a stale VS Code menu cannot route an action to the wrong mode or project. These actions use an acknowledged forward-only handoff: they never start a closed app, and the extension reports a delivery failure if the primary instance disappears during forwarding. Inside the primary instance, queued actions are acknowledged individually so a failure cannot silently drain later actions. Execution re-checks the current Context/Dev Ignore mode and workspace busy state; stale or busy actions fail visibly instead of being silently reinterpreted.

**Open in Orqeto Dev** is independent from Context/Ignore availability. It starts Orqeto Dev when necessary, opens a new project when the root is not open, and focuses the existing tab when the exact root is already open. By default, subfolders of an already open project do not offer the open action; this can be disabled globally in Settings.

The Windows Explorer **Open in Orqeto Dev** shell action follows the same startup/focus behavior.

### Installing the extension

The extension does not need to be published to the Marketplace to be used.

Orqeto Dev detects whether VS Code is available on the machine. Only when it is detected does the project-folder row expose **Open in VS Code**, and only then does Settings show the **VS Code** section. Availability is refreshed while the app is running and revalidated by the backend when an action executes.

In Orqeto Dev itself:

1. open **Settings**;
2. locate the **VS Code** section;
3. click **Install / update**.

The application installs the VSIX included in the bundle. If an older version is already installed, the same action updates it.

The extension version is synchronized with the application version.

## Theme and preferences

The application provides light and dark modes.

The theme uses global color tokens, and the preference is persisted in SQLite together with other global settings, such as:

- language;
- global work mode (`Files` or `Git`);
- automatically copy after adding context;
- clear after copying or downloading;
- history limits;
- Windows Explorer integration behavior;
- whether VS Code hides **Open in Orqeto Dev** for subfolders of already open projects.

The interface is available in Portuguese (`pt-BR`) and English (`en`). The selected language also determines the text protocol generated for the context.

## Project safety

Orqeto Dev prevents implicit changes outside the selected folder.

- Paths are canonicalized before relevant operations.
- Files outside the project root are rejected.
- Symlinks/junctions that escape the root must not allow external access.
- Removing from the **context** never deletes the real project file.
- Deletions during **Apply code** must be explicitly declared in the reserved manifest.
- Context collection is bounded by file, directory, per-file byte, and aggregate-byte budgets; oversized input is rejected instead of being read without limit.
- Git subprocess output is bounded and inherited `GIT_*` routing/configuration variables are removed before repository operations.
- Critical project mutations are refused while another mutation for the same root is running or while interrupted-operation recovery requires manual attention.

Deletion manifest format:

```json
{
  "format": "orqeto-dev-delete",
  "version": 1,
  "delete": ["src/old-file.ts"]
}
```

The manifest is patch metadata and is not copied into the project.

## `.orqeto-devignore`

Context collection and patch resolution respect the `.orqeto-devignore` file at the project root. Its syntax follows `.gitignore` behavior.

The project-folder row exposes **Dev Ignore** next to the root path. If the file does not exist, the first click creates it with practical defaults for dependency folders, generated builds, caches, editor metadata, and common development platforms. A later click opens the Dev Ignore dialog.

The dialog has a 60/40 add/remove layout. Dropping files or folders on the larger side adds exact ignore rules; dropping them on the remove side makes those paths available again, including explicit unignore rules when a broader default rule still covers a parent directory. Updates are serialized so concurrent external and local operations cannot reorder file changes. Status feedback reports changed versus already-in-state files and folders separately.

While this dialog is open, only the matching project's VS Code integration switches from Context actions to Dev Ignore actions. Closing the dialog immediately restores normal Context routing.

## Development

### Requirements

- Node.js `>= 22.12.0`;
- Rust toolchain compatible with the project;
- development dependencies required by Tauri for the operating system;
- Git, to generate commit context reports and use Git work mode.
- Visual Studio Code only if you want to test the companion extension.

### Installation

```bash
npm install
npm --prefix integrations/vscode install
```

The desktop app and the standalone VS Code extension keep separate dependency trees. Install both during setup (or use the equivalent `npm ci` commands in CI); routine `vscode:package`/build commands do not reinstall dependencies.

### Development

```bash
npm run dev
```

The command validates versioning, packages the VS Code extension, and starts Tauri in development mode.

### Validation

```bash
npm run validate
```

Runs type checking, formatting verification, and linting.

To apply automatic lint/format fixes:

```bash
npm run lint:fix
```

Critical product behavior also has an executable business-rule regression suite:

```bash
npm run verify:business
```

During coordinated maintenance patches, the convenience gate is:

```bash
npm run verify:patch
```

It runs TypeScript type checking, `lint:fix`, and the business-rule verification suite in sequence. Business-rule tests are cumulative: maintenance work must keep every accepted rule green.

The final hostile regression pass can be run explicitly with:

```bash
npm run test:adversarial
```

For a release candidate, the combined maintenance/adversarial gate is:

```bash
npm run verify:final
```

The adversarial suite covers generated scale ceilings, large reference-only Context membership, routing/path ambiguity, race revalidation, storage pressure, injected persistence/write/commit/recovery failures, Files/ZIP/delete-manifest path attacks, and strict Git unsupported-operation/path corpora. It intentionally keeps all earlier business-rule tests cumulative rather than replacing them with a separate weaker suite.

### Final performance measurements

Runtime benchmarks are intentionally opt-in because meaningful idle CPU/memory numbers require the real desktop process and representative open tabs. On Windows, sample the running Orqeto process with:

```bash
npm run benchmark:runtime -- --pid=<orqeto-pid> --seconds=10 --label=idle-1-tab
```

Repeat on the same machine/build for 1, 10, and 20 open tabs and with the VS Code extension active. After a release build, available executable/installer sizes can be listed with:

```bash
npm run benchmark:release-size
```

These measurements are evidence for performance review only; they do not disable ZIP codecs, strict Git validation, storage reservations, or Undo/recovery checks.

### Release build

```bash
npm run build
```

The build:

1. checks version synchronization;
2. validates the app TypeScript once plus formatting/linting;
3. generates the extension VSIX (without reinstalling its dependencies on every package command);
4. builds the frontend;
5. builds the Tauri/Rust binary;
6. generates the NSIS installer on Windows.

Tauri's release before-build hook performs only the Vite bundle, avoiding a second app TypeScript compilation after validation. Dependency installation belongs to setup/CI (`npm install`/`npm ci`), not routine VSIX packaging.

The installer uses LZMA compression. The Rust release profile is configured to prioritize binary size with LTO, `codegen-units = 1`, `opt-level = "s"`, `panic = "abort"`, and symbol stripping.

## Versioning

The root `package.json` is the source of truth for the product version.

To set a version:

```bash
npm run version:set -- 1.0.0
```

The script keeps the Tauri/Rust application metadata and the VS Code extension metadata synchronized.

To only verify:

```bash
npm run version:check
```

## Main structure

```text
.
├─ docs/
│  └─ AI.md
├─ docs.txt
├─ integrations/
│  └─ vscode/
├─ scripts/
├─ src/
├─ src-tauri/
├─ .orqeto-devignore
├─ package.json
└─ README.md
```

## Technical documentation

The architecture, behavior, and persistent context rules for AI-assisted maintenance are documented in [`docs/AI.md`](docs/AI.md). The root [`docs.txt`](docs.txt) provides a concise English business-rules reference for work modes, cross-project routing, strict Git patch application, and Undo behavior.

The current repository code remains the source of truth whenever documentation and implementation differ.
