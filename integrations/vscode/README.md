# Orqeto Dev VS Code Extension

This extension connects VS Code to the local Orqeto Dev application.

## Context and Dev Ignore per project

Context actions are shown only when the workspace for this VS Code instance can be matched safely to a project that is **currently open** in Orqeto Dev.

When the matching Orqeto project is open, not busy, and its Dev Ignore dialog is not active, the extension exposes Context actions regardless of whether Orqeto is showing Project Full/Custom, Commit, or Validation. Labels follow the current Orqeto Dev language (`pt-BR` or `en`):

- **Send to Orqeto Dev**;
- **Send and copy Orqeto Dev context**;
- **Remove from Orqeto Dev context**.

**Send and copy Orqeto Dev context** adds the entire selection first and only then copies the complete, already-updated context once, using the same behavior as the application's Copy button. Any Context add/remove action focuses the owning Orqeto project tab and switches that tab to Project > Custom before mutating the manual Context selection.

While the **Orqeto Dev Ignore** dialog for that same project is open, only that VS Code instance/project switches to:

- **Add to Orqeto Dev Ignore**;
- **Remove from Orqeto Dev Ignore**.

State is tracked per project root. Opening the Ignore dialog or running an operation for project A does not affect project B or another VS Code window. While a project is busy, its Context/Ignore menu commands are hidden and command execution revalidates that busy state in case the menu snapshot is stale. The extension refreshes state before each action, and the application revalidates the current project and mode as well.

If the selection does not belong entirely to a project that is open in Orqeto Dev, no Context/Ignore action is offered, and the application also rejects forwarded actions that do not have a valid owner project.

## Open in Orqeto Dev

**Open in Orqeto Dev** does not require the project to be open already:

- if Orqeto Dev is closed, the extension starts the registered executable;
- if it is not open yet, Orqeto Dev reuses an empty tab or creates a new one;
- if an exact-open-root request arrives through a stale/direct invocation, Orqeto Dev focuses the existing tab.

The VS Code Explorer menu does not offer **Open in Orqeto Dev** for an exact root that is already open; the project Context/Ignore actions are shown there instead when applicable. By default, subfolders of an already open project are also not offered as new projects from the VS Code Explorer menu. This preference is global and can be disabled in Orqeto Dev Settings. The application still enforces both rules when receiving stale/external commands.

In multi-root workspaces where a single Orqeto project cannot be determined safely, the extension prefers to hide Context/Ignore actions instead of guessing.
