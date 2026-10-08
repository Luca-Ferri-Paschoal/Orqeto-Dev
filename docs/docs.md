# Orqeto Dev — Business Rules Reference

Purpose
-------
This document is the concise business-rules reference for Orqeto Dev behavior that must remain stable across implementation changes.

The current repository code is always the source of truth. docs/AI.md is the canonical technical maintenance document. README.md describes the product for users and contributors. When a change materially affects AI delivery contracts, validation behavior, current-project Apply routing, Apply code safety, or Undo behavior, keep README.md, docs/AI.md, and docs/docs.md synchronized.

1. Global work mode
-------------------
Orqeto Dev has one global, persisted work mode shared by all open project tabs:

- Files mode
- Git mode

The mode is intentionally global rather than per-tab so a user cannot accidentally work with two incompatible delivery contracts at the same time.

Changing work mode must not erase persistent application history or retained Undo entries.

The expanded/collapsed state of the main Folder, Context, and Apply sections and the selected project-folder action are persisted global UI state shared across every project tab; changing one in a tab updates every compatible tab.

2. Copy AI prompt
-----------------
Settings exposes a Copy AI prompt action.

The copied prompt:

- is generic and must not assume a framework, language, repository layout, or project technology;
- is generated in the currently selected UI language (pt-BR or en);
- follows the currently selected work mode;
- explains the output contract that the AI must use when proposing code changes.

Files-mode prompt contract:

- return complete files at their ROOT-relative paths;
- for multiple changes, an incremental ZIP containing only new/changed files is preferred;
- use .orqeto-dev-delete.json for explicit file/folder deletes or moves; folder entries remove the complete safe subtree without enumerating every child;
- do not use .patch/.diff as the Apply code delivery format.

Git-mode prompt contract:

- return exactly one textual UTF-8 .patch or .diff;
- use Git unified diff syntax compatible with strict git apply;
- use / and paths relative to the Orqeto ROOT;
- base every hunk exclusively on the current code/context supplied to the AI, never on an older, assumed, or remembered version;
- do not rely on binary patches, symlinks, submodules, Git copy operations, permission/mode changes, --3way, or whitespace-forcing behavior.

Validation-integration guidance is included in the copied prompt for both work modes:

- explain the explicit `package.json` namespace `orqetoDev.validation`, including `lintFix` and `test`;
- never invent tests merely to satisfy Orqeto Dev;
- add or update `orqetoDev.validation.test` only when the user explicitly asks for tests and the delivered implementation actually includes tests that should be executable through Orqeto Dev;
- when Test is configured, point it at the project's real aggregate test command rather than guessing conventional script names.
- Context text may contain `[REDACTED]` inserted automatically by Orqeto Dev. `.env` files and variants hide every non-empty value; other text uses strong sensitive-key, URL-credential/query-secret, and high-confidence token rules. The AI must never infer or reconstruct a redacted value.
- A file with redacted or detected secret material is informational only for AI work. The AI must omit it from delivered ZIP/patch changes and must not create, edit, replace, rename, or delete it. Files-mode Apply independently protects such source/destination/delete targets and reports the number of protected files plus detected keys/secrets; Git-mode Apply rejects the whole patch if protected material is involved.

3. Project-folder actions
-------------------------
Project-folder actions remain compact and explicit.

The selected project-folder action is persisted globally and shared across project tabs. Tabs where that action is unavailable use the safe folder-selection fallback without overwriting the persisted choice.

Portuguese:
- Trocar
- Open in Explorer
- Open in VS Code (only when VS Code is detected in the environment)
- Close

English:
- Change
- Open in Explorer
- Open in VS Code (only when VS Code is detected in the environment)
- Close

VS Code availability is an environment capability, not a persisted preference. The backend revalidates availability when opening a project or installing/updating the bundled extension.

4. Apply code — global routing principle
-----------------------------------------
Automatic routing is allowed only when there is exactly one safe, concrete, globally unambiguous destination according to the active work mode.

If more than one valid possibility exists, the user decides.

Files mode and Git mode use different routing rules because Files mode resolves destination placement while Git patches already declare their paths.

5. Files mode — accepted inputs
------------------------------
Files mode accepts:

- regular files;
- folders;
- ZIP archives;
- multiple items in the same operation.

Files mode rejects .patch and .diff as Apply code inputs.


### Explicit irreversible deletion of generated directories

In Files mode, an optional `deletePermanent` field in `.orqeto-dev-delete.json` (format/version remain 1) declares only disposable, rebuildable **directory** roots such as `src-tauri/target` or `node_modules`. Example: `{"format":"orqeto-dev-delete","version":1,"delete":["src/obsolete.ts"],"deletePermanent":["src-tauri/target"]}`. AI may propose these paths but cannot approve their destruction: the app requires a separate in-app user confirmation, validates ROOT-relative paths, rejects symlinks/reparse points and suspicious credentials, and restricts terminal directory names to its generated-artifact allowlist. `deletePermanent` overrides `.orqeto-devignore` **only for the explicitly approved generated directories**; ordinary `delete` continues to honor that file. Limits of 10,000 declared entries total and 256 KiB per manifest remain unchanged.

