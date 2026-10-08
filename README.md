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
- One persistent per-project history for finalized **Custom**, **Commit**, **Full project**, **TypeScript**, and **ESLint** contexts, bounded by the Context-history limit in Settings. The History control appears once beside **Create context** and opens without reserving a permanent row below each context mode. The list keeps only lightweight metadata (including context kind) in the UI; exact archived text is loaded only for the selected Copy action, while Download resolves and writes the snapshot in the backend. In Custom context, **Copy**, **Download**, and **Clear** remain one horizontal action row instead of becoming a multi-column grid.

### Work modes

Orqeto Dev has one **global, persisted work mode** so every open tab follows the same delivery contract with the AI.

- **Files mode** keeps the original workflow: context instructs the AI to return complete files or an incremental ZIP, and **Apply code** accepts files, folders, and ZIP archives.
- **Git mode** instructs the AI to return one textual `.patch` or `.diff` as a Git unified diff compatible with `git apply`. In this mode, **Apply code** accepts only one `.patch`/`.diff` at a time and can route it only to open project roots that belong to Git repositories.
- Switching modes changes the generated AI instructions immediately, but does not discard the persistent application/Undo history.
- Settings also provides **Copy AI prompt**. The copied prompt is generic, follows the selected UI language, explains the active Files/Git delivery contract, and documents the explicit `orqetoDev.validation` integration. It tells the AI not to invent tests and to add/update `orqetoDev.validation.test` only when the user explicitly asks for tests and the delivered change actually includes tests that Orqeto should run.

### Git commit context

When the selected project belongs to a Git repository, Orqeto Dev can generate an AI-ready commit report directly from the current working tree.

- Uses the local Git CLI and does not modify the index or working tree. Git-side executable helpers used by `core.fsmonitor`, external diff drivers, and textconv are disabled for report generation.
- Git subprocesses have bounded output and a 5-minute runtime limit. The complete report is also bounded to 50,000 changed/untracked files and 128 MiB of aggregate text content.
- Includes Git status plus staged and unstaged diffs for the selected project root.
- Includes the contents of small text files that are still untracked; binary, non-text, or large untracked files remain represented by path and size.
- Adds instructions asking the AI to produce a clear commit message, preferring Conventional Commits when appropriate.
- The report can be copied to the clipboard or downloaded as a `.txt` file. A successfully generated report is also saved to the project's unified Context history. When **Copy automatically after generating reports** is enabled (the default), generating the Commit context also copies the freshly generated report automatically; the manual Copy action remains available.
- If the repository is clean, Orqeto Dev reports that there is nothing to commit.

### Project and diagnostic contexts

The project-folder section can also generate focused AI contexts without changing the project's normal accumulated Context selection.

- **Full project context** is lazy. Selecting **Full** does not traverse or materialize the project. The user explicitly clicks **Scan**, which runs the normal bounded reference-only collector, respects `.orqeto-devignore` and the active file-name/path filter, and then shows the discovered file count and aggregate size. Copy and Download remain disabled until that scan succeeds. They reuse the scanned relative-path snapshot and materialize current file contents only when exporting; changing the project or Context filter invalidates the scan and requires a new one. The **Paths only** option is honored without showing the manual add/remove drop zones.
- **TypeScript context** appears only when the open project contains a `tsconfig*.json`. Type Check always uses Orqeto Dev's internal standardized diagnostic pipeline with the project's local TypeScript installation, so the generated AI report has a consistent structure across projects.
- **ESLint context** appears only when the open project contains an ESLint configuration (`eslint.config.*` or supported `.eslintrc*`). ESLint reporting also always uses Orqeto Dev's internal standardized diagnostic pipeline and cannot be replaced by a project command.
- **Lint Fix** appears between Type Check and ESLint whenever an ESLint fallback is available or the root `package.json` explicitly configures `orqetoDev.validation.lintFix`. An explicit command is authoritative for fixing; without one, Orqeto uses its safe internal local-ESLint auto-fix fallback.
- **Test** appears only when the root `package.json` explicitly configures `orqetoDev.validation.test`. There is no guessed/default Test command, so adding or removing that property adds or removes the button when project capabilities refresh.
- Projects opt into custom Lint Fix/Test commands with a dedicated namespace instead of overloading conventional npm script names:

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

