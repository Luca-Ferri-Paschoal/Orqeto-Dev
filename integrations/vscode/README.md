# Orqeto Dev VS Code Extension

This extension connects VS Code to the local Orqeto Dev application.

## Context and Dev Ignore per project

Context actions are shown only when the workspace for this VS Code instance can be matched safely to a project that is **currently open** in Orqeto Dev.

When the matching Orqeto project is in Create mode, the extension can expose:

- **Send to Orqeto Context**;
- **Send and copy Orqeto Context**;
- **Remove from Orqeto Context**.

**Send and copy Orqeto Context** adds the entire selection first and only then copies the complete, already-updated context once, using the same behavior as the application's Copy button.

While the **Orqeto Dev Ignore** dialog for that same project is open, only that VS Code instance/project switches to:

- **Add to Orqeto Dev Ignore**;
- **Remove from Orqeto Dev Ignore**.

State is tracked per project root. Opening the Ignore dialog for project A does not affect project B or another VS Code window. The extension refreshes state before each action, and the application revalidates the current project and mode as well.

If the selection does not belong entirely to a project that is open in Orqeto Dev, no Context/Ignore action is offered, and the application also rejects forwarded actions that do not have a valid owner project.

## Open in Orqeto Dev

**Open in Orqeto Dev** does not require the project to be open already:

- if Orqeto Dev is closed, the extension starts the registered executable;
- if the exact root is already open, Orqeto Dev focuses the existing tab;
- if it is not open yet, Orqeto Dev reuses an empty tab or creates a new one.

By default, when a root is already open in Orqeto Dev, its subfolders are not offered as new projects from the VS Code Explorer menu. This preference is global and can be disabled in Orqeto Dev Settings. The application also enforces the rule when receiving the command, protecting against stale menus.

In multi-root workspaces where a single Orqeto project cannot be determined safely, the extension prefers to hide Context/Ignore actions instead of guessing.
