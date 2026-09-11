# Orqeto Dev

**Orqeto Dev** is a desktop application for turning local projects into structured AI context and safely applying code changes back to the project.

It was designed to reduce the manual work between the editor, file system, and AI assistants: you select a project, build the required context, send that context to the AI, and then apply the files or patches you receive directly to the correct project structure.

> Windows-first, built with Tauri v2, Rust, React, and TypeScript.

## Key features

### AI context

- Add files and folders by drag and drop.
- Recursive directory reading.
- Accumulated context per project, with paths relative to the selected root.
- Filter by **file name** or **path**, using:
  - contains;
  - exact;
  - regex.
- The same filter is respected when both **adding** and **removing** files from the context.
- Recent filter history per project.
- **Paths only** mode, useful for sharing the structure without sending file contents.
- Support for UTF-8, UTF-8 with BOM, and UTF-16 with BOM content.
- Non-text files can be safely ignored in normal mode.
- Copy to clipboard and export to `.txt`.
- Persistent history of finalized contexts.

### Multiple projects

- Multiple projects can remain open in independent tabs.
- Tabs can be reordered.
- Each tab keeps its own:
  - root folder;
  - context selection;
  - filter;
  - code application queue;
  - undo session.
- Tab order, active project, and section state are persisted in SQLite.

### Apply code

Orqeto Dev also handles the reverse workflow: it receives code produced externally and applies it to the selected project.

- Accepts files, folders, and ZIP archives.
- Automatically locates the most likely destination inside the project.
- When there is more than one plausible destination, it asks the user for confirmation.
- Respects `.orqeto-devignore`.
- Supports explicit deletions through `.orqeto-dev-delete.json`.
- Keeps temporary history to **Undo** previous applications.
- Restores replaced or removed files and deletes newly created files when an application is undone.

ZIP reading preserves the compatibility provided by the library used by the project; build optimization does not remove supported codecs or formats.

## VS Code integration

The project includes a companion extension for Visual Studio Code.

While Orqeto Dev is running, the VS Code Explorer context menu provides actions to:

- **Send to Orqeto Dev**;
- **Remove from Orqeto context**;
- **Open in Orqeto Dev**.

The extension identifies the open project that corresponds to the selected paths and forwards the operation to the correct tab.

### Installing the extension

The extension does not need to be published to the Marketplace to be used.

In Orqeto Dev itself:

1. open **Settings**;
2. locate the **VS Code** section;
3. click **Install**.

The application installs the VSIX included in the bundle. If an older version is already installed, it is updated. If VS Code is unavailable or installation fails, the app instructs the user to install VS Code and try again.

The extension version is synchronized with the application version.

## Theme and preferences

The application provides light and dark modes.

The theme uses global color tokens, and the preference is persisted in SQLite together with other global settings, such as:

- language;
- automatically copy after adding context;
- clear after copying or downloading;
- history limits;
- Windows Explorer integration behavior.

The interface is available in Portuguese (`pt-BR`) and English (`en`). The selected language also determines the text protocol generated for the context.

## Project safety

Orqeto Dev prevents implicit changes outside the selected folder.

- Paths are canonicalized before relevant operations.
- Files outside the project root are rejected.
- Symlinks/junctions that escape the root must not allow external access.
- Removing from the **context** never deletes the real project file.
- Deletions during **Apply code** must be explicitly declared in the reserved manifest.

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

Context collection and patch resolution respect the `.orqeto-devignore` file at the project root.

Its syntax follows `.gitignore` behavior. Orqeto Dev should not depend on an extensive list of implicit exclusions: the project file is the explicit source of these rules.

## Development

### Requirements

- Node.js `>= 22.12.0`;
- Rust toolchain compatible with the project;
- development dependencies required by Tauri for the operating system;
- Visual Studio Code only if you want to test the companion extension.

### Installation

```bash
npm install
```

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

### Release build

```bash
npm run build
```

The build:

1. checks version synchronization;
2. validates TypeScript and linting;
3. generates the extension VSIX;
4. builds the frontend;
5. builds the Tauri/Rust binary;
6. generates the NSIS installer on Windows.

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

The architecture, behavior, and persistent context rules for AI-assisted maintenance are documented in [`docs/AI.md`](docs/AI.md).

The current repository code remains the source of truth whenever documentation and implementation differ.