- Only `lintFix` and `test` are customizable. Type Check and ESLint stay standardized by Orqeto Dev. Ordinary `scripts.lint`, `scripts.lint:fix`, and `scripts.test` entries are never inferred automatically.
- Custom Lint Fix/Test commands run from the canonical project root after an explicit command-specific trust confirmation that shows the exact command. Trust and historical reapply confirmations are Orqeto in-app dialogs, not Windows/OS permission dialogs. Internal TypeScript/ESLint root trust and each exact custom command are remembered only for the current app session, so restarting Orqeto asks again when execution is next requested. Runtime is bounded to 15 minutes per custom command and captured output remains bounded. A non-zero exit code is preserved as a completed validation result, while spawn/timeout/output-limit failures are treated as operational failures. While Lint Fix or Test execution is active, the loading overlay exposes **Cancel**; cancelling discards that run's pending report and asks the backend to stop the active process tree. Internal fallback Lint Fix is cancellable too, with rollback attempts if cancellation lands after safe writes have begun. A custom Lint Fix command may already have changed project files before its process is stopped, so cancellation is not an Undo operation.
- Custom command reports preserve stdout and stderr and wrap them with the command, exit code, duration, and completion status. Lint Fix fallback reports preserve fix/remaining-diagnostic counts. These reports support Copy, Download, automatic copy according to Settings, and the same persistent Context history as other generated contexts.
- After any completed Lint Fix, stale Commit, TypeScript, ESLint, and Full-project scan/export state is invalidated. ESLint remains a separate action so it can report only diagnostics that survive the fix.
- A project that configures `orqetoDev.validation.test` should make that command the single aggregate automated-test entry point for final validation. Its maintenance documentation (preferably `docs/AI.md`) should require every automated suite needed for final validation to be reachable through that command and should require updating the aggregate command whenever required suites change.
- Internal TypeScript/ESLint execution uses the project's local `node_modules` tooling and canonicalized in-root entry points. Because local JavaScript tools/configuration can execute project code, internal diagnostics/fallback fixing require per-session project trust; custom commands receive their own command-specific trust confirmation.
- Settings controls how many files with diagnostics are embedded per standardized TypeScript/ESLint report: **20 by default**, configurable from **1 to 100 files**. The limit is per file, not per error; files containing errors are prioritized, and all diagnostics (including warnings) from every selected file are kept.
- Diagnostic source files excluded by `.orqeto-devignore` are not embedded in the structured report.
- Successfully generated TypeScript, ESLint, Lint Fix, and Test reports are saved to the same Context history used by Custom, Commit, and Full-project context. **Copy automatically after generating reports** applies to all generated validation reports; clipboard failure does not discard the generated report, and the normal Copy button remains available.

### Development logs

Projects can explicitly opt into a long-running development command whose stdout and stderr are captured by Orqeto Dev:

```json
{
  "orqetoDev": {
    "logs": {
      "development": "npm run dev"
    }
  }
}
```

- The **Logs** project mode appears only when `orqetoDev.logs.development` is a non-empty string. Conventional `scripts.dev` entries are never inferred automatically.
- **Start** runs the exact configured command from the canonical project root after an in-app, exact-command trust confirmation for the current app session. **Stop** terminates the launched process tree. The development process keeps running while the user switches Orqeto modes or project tabs, and is stopped when its project root/tab is closed or when Orqeto exits.
- stdout and stderr are drained in background threads into a bounded, secret-redacted buffer. The visible log list polls that buffer only while its tab is active, so the development process can continue without blocking the interface.
- **Copy logs** exports the currently retained log buffer to the clipboard. The global **Clear project logs after copying** setting defaults to enabled; when enabled, a successful copy clears only the entries included in that copy, so output arriving concurrently is preserved while the running process continues into a fresh list.
- **Download** saves the currently retained logs as `.txt` without clearing them. **Clear** discards the retained buffer manually. Older entries may be discarded automatically if the safety buffer limit is reached.

### Multiple projects