`deletePermanent` is **never backed up, journaled for rollback, included in recoverable history, or added to Undo**. The normal `delete` list and ordinary code modifications remain undoable through their existing snapshots. Paths in the two deletion lists (or file writes) may not overlap, including parent/child paths. To permanently remove `src-tauri/target` while removing other `src-tauri` source files with Undo, list source paths separately in `delete`, not the parent `src-tauri`. Never mark source code, source `lib`/`packages`, `.env`, real secrets, user data or configurations for permanent deletion. The two steps are not one atomic operation: reversible Apply commits first and the explicitly confirmed permanent cleanup runs second; partial failure is reported, and already erased files cannot be recovered with Undo. No source tree-wide content scan is promised for arbitrary unknown credentials within generated output; review the targets before approving.

`.orqeto-devignore` is authoritative during both destination resolution and final write/delete planning, including explicit root placement and deletion manifests. `.orqeto-dev-delete.json` accepts existing ROOT-relative file or folder paths. Folder paths are expanded under the same traversal budgets and then removed deepest-first; any ignored descendant, symlink/junction, unsafe path, missing target, or concurrent structural change rejects the operation. The manifest itself remains capped at 10,000 entries and 256 KiB, and routing must surface manifest validation/limit failures instead of converting them into a generic “no safe destination” result.

Directory sources and filesystem destination discovery are bounded to 500,000 files, 1,000,000 directories, and 1,500,000 combined entries, with independent per-path and aggregate path-byte ceilings. ZIP keeps separate archive-specific limits. Structural read/metadata failures that could hide a destination make routing fail closed; incomplete evidence must never establish uniqueness. Candidate discovery is operation-scoped and cheap, while expensive candidate validation is bounded; excess candidate seeds become explicit ambiguity rather than unbounded candidate×file work.

Each dropped item is resolved independently.

6. Files mode — current-tab-only routing
----------------------------------------
Both the ordinary Apply code area and a direct drop onto a rooted project tab target only that tab's selected ROOT. Do not enumerate, fingerprint, or prepare other open project roots, even when the payload resembles a different project. Empty project tabs are not valid destinations.

For each incoming file, folder, or ZIP, call the existing backend preparation exactly once for the initiating project's ROOT. The backend's in-project candidate recommendations, archive envelope detection, ignore rules, bounded discovery, and invalid-input failures remain authoritative. A safe recommended concrete candidate applies directly; a lone concrete candidate can apply directly; multiple credible candidates require the existing in-project destination dialog. When no credible match exists, the safe ROOT candidate must be offered for explicit confirmation, not applied silently. The ROOT fallback must also be available in a multi-candidate dialog. An ambiguity-limit violation blocks automatic Apply.

The tab ID and ROOT are captured at the start of Apply and rechecked after asynchronous preparation. A closed tab, changed ROOT, unregistered workspace, or busy project must not redirect a staged payload to another tab. Multiple items from one drop remain in the same project and retain sequential Undo semantics. Files preparation failures, including invalid deletion manifests, surface as errors instead of being translated to a generic no-destination message.

7. Files mode — protected destinations
--------------------------------------
All existing path, ignored-file, secret, redacted-content, deletion-manifest, read/write race, journal, and Undo checks remain enabled. The project-level chooser has been removed; in-project destination and sensitive-file review dialogs remain in use.

8. Files mode — already-applied detection
-----------------------------------------
Before replacing an existing destination file, compare the received content with the current destination byte-for-byte.

Unchanged replacements must be removed from the write plan.

If the final operation contains no real writes and no deletions:

- do not write to the filesystem;
- do not create an Undo snapshot;
- do not create application-history entries;
- report that no changes were made because the code was already applied.

In mixed operations, apply only the files that actually differ and report the unchanged count in the batch summary.

For ZIP inputs, equality is a byte-stream property, not a read-buffer-size property. Reapplying the same ZIP to an unchanged project must report every identical entry as unchanged/already applied even when the ZIP decompressor and destination file reader return different chunk sizes.

9. Git mode — accepted input and path ownership
-----------------------------------------------
Git mode accepts exactly one textual UTF-8 .patch or .diff per application.

Git patch paths are explicit. Git mode must not use the Files-mode internal destination resolver and must not relocate patch paths heuristically.

All affected paths must remain inside the selected Orqeto ROOT and must respect .orqeto-devignore.

10. Git mode — current-tab-only preparation
--------------------------------------------
The only Git patch destination is the ROOT of the tab where Apply began. Validate the complete patch against that project's current worktree with the existing strict read-only preparation and `git apply --check` rules. Never probe, select, or switch to another open project, even when the patch would apply cleanly there. Invalid patches surface their actual validation error and do not change any files. A patch already applied to the same project may be reported as a no-op when the existing verified after-state fingerprint matches. Git preview and explicit application confirmation remain mandatory for a new patch.

