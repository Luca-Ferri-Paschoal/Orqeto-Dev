ORQETO DEV — BUSINESS RULES REFERENCE

Purpose
-------
This document is the concise business-rules reference for Orqeto Dev behavior that must remain stable across implementation changes.

The current repository code is always the source of truth. docs/AI.md is the canonical technical maintenance document. README.md describes the product for users and contributors. When a change materially affects AI delivery contracts, cross-project routing, Apply code safety, or Undo behavior, keep all three documents synchronized.

1. Global work mode
-------------------
Orqeto Dev has one global, persisted work mode shared by all open project tabs:

- Files mode
- Git mode

The mode is intentionally global rather than per-tab so a user cannot accidentally work with two incompatible delivery contracts at the same time.

Changing work mode must not erase application history or temporary Undo entries.

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
- use .orqeto-dev-delete.json for explicit deletes or moves;
- do not use .patch/.diff as the Apply code delivery format.

Git-mode prompt contract:

- return exactly one textual UTF-8 .patch or .diff;
- use Git unified diff syntax compatible with strict git apply;
- use / and paths relative to the Orqeto ROOT;
- base every hunk exclusively on the current code/context supplied to the AI, never on an older, assumed, or remembered version;
- do not rely on binary patches, symlinks, submodules, Git copy operations, permission/mode changes, --3way, or whitespace-forcing behavior.

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

`.orqeto-devignore` is authoritative during both destination resolution and final write/delete planning, including explicit root placement and deletion manifests.

Directory sources and filesystem destination discovery are bounded to 500,000 files, 1,000,000 directories, and 1,500,000 combined entries, with independent per-path and aggregate path-byte ceilings. ZIP keeps separate archive-specific limits. Structural read/metadata failures that could hide a destination make routing fail closed; incomplete evidence must never establish uniqueness. Candidate discovery is operation-scoped and cheap, while expensive candidate validation is bounded; excess candidate seeds become explicit ambiguity rather than unbounded candidate×file work.

After the user confirms Apply, Files mode freezes the current external source into a fresh random private staging directory, verifies stable before/frozen/after fingerprints, rebuilds the final source/routing fingerprints from that exact frozen representation, and performs project writes only from those staged bytes. The temporary frozen source is bounded to 10 GiB until the shared storage/quota manager is introduced by the next storage patch.

Each dropped item is resolved independently.

6. Files mode — cross-project routing
-------------------------------------
For each incoming item, Orqeto analyzes the same destination evidence against every rooted open project tab and preserves the existing in-project resolver's confidence/recommendation rules.

A project is internally resolved when the existing resolver has a safe recommended candidate (`recommendedCandidateIndex`). In that state, the project contributes one destination even if weaker alternatives were discovered. If no recommendation exists and multiple concrete candidates remain, that project is internally ambiguous. A root-only fallback with no matching evidence is not a concrete match. For root-relative multi-file ZIPs, generic directory overlap is not project identity: the root becomes a concrete/recommended match only with strong exact file-path coverage; otherwise the original-project root remains an explicit safe fallback.

Rules:

A. Exactly one resolved destination globally, with no internally ambiguous project
--------------------------------------------------------------------------
- Apply automatically to the recommended destination.
- If that destination belongs to another tab, switch to that tab first.
- If application succeeds after a routed switch, show a routed-project success notice with contextual Undo.

B. More than one resolved project, or any internally ambiguous project
--------------------------------------------------------------------
- Do not switch automatically.
- Do not apply automatically.
- First show a project-level selector.
- Always include Apply at the root of the original project when that root fallback is safe.

For each project option:

- if the existing resolver has a recommended destination, show the project and that destination path; selecting it switches to that tab and applies directly;
- if the project has unresolved internal destinations, show the project and the number of possible destinations; selecting it switches to that tab and then opens the existing project-internal destination resolver.

Do not flatten project and internal paths into one large project×path list. Project selection and internal destination resolution are separate decisions.

A single project with multiple candidates is not automatically ambiguous when the existing resolver has a safe recommendation. It is ambiguous when no safe recommendation exists. Two separately resolved projects are globally ambiguous because the global router still has two valid project choices.

C. No resolved or ambiguous concrete destination in any open project
-------------------------------------------------------------------
- Keep the existing root-placement confirmation for the original project when the root fallback is safe.
- If the root fallback is unsafe or unavailable, do not offer it.

7. Files mode — root option during ambiguity
--------------------------------------------
Apply at the root of the original project is not only a last-resort option.