- Multiple projects can remain open in independent tabs.
- Tabs can be reordered.
- While dragging files, folders, or ZIPs from the file system, hovering another rooted tab briefly activates it without ending the drag.
- A rooted tab is also a direct **Apply code** shortcut: dropping a payload on that tab applies only to that project. The normal Apply area does the same for its owning tab. No input is scanned or routed to another open project. Files mode can still require an in-project destination decision; Git mode still validates and previews the patch. Empty tabs are not Apply targets.
- The normal **Apply code** drop zone never inspects other open projects; a ZIP belongs to the tab in which it was dropped. A project picker is not shown. Any ambiguity is exclusively about destination paths inside that project.
- Context add/remove, Apply, Dev Ignore add/remove, and tab-Apply targets use copy/drop cursor feedback; the destination tab highlights and shows an Apply icon during the external drag.
- Enabled buttons use a pointer cursor and visible hover feedback on mouse/fine-pointer devices so interactive controls are recognizable; disabled buttons are excluded from this hover treatment.
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
- prepares each source only against the destination project in which it was dropped, without checking any other open tab;
- honors a safe backend-recommended destination inside that project;
- presents the existing in-project destination chooser when several placements remain possible, including a safe explicit ROOT fallback;
- requires explicit root-placement review when no concrete match exists;
- rejects unsafe paths, invalid deletion manifests, ignored targets, and excessive destination ambiguity without silently switching projects;
- preserves secret review, snapshot/Undo, and concurrent-change revalidation;
- compares replacement contents byte-for-byte before writing; if the received code is already identical and there are no other changes, no snapshot/history entry is created and the app reports that the code was already applied. Reapplying the same ZIP to an unchanged project counts every identical entry as unchanged/already applied even when ZIP and file readers return different internal chunk sizes;
- fingerprints each successfully applied source independently of its display name. If the same source fingerprint appears in an older retained application-history entry, Orqeto warns how many applications ago it was used and requires explicit confirmation before continuing. For the newest matching Files application, the normal byte-for-byte destination check remains authoritative. For the newest matching Git patch, Orqeto reports the patch as already applied only when the current affected files still match the exact post-apply fingerprints recorded for that newest history entry; otherwise normal strict Git preparation runs;
- enforces `.orqeto-devignore` again at final write/delete planning, including explicit root placement and deletion manifests;
- after the user confirms Apply, freezes the current external source into a fresh private random staging directory, verifies stable before/frozen/after fingerprints, recomputes the final source/routing fingerprints from that exact frozen representation, and mutates the project only from those staged bytes;
- creates missing project parent directories component-by-component beneath the canonical root, rechecks destination/path state immediately before commit, and preserves a concurrently changed destination instead of overwriting it;
- supports directory/project discovery up to 500,000 files, 1,000,000 directories, and 1,500,000 combined entries per operation, while keeping output/materialization limits separate; routing fails closed on incomplete filesystem evidence and bounds expensive candidate validation;
- supports explicit file and folder deletions through `.orqeto-dev-delete.json`, while preserving root, ignore, symlink/junction, manifest-size, and traversal-budget protections.
- an optional `deletePermanent` manifest field deletes explicitly user-confirmed, recognized generated/build/cache folders without storage backup or Undo; never use it for source, configuration or secrets. Normal and permanent paths must not overlap.

**Git mode**:

- accepts one textual UTF-8 `.patch` or `.diff` at a time;
- validates the complete patch only against the owning tab, never testing it against another open project;
- rejects patches invalid for that project, without trying another tab or offering a root-placement fallback;
- requires Git and applies only to a target project root inside a Git work tree;
- uses strict `git apply --check` validation before anything is changed;
- validates every affected path against the selected Orqeto root and `.orqeto-devignore`;
- shows a preview with created, modified, deleted, and renamed files plus line statistics;
- freezes the patch bytes used for preview/check/application, fingerprints those exact bytes, and refuses a changed patch source before application;
- runs patch statistics/check/application in an isolated Git-apply environment that cannot inherit repository/user whitespace tolerance or executable clean/smudge filter drivers, simulates the expected post-apply state before mutation, and requires the real result to match it exactly;
- does not use `--3way`, automatic whitespace tolerance, binary patches, symlinks, submodules, Git copy operations, or permission/mode-changing patches;
- never runs `git add`, `commit`, `reset`, `checkout`, `restore`, or `clean`.