11. Git mode — strict current-code validation
---------------------------------------------
A Git patch must remain strictly applicable to the current code at application time.

Preparation and application follow this safety sequence:

1. validate patch structure and supported operations;
2. validate all affected paths against the Orqeto ROOT and ignore rules;
3. run strict git apply --check before preview;
4. show preview;
5. when the user confirms, rebuild preparation from the current patch file;
6. require the patch fingerprint to match the previewed patch;
7. simulate the same frozen patch privately and derive the exact expected post-apply state;
8. create the Orqeto safety snapshot and persist that expected state in the recovery journal;
9. run strict git apply --check again against the current working tree;
10. run plain git apply with the same frozen bytes;
11. verify the resulting filesystem state;
12. record the application in Orqeto history.

Do not automatically use --3way, --ignore-whitespace, or another forcing/tolerance fallback. Git subprocesses must use a resolved executable, remove inherited GIT_* variables that can redirect repository/configuration ownership, and enforce bounded runtime plus combined stdout/stderr output. Every git apply operation must use a private Orqeto Git directory/work-tree binding with isolated global/system configuration so repository/user settings cannot relax validation or execute configured clean/smudge filter drivers. Relevant work-tree .gitattributes are copied into the private simulation as declarative input. Preview/check/statistics/application must use the same immutable frozen patch bytes, and the expected post-apply state must be simulated and persisted before real mutation.

The patch does not need to contain an exact current commit hash. Harmless line-number offsets may still be accepted when the required hunk context matches the current file content. The safety requirement is strict applicability to the current content immediately before application.

12. Current-project feedback
----------------------------
The normal Apply section and direct tab drops remain in their initiating project. Only that workspace reports the outcome, and it never displays a project-switch notice. A pending Files destination decision or Git preview must not claim that any change was already applied. No-op outcomes have no Undo reference.

13. Undo ownership
------------------
The normal per-project application history is the authoritative Undo interface. Every Undo action is checked against the recorded operation and current filesystem state, and newer user changes must not be overwritten by a stale Undo request.

14. Application history
-----------------------
Files and Git applications share the same persistent Orqeto Undo/application-history system, scoped by canonical project root. History and the exact Undo state survive normal app restart and closing/reopening a project tab, up to the configured application-history limit.

Switching work mode does not erase history.

No-op Files applications and newest Git duplicates proven to be already current must not create history entries.

Files entries retain a human-readable source label when available (ZIP name, applied folder name, or common parent folder) plus the application date/time. Git entries retain Git-specific information such as patch name and +/- line statistics.

Successful applications retain a content/source fingerprint in the same persistent history. Reapplying a source that matches an older retained entry requires explicit confirmation and reports how many applications ago it was used. A source matching the newest retained Files application is not blocked by history; Files mode still performs the authoritative byte-for-byte final no-op check, so already-current code reports that nothing changed and creates no new history/Undo entry. A newest matching Git patch is reported as already applied without opening a preview only when every affected path still matches the exact post-apply fingerprint/absence recorded by that newest history entry; otherwise the normal strict Git preparation remains authoritative.

Undo uses Orqeto's safety snapshot and must not use git reset, checkout, restore, clean, or another destructive Git rollback command.

Apply and Undo safety requirements:

- critical project access is coordinated per canonical root, including overlapping roots: context/preparation/diagnostic work is read access and Apply/Undo/Dev Ignore is exclusive write access;
- Files-mode preview fingerprints source state and routing evidence; final Apply freezes the current external source into a fresh random private staging directory, verifies stable before/frozen/after fingerprints, rebuilds source/routing fingerprints from that frozen representation, and mutates the project only from those exact frozen bytes;
- final Files Apply rejects source/routing changes before the first project mutation and keeps `.orqeto-devignore` authoritative during final planning;
- Windows project-relative paths reject reserved device names, alternate-data-stream syntax, trailing dot/space aliases, and ambiguous existing short-name spellings before routing or Git/Files mutation;
- project parent directories are created component-by-component beneath the canonical root with symlink/reparse and canonical-parent validation;
- Files-mode writes use durable same-directory temporary files, validate the completed temporary content, then revalidate destination/path state immediately before atomic/no-clobber commit; a concurrent destination change is preserved rather than overwritten;
- Orqeto-owned Apply staging, Undo snapshots, recovery journals, and backup blobs share one backend storage authority with real per-project/global accounting, 10 GiB per-project and 100 GiB global hard logical quotas, 80% soft-GC thresholds, real free-space checks, and reservation before mutation; Windows virtual-drop staging uses fresh GUID-backed directories rather than predictable tick/counter names;
- Undo/rollback use the same last-moment revalidation and expected Orqeto fingerprints are derived from frozen inputs/backups rather than learned from a later filesystem read;
- a recovery journal is persisted before project mutation and multi-file Undo is also recoverable;
- Modified/deleted prior bytes are stored as content-addressed recovery blobs, shared only when bytes/permissions are compatible; Created state is represented as prior absence; shared blobs remain until no live snapshot references them, and merged Files-mode Undo entries release superseded intermediate blob references;
- normal garbage collection may reclaim stale/rebuildable staging and unreferenced blobs but must never delete active Undo, active staging, or recovery-critical data to satisfy quota; persistent application-history metadata is stored with every retained ActiveUndo snapshot directory so startup can reconstruct and deduplicate history before GC, active descendants protect their containing temporary subtree, stale cleanup rejects symlink/reparse escapes, and recovery blobs are revalidated against their content identity before use;
- only the primary single-instance process may recover/clean stale snapshots;
- rollback/recovery must preserve backups and block new Apply/Undo work when it cannot prove that current project files match the expected Orqeto state; a crash after atomic commit but before the per-file applied flag is persisted is recoverable only when the destination exactly matches the already-journaled expected/allowed Orqeto state;
- when startup recovery is blocked, the persistent top error banner exposes an explicit **Discard Apply history** escape hatch. It requires an in-app confirmation, preserves the project files exactly as they are, deletes every retained Orqeto Apply/Undo snapshot and recovery backup, clears the global recovery block only after that managed cleanup succeeds, and is irreversible; if cleanup fails, the block stays active;
- backup restoration revalidates the managed/content-addressed backup immediately before atomic commit, and rollback errors must never be ignored or followed by deletion of the only recovery snapshot.