Whenever Files-mode routing is not globally unambiguous, the project-level selector must include the original-project root option when it is safe. This lets the user intentionally choose the project where the drop started even if other project matches exist.

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

9. Git mode — accepted input and path ownership
-----------------------------------------------
Git mode accepts exactly one textual UTF-8 .patch or .diff per application.

Git patch paths are explicit. Git mode must not use the Files-mode internal destination resolver and must not relocate patch paths heuristically.

All affected paths must remain inside the selected Orqeto ROOT and must respect .orqeto-devignore.

10. Git mode — cross-project routing
------------------------------------
To determine the target project, Orqeto tests the complete patch read-only against each compatible rooted open Git project using the normal strict patch preparation and git apply --check rules.

A project is a candidate only when the complete patch is valid for that project's current working tree.

Rules:

A. Exactly one project accepts the complete patch
------------------------------------------------
- Route to that project automatically.
- Switch tabs if required.
- Open the normal Git patch preview.
- User confirmation is still required before the patch is applied.

B. More than one project accepts the complete patch
---------------------------------------------------
- Do not choose automatically.
- Show a project-only selector.
- After the user chooses a project, switch to it and open the normal Git patch preview.
- Do not show the Files-mode internal path resolver.

C. No open project accepts the complete patch
----------------------------------------------
- Reject the patch without changing files.
- Do not offer Apply at root in Git mode.
- Do not reinterpret or relocate patch paths.

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

12. Routed-project feedback
---------------------------
Switching projects because of Apply code is a prominent state change and requires explicit localized feedback near the top of the app.

After a successful routed application:

- show the equivalent of “Project changed to {project}. Code applied.”;
- expose a contextual Undo action tied to that exact newest application.

If the routed application still needs a Files-mode internal destination decision:

- say that the project changed and the user must choose where to apply;
- do not claim that code was applied.

If a routed Git patch is only at preview stage:

- say that the project changed and the user must review the patch preview;
- do not claim that code was applied.

If routed Files content is byte-identical:

- say that the project changed but no changes were made because the code was already applied;
- do not show Undo for that no-op.

13. Contextual Undo
-------------------
The routed-project Undo shortcut must target the application that produced the routed success notice.

It may execute only while that application is still the newest Undo entry for that project. If newer work has been applied, refuse the shortcut and direct the user to the project's normal application history.

The normal history remains the authoritative history UI.

14. Application history
-----------------------
Files and Git applications share the same temporary Orqeto Undo/history system.

Switching work mode does not erase history.

No-op Files applications must not create history entries.

Git entries retain Git-specific information such as patch name and +/- line statistics.

Undo uses Orqeto's safety snapshot and must not use git reset, checkout, restore, clean, or another destructive Git rollback command.

Apply and Undo safety requirements:

- critical project access is coordinated per canonical root, including overlapping roots: context/preparation/diagnostic work is read access and Apply/Undo/Dev Ignore is exclusive write access;
- Files-mode preview fingerprints source state and routing evidence; final Apply freezes the current external source, validates source/routing fingerprints against that frozen representation, and mutates only from those exact staged bytes;
- source or routing changes detected before project mutation abort the operation without applying;
- Windows project-relative paths reject reserved device names, alternate-data-stream syntax, trailing dot/space aliases, and ambiguous existing short-name spellings before routing or Git/Files mutation;
- project parent directories are created component-by-component beneath the canonical root with symlink/reparse and canonical-parent validation;
- Files-mode writes use durable same-directory temporary files, validate the completed temporary content, then revalidate destination/path state immediately before atomic/no-clobber commit; concurrent destination changes are preserved rather than overwritten;
- Windows virtual-drop staging uses fresh GUID-backed directories created atomically rather than predictable tick/counter names;
- Undo/rollback use the same last-moment revalidation and expected Orqeto fingerprints are derived from frozen inputs/backups rather than learned from a later filesystem read;
- a recovery journal is persisted before project mutation and multi-file Undo is also recoverable;
- only the primary single-instance process may recover/clean stale snapshots;
- rollback/recovery must preserve backups and block new Apply/Undo work when it cannot prove that current project files match the expected Orqeto state;
- rollback errors must never be ignored or followed by deletion of the only recovery snapshot.

15. Commit context
------------------
Commit context remains available in both work modes when the selected root belongs to a Git work tree.

It is read-only and may be copied or downloaded. Git context commands must disable external diff/textconv execution and force core.fsmonitor=false, bound subprocess runtime/output, and enforce the normal 50,000-file / 128 MiB aggregate context limits.

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