Both modes use the same persistent Orqeto safety snapshot and **Undo** system. Files entries identify the applied ZIP or source folder when available and show the application date/time; Git entries are identified by patch name and line statistics. The retained history and exact Undo state survive normal app restart and closing/reopening a project tab, up to the configured application-history limit. The retained source fingerprints also support the older-code reapply warning described above, and history remains available when switching work modes. Undo restores the exact pre-application working-tree state captured by Orqeto rather than using Git reset/checkout operations. Critical reads and writes are coordinated per canonical project root (including overlapping roots); Files Apply freezes its final source before mutation, validates routing against that frozen input, and never rereads the original external source for project writes; Windows project paths reject reserved devices, alternate-data-stream syntax, trailing dot/space aliases, and ambiguous existing short-name spellings; file replacements validate completed temporary content and revalidate the destination immediately before durable atomic commit. Windows virtual-drop staging uses fresh GUID-backed directories instead of predictable reusable names. Orqeto-owned staging, Undo snapshots, recovery journals, and content-addressed backup blobs are managed by one backend storage authority with 10 GiB per-project and 100 GiB global hard logical quotas, 80% soft-GC thresholds, real filesystem free-space checks, and pre-mutation reservations. GC can clean stale/rebuildable staging and unreferenced blobs but never active Undo/recovery-critical data; active temporary descendants protect their containing storage subtree, shared backup blobs remain until their final live reference is gone, and merged Files-mode Undo entries release superseded intermediate backups. Recovery/Undo revalidates shared blobs against their content identity and managed no-follow path before use and again immediately before the atomic restore commit. An on-disk recovery journal protects interrupted Apply/Undo operations. On startup, only the primary app instance performs recovery. If a crash happens after an atomic file commit but before the per-file applied flag is persisted, recovery treats that mutation as known only when the destination exactly matches the journaled Orqeto after-state. If recovery cannot prove that a file still matches an expected Orqeto state, the conflicting file and backup are preserved and further Apply/Undo mutations are blocked instead of guessing.

Operation results use one structured outcome model with a stable operation ID/type/project, semantic status, exact counters, warnings/failures, and an optional Undo reference. Backend mutation results are authoritative: Files Apply reports created/edited/deleted/unchanged/rejected or skipped files, Git Apply adds line counts, Context/Dev Ignore use their own semantic counters, and Apply directory counts describe **affected folders**. No-op outcomes never expose Undo. Apply stays in its initiating project and uses that project's ordinary history/Undo controls; it no longer switches tabs or displays a routed-project Undo banner. When an internal destination or Git preview still requires review, the UI does not report premature success. Project-local action feedback uses a single notice slot so later operations replace older messages.

ZIP reading in Files mode preserves the compatibility provided by the library used by the project; build optimization does not remove supported codecs or formats.

The project-folder row uses explicit actions: **Change**, **Open in Explorer**, **Close**, and — only when VS Code is detected — **Open in VS Code**.

## VS Code integration

The project includes a companion extension for Visual Studio Code. Integration state is published per open project together with the current Orqeto process ID, so separate VS Code windows do not inherit another project's temporary mode. Extension liveness uses that published PID and an adaptive lightweight refresh cadence instead of a permanent 2-second PowerShell/CIM process scan.

For a VS Code workspace that belongs to a project currently open in Orqeto Dev, the Explorer context menu provides localized actions in the same language selected in Orqeto Dev (`pt-BR` or `en`):

- **Send to Orqeto Dev**, **Send and copy Orqeto Dev context**, and **Remove from Orqeto Dev context** whenever that project's Dev Ignore dialog is not open, regardless of which Context generator/view is currently selected in the app;
- **Send to Orqeto Dev Ignore** and **Remove from Orqeto Dev Ignore** while that same project's Dev Ignore dialog is open.

**Send and copy Orqeto Dev context** first registers the full path selection, then rereads the current bytes for the complete selected set and copies that fresh context through the same export pipeline as the app Copy action. Context/Ignore actions are hidden when the corresponding project is not open or is currently busy in Orqeto Dev. When one of these actions arrives, Orqeto focuses the owning project tab; Context actions always switch that tab to Project > Custom before add/copy/remove, regardless of whether it was showing Full, Commit, or Validation. The app remains authoritative at execution time, so a stale VS Code menu cannot route an action to the wrong project or Ignore state. These actions use an acknowledged forward-only handoff: they never start a closed app, and the extension reports a delivery failure if the primary instance disappears during forwarding.