15. Commit context
------------------
Commit context remains available in both work modes when the selected root belongs to a Git work tree.

It is read-only and may be copied or downloaded. A global **Copy automatically after generating reports** preference defaults to enabled; when enabled, a freshly generated Commit context is copied once automatically while the manual Copy action remains available. Clipboard failure must not discard the generated report. Git context commands must disable external diff/textconv execution and force core.fsmonitor=false, bound subprocess runtime/output, and enforce the normal 50,000-file / 128 MiB aggregate context limits.

Its final instructions follow the active work mode:

- Files mode: additional fixes must use the complete-files/incremental-ZIP contract;
- Git mode: additional fixes must use one strict unified .patch/.diff, with every hunk based exclusively on the current report/context rather than older or assumed code.

16. Context resource safety
---------------------------
Context discovery must remain bounded: at most 500,000 files, 1,000,000 visited directories, and 1,500,000 combined entries per operation, with bounded individual and aggregate path bytes. Materialization remains independently bounded to 16 MiB per text file and 128 MiB of aggregate text content. Large project support must never imply constructing an unbounded text payload in RAM. Persisted context history must also enforce bounded entry and per-project total sizes.

17. Localization
----------------
The application UI supports pt-BR and en.

All new user-visible work-mode, routing, preview, status, prompt-copy, no-op, and Undo strings must exist in both locales. Do not hardcode a Portuguese string into the English UI or an English string into the Portuguese UI.

README.md, docs/AI.md, docs/App.md, and docs/docs.md are maintained in English.

18. Safety priority
-------------------
When convenience conflicts with safety or predictability, prefer safety and explicit user choice.

The core product rule is:

- automate only when there is exactly one safe answer;
- ask the user when more than one answer is valid;
- in Files mode, offer the explicitly allowed root fallback when safe;
- in Git mode, reject incompatible patches rather than guessing or forcing them.

19. Dev Ignore and external editor integration
----------------------------------------------
The project root uses `.orqeto-devignore` as the single Orqeto ignore file.

Project UI:

- show a Dev Ignore action beside the configured project path;
- if `.orqeto-devignore` is missing, the first action creates it with broad `.gitignore`-compatible defaults for dependencies, build output, caches, editor/VCS metadata, and common development platforms;
- if it already exists, open the reusable Dev Ignore dialog;
- the dialog uses a 60% Add to ignore / 40% Remove from ignore layout;
- adding writes exact project-relative ignore rules;
- removing makes the selected path available again, including required parent unignore rules when a broader rule still ignores an ancestor;
- paths outside the project and `.orqeto-devignore` itself are never valid targets;
- concurrent Dev Ignore updates for one project are serialized.

VS Code project synchronization:

- the project-folder **Open in VS Code** action and the VS Code Settings section are visible only when a local VS Code installation is detected; availability is refreshed while the app is running and backend commands fail closed if VS Code disappears before execution;
- the Settings action installs the bundled VSIX when absent and updates it when already installed, using the existing forced install/update flow;
- Orqeto Dev is the source of truth and publishes its current process ID, all open project roots, the root whose Dev Ignore dialog is open (if any), the global subfolder-opening preference, and the current UI locale (`pt-BR` or `en`);
- the extension checks that published PID cheaply and uses adaptive registry refresh rather than a permanent 2-second PowerShell/CIM process scan;
- Context/Ignore commands appear only for a VS Code workspace that safely maps to a project currently open in Orqeto Dev;
- when that project's Dev Ignore dialog is closed and the project is not busy, Context commands remain available regardless of whether the app is showing Project Full/Custom, Commit, or Validation, and are localized from the published Orqeto Dev locale;
- normal mode shows the localized equivalents of Send to Orqeto Dev / Send and copy Orqeto Dev context / Remove from Orqeto Dev context;
- Send and copy first completes the whole selection add, then copies the complete updated context exactly once through the normal Copy/export pipeline; if the add fails, it must not copy stale content, and a stale command must be rejected if Dev Ignore became active;
- while that same project's Dev Ignore dialog is open, only that project changes to Send to Orqeto Dev Ignore / Remove from Orqeto Dev Ignore;
- another project or VS Code instance must not inherit Ignore mode;
- execution re-checks current state, including project busy state, and the app independently routes from its authoritative state so stale menu labels cannot change the target project or Ignore state; each Context/Ignore action focuses the owning project tab, and Context actions switch that tab to Project > Custom before applying add/copy/remove;
- Context/Ignore forwarding must remain forward-only, must not start a closed app, and must report delivery failure if the detected primary exits before the action is handed off; once received, queued actions use per-action IDs and acknowledgment so one failure cannot silently discard later actions;
- if no open project owns the selected paths, do not modify any project.

Open in Orqeto Dev:

- remains independent from Context/Ignore availability;
- starts Orqeto Dev when the registered executable is not currently running;
- the single-instance handoff must not lose the open-root request if a previously detected primary instance exits during launch;
- the VS Code Explorer menu does not offer Open in Orqeto Dev for an exact already-open project root; if an open-root request still reaches the app through a stale/direct integration path, it focuses that tab instead of creating a duplicate;
- the Windows Explorer shell action has the same start/focus behavior;
- Explorer and VS Code external actions restore and transiently raise/focus the main Orqeto window when received, without leaving it permanently always-on-top;
- Windows startup removes Orqeto-owned legacy shell verbs from common Directory/Folder shell classes before registering the current canonical Explorer entries, so upgrades cannot leave duplicate menu items;
- a supported external file/folder drag that enters any visible portion of the Orqeto window transiently raises/focuses the app on drag-enter only; ordinary pointer hover and repeated drag-over events do not steal focus, the app immediately returns to normal non-topmost behavior, and native drop-target refreshes caused by focus/resize must never revoke the active OLE target before drag-leave/drop;
- Context add/remove, Apply, Dev Ignore add/remove, and rooted project-tab Apply surfaces expose copy/drop cursor feedback; while an external drag is over a rooted project tab, the tab is highlighted with an Apply icon so the destination project is explicit before drop;
- the global `hideOpenProjectSubfolders` preference defaults to enabled; when enabled, subfolders of an already open project are not offered as independent roots in the normal VS Code Explorer flow, and the app must still focus the containing project if such a request reaches it;
- when disabled, those subfolders may be opened as independent project roots.

Published integration-state writes must preserve update order so an older modal/project snapshot cannot overwrite a newer one.


20. Full-project and diagnostic contexts
----------------------------------------
Project-folder context generators are transient and scoped to the selected tab.

Rules:

- Full project context is available for every configured root, but selecting Full must not start discovery or materialization automatically. The user must explicitly click Scan. Scan uses the normal bounded reference-only context collector, including `.orqeto-devignore`, applies the manual Context filter controls (file name/path and contains/exact/regex), and records the filtered path snapshot plus file count and aggregate discovered size. Copy and Download remain disabled until a scan succeeds. Changing the root or any Context filter invalidates the scan; Paths only affects export and does not require rescanning. Full mode does not expose the manual add/remove drop targets and must not mutate the tab's accumulated manual Context selection.
- TypeScript context appears only when the project has a detected `tsconfig*.json`. Type Check is intentionally standardized by Orqeto Dev: it resolves the project's local TypeScript installation and detected configurations directly and always produces Orqeto's structured AI diagnostic report. `package.json` cannot override Type Check.
- ESLint context appears only when a supported ESLint configuration is detected. ESLint reporting is also intentionally standardized by Orqeto Dev: it resolves the project's local ESLint/configuration directly and always produces Orqeto's structured AI diagnostic report. `package.json` cannot override ESLint report generation.
- Validation exposes **Lint Fix** between Type Check and ESLint whenever either a supported ESLint configuration exists or the project explicitly configures `orqetoDev.validation.lintFix`. When the explicit command exists, Orqeto runs that exact project command from the canonical project root. Otherwise it uses the safe internal ESLint auto-fix fallback: bounded `--fix-dry-run`, `.orqeto-devignore` filtering, checked in-root paths, atomic writes, source revalidation, conflicting-config rejection, and rollback attempts after partial write failure.
- Validation exposes **Test** only when the root `package.json` contains a non-empty string at `orqetoDev.validation.test`. Test has no inferred/default fallback. Adding or removing that field must add or remove the button when capabilities refresh; only the active project tab performs focus-driven capability discovery.
- The only supported custom validation keys are `orqetoDev.validation.lintFix` and `orqetoDev.validation.test`. Conventional `scripts.lint`, `scripts.lint:fix`, `scripts.test`, or similarly named package scripts are never guessed or executed automatically. Example: `"orqetoDev": { "validation": { "lintFix": "npm run lint:fix", "test": "npm test" } }`.
- A custom Lint Fix/Test command is arbitrary project shell code. Each distinct configured command requires explicit user approval once per app session, even if the root was already trusted for internal TypeScript/ESLint diagnostics. The trust prompt shows the exact command and is rendered as an Orqeto in-app confirmation dialog rather than an operating-system permission dialog. Execution uses the canonical project root as working directory, a 15-minute custom-command runtime ceiling, bounded output capture, process-tree termination on timeout where supported, and explicit operational errors when the process cannot be started or completed safely. Lint Fix and Test expose the loading-overlay **Cancel** action only while executable work remains cancellable. Cancellation discards the pending report and signals the backend to terminate that operation's process tree. Internal fallback Lint Fix is also cancellable and attempts to restore fixes already written by that fallback if cancellation is observed mid-commit. Cancellation of an arbitrary custom Lint Fix is not filesystem Undo: changes already made by the project command can remain.
- A custom command's non-zero exit status is a completed validation result, not an operational execution failure. Orqeto captures stdout and stderr, command text, exit code, duration, and success/issue status into a standardized textual validation context. That context supports Copy and Download, follows the global auto-copy-generated-reports preference, and is persisted in the same bounded per-project Context history as the other generators.
- Internal Lint Fix also produces a compact Lint Fix report with changed-file and remaining-diagnostic counts, with the same Copy/Download, auto-copy, and Context-history behavior. ESLint remains a separate action so the user can generate the standardized residual diagnostic report after fixes.
- Any completed Lint Fix invalidates prepared Commit, TypeScript, ESLint, and Full-project scan/export state because those artifacts can refer to pre-fix bytes. Manual Custom Context membership remains reference-only and therefore continues to materialize current bytes at export time.
- Projects that configure `orqetoDev.validation.test` should point it at one aggregate project-validation test command. Project maintenance documentation, especially `docs/AI.md`, should require every automated suite needed for final validation to be reachable through that one command and require the aggregator to be updated whenever suites are added, removed, or renamed. This gives Orqeto one explicit Test entry point without guessing a repository's test topology.
- the global **Copy automatically after generating reports** preference defaults to enabled and applies to Commit, TypeScript, ESLint, Lint Fix, and Test reports. Successful generation copies the fresh report once; clipboard failure is reported without discarding the generated report, and manual Copy remains available.
- diagnostic capability detection is per project; only the active project tab refreshes capabilities when relevant project state changes, relevant Orqeto work completes, or the application regains focus, so inactive tabs do not repeat filesystem discovery on every focus event.
- internal diagnostic execution uses locally installed TypeScript/ESLint tooling directly. Since those JavaScript entry points and ESLint configuration/plugins can execute project code, the first internal diagnostic/fallback-fix run for a root in each app session requires explicit user trust and the backend rejects execution without that approval. This approval uses the same in-app confirmation system, is remembered only in memory for the current app session, and is requested again after the application restarts. Historical-source reapply warnings use the in-app confirmation system as well.
- canonicalized internal TypeScript/ESLint tool entry points must remain inside the selected project root.
- internal diagnostic runtime/output remains bounded by the existing diagnostic limits; custom Lint Fix/Test commands use a separate 15-minute runtime ceiling with the same bounded output/process-tree termination guarantees, and failures are explicit.
- Settings persists a global diagnostic-file limit with default 20 and allowed range 1..100. The limit counts files with diagnostics, not individual errors/warnings; files with errors are prioritized and all messages for each selected file are retained.
- diagnostic source files must respect `.orqeto-devignore` before being embedded, and existing file/aggregate context-size limits remain authoritative.
- Copy and Download are supported for Full project, TypeScript, ESLint, Lint Fix, and Test contexts. Full-project Copy/Download require and reuse the explicit Scan path snapshot, then revalidate/materialize current file contents with `.orqeto-devignore` still authoritative. Download receives the scanned path set and materializes/formats/writes it in the backend to avoid an avoidable giant Rust-to-React-to-Rust content round trip; successful Full-project Copy/Download contributes the exact finalized context to the same persistent Context history.
- report instructions follow the active Files/Git work-mode contract where applicable; raw custom-command stdout/stderr is preserved inside the standardized validation wrapper instead of being semantically rewritten.

Development log execution
-------------------------
A project may expose one explicit long-running development command at `orqetoDev.logs.development` in the root `package.json`. Orqeto never infers this command from `scripts.dev`. When configured, the project mode bar exposes **Logs** with Start/Stop, a live retained log list, Copy, Download, and Clear. Start re-reads the exact configured command, requires command-specific in-app trust for the current application session, runs from the canonical project root with stdin closed, and captures stdout/stderr without blocking the Tauri event thread. Stop terminates the launched process tree and waits for it to finish. Closing/changing the owning root, closing its tab, or exiting Orqeto also stops that process.