README.md, docs/AI.md, and this docs.txt are maintained in English.

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
- Orqeto Dev is the source of truth and publishes all open project roots, the root whose Dev Ignore dialog is open (if any), and the global subfolder-opening preference;
- Context/Ignore commands appear only for a VS Code workspace that safely maps to a project currently open in Orqeto Dev;
- normal mode shows Send to Orqeto Context / Send and copy Orqeto Context / Remove from Orqeto Context;
- Send and copy first completes the whole selection add, then copies the complete updated context exactly once through the normal Copy/export pipeline; if the add fails, it must not copy stale content, and a stale command must be rejected if Dev Ignore became active;
- while that same project's Dev Ignore dialog is open, only that project changes to Send to Orqeto Dev Ignore / Remove from Orqeto Dev Ignore;
- another project or VS Code instance must not inherit Ignore mode;
- execution re-checks current state, and the app independently routes from its authoritative state so stale menu labels cannot change the target mode;
- Context/Ignore forwarding must remain forward-only, must not start a closed app, and must report delivery failure if the detected primary exits before the action is handed off; once received, queued actions use per-action IDs and acknowledgment so one failure cannot silently discard later actions;
- if no open project owns the selected paths, do not modify any project.

Open in Orqeto Dev:

- remains independent from Context/Ignore availability;
- starts Orqeto Dev when the registered executable is not currently running;
- the single-instance handoff must not lose the open-root request if a previously detected primary instance exits during launch;
- focuses an exact already-open root instead of creating a duplicate;
- the Windows Explorer shell action has the same start/focus behavior;
- the global `hideOpenProjectSubfolders` preference defaults to enabled; when enabled, subfolders of an already open project are not offered as independent roots in the normal VS Code Explorer flow, and the app must still focus the containing project if such a request reaches it;
- when disabled, those subfolders may be opened as independent project roots.

Published integration-state writes must preserve update order so an older modal/project snapshot cannot overwrite a newer one.


20. Full-project and diagnostic contexts
----------------------------------------
Project-folder context generators are transient and scoped to the selected tab.

Rules:

- Full project context is available for every configured root and must use the normal bounded context collector, including `.orqeto-devignore`. It reuses the manual Context filter controls (file name/path and contains/exact/regex) plus Paths only, but does not expose the manual add/remove drop targets and must not mutate the tab's accumulated manual Context selection.
- TypeScript context appears only when the project has a detected `tsconfig*.json`; ESLint context appears only when a supported ESLint configuration is detected.
- detection is per project and must refresh when relevant project state changes or the application regains focus.
- diagnostic execution uses locally installed TypeScript/ESLint tooling directly and must not execute arbitrary package scripts. Because the local tool entry points and ESLint configuration/plugins can execute project code, the first diagnostic run for a root in each app session requires explicit user trust and the backend must reject execution without that approval.
- canonicalized diagnostic tool entry points must remain inside the selected project root.
- diagnostic subprocess runtime/output are bounded, timeout handling terminates the launched process tree where supported, and failures are explicit.
- Settings persists a global diagnostic-file limit with default 20 and allowed range 1..100. The limit counts files with diagnostics, not individual errors/warnings; files with errors are prioritized and all messages for each selected file are retained.
- diagnostic source files must respect `.orqeto-devignore` before being embedded, and existing file/aggregate context-size limits remain authoritative.
- Copy and Download are supported for Full project, TypeScript, and ESLint contexts; Full-project Copy/Download apply the active filter and Paths-only choice, and Download materializes/formats/writes the filtered path set in the backend; these transient reports do not create normal Context-history entries.
- report instructions follow the active Files/Git work-mode contract.

21. Loading and long-running operation feedback
-----------------------------------------------
The application must provide deterministic loading feedback without adding confirmation steps to normal workflows.

- Before React mounts, a lightweight HTML/CSS spinner covers the window so slow startup never presents a blank or apparently frozen surface.
- After React is available, long-running project operations use one global modal-style loading overlay with a dimmed backdrop.
- While a long-running operation is active, the application UI is inert so tabs, buttons, drop targets, Settings, and other actions cannot start conflicting work.
- The global operation overlay covers project initialization/root changes, context collection/generation, diagnostics, Apply/Undo work, Dev Ignore mutation, cross-project routing analysis, and VS Code extension installation/update.
- User-decision dialogs such as destination selection and Git patch preview are not treated as background loading; they must remain interactive while awaiting the user's choice.
- The visual spinner may use a short delay after startup to avoid flicker for operations that finish immediately, but interaction blocking begins as soon as the operation begins.