**Open in Orqeto Dev** is independent from Context/Ignore availability for roots that are not already open. The VS Code Explorer menu hides this action for the exact root of a project that is already open, while stale/direct open requests still focus the existing tab instead of creating a duplicate. By default, subfolders of an already open project also do not offer the open action; this can be disabled globally in Settings.

The Windows Explorer **Open in Orqeto Dev** shell action follows the same startup/focus behavior. Explorer and VS Code external actions restore and bring the Orqeto Dev window to the foreground when they are received, without leaving it permanently always-on-top. Startup also migrates/removes Orqeto-owned legacy Explorer verbs so updates do not leave duplicate context-menu entries.

On Windows, dragging a supported file/folder over any visible portion of the Orqeto Dev window brings the app to the foreground as soon as that valid drag enters the window. This is triggered by drag-enter only, not ordinary mouse hover, and the window immediately returns to normal non-topmost behavior. While that drag is active, Orqeto keeps the accepted native Windows drop target stable even if bringing the window forward triggers focus/resize notifications, preventing Explorer from temporarily switching the cursor to “not allowed” until the pointer leaves and re-enters.

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
- automatically copy freshly generated Commit/TypeScript/ESLint reports (enabled by default);
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
- Context content is redacted before leaving Orqeto Dev: `.env` files and variants replace every non-empty value with `[REDACTED]`; config-like text also redacts strongly sensitive field names, URL credentials/query secrets, and high-confidence token signatures. Git Commit Context, diagnostic source excerpts, and custom validation command text/stdout/stderr use the same output boundary. Redaction never modifies the project file itself.
- Apply code treats secret-bearing files as protected, not as editable AI input. In Files mode, writes/deletes for files that contain detected keys/secrets are skipped while safe sibling changes may continue; the result reports protected-file and secret-detection counts. Existing secret-bearing destinations are protected too, so a redacted `.env` cannot be overwritten by a guessed replacement. In Git mode, a patch that touches or introduces protected secret material is rejected as a whole because Git apply is atomic.
- Git subprocess output is bounded and inherited `GIT_*` routing/configuration variables are removed before repository operations.
- Critical project mutations are refused while another mutation for the same root is running or while interrupted-operation recovery requires manual attention.

Deletion manifest format:

```json
{
  "format": "orqeto-dev-delete",
  "version": 1,
  "delete": ["src/old-file.ts", "src/old-folder"]
}
```

Each `delete` entry may name an existing file or folder relative to the project root. A folder entry recursively deletes its safe contained tree, so callers should list the folder itself instead of enumerating every child. The manifest is limited to 10,000 entries and 256 KiB; absolute/traversal/backslash paths, symlinks/junctions, missing targets, and anything protected by `.orqeto-devignore` are rejected. The manifest is patch metadata and is not copied into the project. If routing cannot analyze an input because this manifest is invalid or over a safety limit, Orqeto reports that validation error instead of presenting it as a missing destination.

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

To run the complete automated-test set that Orqeto Dev exposes through its project Test button:

```bash
npm test
```

`npm test` is the canonical aggregate test entry point for this repository. Every automated suite required for final validation must be reachable through it; when required suites are added, removed, or renamed, update this aggregate command and `docs/AI.md` together.

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

The production frontend keeps Vite's chunk-size warning meaningful instead of raising its threshold. Vite 8/Rolldown splits third-party `node_modules` code into bounded vendor chunks with a 350,000-byte `maxSize` target, reducing the main application chunk without removing application code or functionality.

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
│  ├─ AI.md
│  ├─ App.md
│  └─ docs.md
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

The canonical AI-maintenance architecture and behavior are documented in [`docs/AI.md`](docs/AI.md). The concise permanent business-rules reference lives at [`docs/docs.md`](docs/docs.md). [`docs/App.md`](docs/App.md) is a compatibility pointer rather than a mirrored copy, so permanent business documentation has one source of truth.

The current repository code remains the source of truth whenever documentation and implementation differ.

Production and maintenance TypeScript/Rust modules are intentionally kept specialized and bounded to **300 physical lines**. `BR-ARCH-001` enforces that limit across `src`, `scripts`, `src-tauri/src`, and the VS Code extension sources so large orchestration files cannot silently grow back.