Captured output is secret-redacted before storage and kept in a bounded backend buffer; the frontend also keeps a bounded retained view. Inactive tabs do not poll, but backend capture continues. Copy and Download each format a fresh retained-buffer snapshot with command/start metadata. Download never clears logs. Copy clears only after a successful clipboard write when the persisted global `clear_logs_after_copy` setting is enabled; that setting defaults to enabled, and only entries through the exact copied sequence are cleared so output arriving concurrently is preserved. Manual Clear is always available. Clearing affects only retained log entries, never the running process, so later output begins a fresh visible list.

21. Loading and long-running operation feedback
-----------------------------------------------
The application must provide deterministic loading feedback without adding confirmation steps to normal workflows.

- Before React mounts, a lightweight HTML/CSS spinner covers the window so slow startup never presents a blank or apparently frozen surface.
- After React is available, long-running project operations use one global modal-style loading overlay with a dimmed backdrop.
- While a long-running operation is active, the application UI is inert so tabs, buttons, drop targets, Settings, and other actions cannot start conflicting work.
- The global operation overlay covers project initialization/root changes, context collection/generation, diagnostics, Apply/Undo work, Dev Ignore mutation, current-project Apply preparation, and VS Code extension installation/update.
- User-decision dialogs such as destination selection, sensitive-file review, and Git patch preview are not treated as background loading; they must remain interactive while awaiting the user's choice. Any routing loading overlay is removed immediately when one of these dialogs opens, and the dialog itself must be rendered outside any inert busy-content subtree. Loading feedback may resume only after the user confirms and mutation actually starts.
- The visual spinner may use a short delay after startup to avoid flicker for operations that finish immediately, but interaction blocking begins as soon as the operation begins.
- Enabled buttons expose a pointer cursor and a visible hover affordance on hover-capable fine-pointer devices. Disabled buttons are excluded from that hover contract so disabled state remains visually and semantically distinct.
- Reusable in-app dialogs expose modal semantics, support Escape cancellation, trap keyboard focus while open, and restore the previously focused control when they close.

22. Live manual context and structured operation status
------------------------------------------------------

Manual Context stores only the deduplicated ROOT-relative paths selected by the user. Selection discovers membership without opening or decoding regular source-file bodies merely to add them. Source text is not cached as the authoritative active context.

Copy, Download, automatic copy-after-add, and VS Code Send and copy materialize the complete selected path set from the current project immediately before formatting/export. Materialization uses the normal project read coordination and revalidates root ownership, `.orqeto-devignore`, symlink/reparse safety, text encoding, per-file limits, and aggregate context limits. If the project root or context membership changes while materialization is running, the export is rejected rather than mixing revisions. Missing or newly ignored files are reported as unavailable; stale bytes are never substituted. If a normal Copy/Download can materialize only a subset, it may export that subset with an explicit warning but must preserve the active selection even when auto-clear is enabled. VS Code Send and copy requires complete materialization and rejects partial export.

Manual Clear remains available even when some selected paths can no longer be materialized. In that case Orqeto clears the active selection, reports a partial result, and deliberately skips Context-history snapshot creation so it never archives an incomplete snapshot as though it were complete. A normal complete Clear still requires the snapshot to persist successfully before the selection is discarded.

Re-adding an already selected file reports it as already present. Re-adding a folder reports already-selected members separately and adds any newly discovered eligible files explicitly. Files created later under a previously selected folder are not implicitly added until that folder/file is sent again. Paths-only export continues to emit paths without source contents.

Explorer/native-drop and VS Code Context commands must converge on the same workspace selection and materialization pipeline. Send and copy completes the selection update first, then performs exactly one fresh full-context materialization/copy. External Context/Ignore execution focuses the owning project tab and re-checks project ownership, Ignore state, and busy state immediately before mutation. Context actions always converge on Project > Custom before mutating the manual selection; stale Ignore-state or busy actions are rejected explicitly instead of being silently reinterpreted or reported as completed.

Context history is one persistent per-project history shared by Custom/manual, Commit, Full project, TypeScript validation, Lint Fix, ESLint validation, and Test contexts, all bounded by the configured Context-history limit and the existing entry/aggregate byte ceilings. The UI exposes this history once beside the Create context heading instead of repeating a history row below each context mode; opening the header history is an overlay and therefore does not reserve permanent vertical space. Custom Copy, Download, and Clear actions remain one horizontal action row, including on narrow layouts, rather than being rearranged into a multi-column grid. Each entry records its context kind plus the exact finalized text. Custom contexts are archived after successful Copy/Download and after a complete Clear; Commit and validation contexts are archived when generation succeeds; Full-project contexts are archived when Copy/Download materializes them. Routine history listing returns metadata only. Copy retrieves only the requested snapshot lazily. Download resolves that snapshot in the Rust backend and writes it through the safe export flow without loading the archived blob into React state.

The top status surface renders one structured authoritative operation outcome carrying a stable operation ID/type/project, semantic status (`success`, `partial`, `no_op`, `cancelled`, `failed`, or `blocked` where applicable), counters, warnings/failures, and an optional exact Undo reference. Backend mutation commands own their filesystem result and identity; frontend aggregation is limited to explicitly defined batch operations. Context actions distinguish added, already present, removed, not present, filtered/skipped, materialized, and currently unavailable items with file/folder counts. Dev Ignore distinguishes changed and already-in-state files/folders. Files/Git Apply distinguishes created, edited, deleted, and unchanged files plus the affected directory hierarchy (reported as affected folders, not falsely as folders physically created/deleted); Git also reports added/deleted line counts. No-op outcomes never expose Undo. Routed contextual Undo is tied to the backend application `operationId` and is eligible only while that exact operation remains the newest Undo entry; stale shortcuts are refused in favor of normal history. Routed destination-selection and Git-preview notices never claim that Apply completed before it actually does. Within each project workspace there is exactly one local notice banner. Dev Ignore updates, Apply results, Context operations, validation actions, and other workspace feedback publish into that shared channel; publishing a newer notice replaces the previous one, and clearing the channel removes the single banner. The UI must not render separate stacked Dev Ignore and workspace notices for consecutive actions.

23. Business-rule verification
------------------------------
Critical behavior and safety invariants use stable BR-* identifiers backed by executable tests.

Development verification:

- `npm run test:business:contracts` runs Node contract/behavior tests;
- `npm run test:business:rust` runs the Rust test suite;
- `npm run verify:business` first checks version synchronization and then runs the complete active business-rule test suite;
- `npm run verify:patch` is the normal maintenance gate for TypeScript type checking, lint/format fixes, and business-rule verification;
- `npm run test:adversarial` reruns the hostile final Node/Rust regression suite;
- `npm run verify:final` combines the maintenance and adversarial gates for release-candidate hardening.

The active rules verify reference-only manual Context selection, no-op re-add behavior, explicit discovery of later folder members, fresh current-byte materialization, fail-safe handling of missing/newly ignored members, unified typed persistent Context history across every generator, header-level Context-history placement without a repeated bottom row, single-row Custom export actions, metadata-only routine Context-history listing, lazy exact snapshot retrieval/backend history download, persistent per-root application/Undo history across restart and tab reopen, large-project resource ceilings, iterative traversal, fail-closed routing scans, bounded candidate validation, frozen Files Apply bytes, pre-mutation source/routing invalidation, no-op preservation, checked last-moment commit validation, canonical-root parent creation, fresh random staging, storage quota/free-space reservations, content-addressed shared backup lifetime and merged-Undo compaction, GC protection/escape safety, exact Created/Modified/Deleted Undo, user-edit blocking, multi-step Undo recovery, injected Apply/Undo failure rollback, authoritative backend-to-status counter mapping, partial/no-op status semantics, safe per-project Undo identity, affected-folder wording/plural behavior in both locales, in-project decision/preview messaging, 50,000-path reference-only Context membership, race revalidation, persistence/write/commit/recovery fault injection, Files/ZIP/delete-manifest path-security corpora, and strict Git unsupported-operation/path corpora.

Runtime performance evidence is intentionally measured on the real Windows desktop process. `npm run benchmark:runtime -- --pid=<pid> --seconds=10 --label=<label>` reports normalized idle CPU plus working/private memory so the same build can be compared at 1/10/20 tabs and with the VS Code extension active. `npm run benchmark:release-size` reports available release executable/installer sizes after a build. Production frontend chunking uses Vite 8/Rolldown `output.codeSplitting` to place third-party `node_modules` code in vendor chunks with a 350,000-byte `maxSize` target rather than raising `chunkSizeWarningLimit`. Performance work must not remove application behavior, supported dependencies, ZIP compatibility, or weaken Git/Apply/Undo validation.


- **BR-ARCH-001 — bounded specialized modules.** Production and maintenance TypeScript/Rust source modules stay at or below 300 lines; orchestration entry points remain thin and responsibilities are split into focused modules instead of accumulating giant files.
- **BR-ARCH-002 — dependency direction.** `src/domain` and `src/infra` stay independent of React feature/application modules; shared contracts live in the neutral domain layer and feature code consumes infrastructure adapters.
- **BR-ARCH-003 — Rust crate-root module ownership.** Top-level Rust modules are declared in `src-tauri/src/lib.rs` before the split `lib/*.rs` implementation files are included, so refactoring implementation files cannot silently redirect Rust module resolution into `src/lib/`.

- **BR-FILE-007** — Explicit `deletePermanent` requires a user-confirmed, backend-validated generated-folder target; its contents do not enter backup, recoverable history or Undo, and normal source-code paths stay reversible and separate.
