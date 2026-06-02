# LLM Wiki — VS Code Extension

Interactive wiki browsing powered by LLM maintenance. Browse, query, and grow your LLM-generated wiki directly from VS Code.

## Features

- **Wiki Pages tree view** — Browse Entities, Concepts, and Sources in the activity bar.
- **Raw Sources tree view** — See every file in `raw/` with size and modified date; right-click to remove.
- **Backlinks explorer** — Discover which pages link to the page you currently have open.
- **Lint Findings panel** — Review wiki quality issues grouped by severity; click to jump to the affected file.
- **Status bar integration** — Live page count, tooltip with coverage %, click for a full status notification.
- **Bulk ingest** — Pick multiple files, pick a folder, or right-click a selection in the Explorer.
- **`@wiki` chat participant** — Talk to the wiki through Copilot Chat with slash commands.

## Installation

### From VSIX (local)

1. Download the `.vsix` file from the [Releases](https://github.com/microsoft/llmwiki/releases) page.
2. Open VS Code.
3. Run **Extensions: Install from VSIX…** from the Command Palette (`Ctrl+Shift+P`).
4. Select the downloaded `.vsix`.

### From source

```bash
git clone https://github.com/microsoft/llmwiki.git
cd llmwiki
npm ci
npm run build --workspace=packages/vscode
npm run package --workspace=packages/vscode
# Install the generated .vsix via "Extensions: Install from VSIX..."
```

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `llmwiki.init` | LLM Wiki: Initialize Wiki | Initialize a new wiki in the current workspace |
| `llmwiki.ingest` | LLM Wiki: Ingest Files or Folder | Bulk-ingest one or many files, or every supported file inside a folder |
| `llmwiki.query` | LLM Wiki: Query Wiki | Weighted full-text search across titles, summaries, and bodies |
| `llmwiki.status` | LLM Wiki: Show Status | Page count, sources, coverage %, last ingest date |
| `llmwiki.openPage` | LLM Wiki: Open Page | Quick-open any wiki page by title |
| `llmwiki.search` | LLM Wiki: Search Wiki | Filter entities/concepts by title, summary, or tag |
| `llmwiki.searchRaw` | LLM Wiki: Search Sources | Find a raw source file by name |
| `llmwiki.refresh` | LLM Wiki: Refresh | Run lint-fix, prune orphaned pages, and refresh views |
| `llmwiki.fix` | LLM Wiki: Fix Issues | Open the `@wiki /fix` chat to interactively resolve findings |
| `llmwiki.removeSource` | LLM Wiki: Remove Source | Delete a raw source plus the wiki pages derived from it |

## Bulk Ingest

The **LLM Wiki: Ingest Files or Folder** command accepts a mix of files and folders and can be invoked four different ways:

1. **Command Palette** — opens a native file/folder picker with multi-selection enabled. Pick any combination of files **and** folders.
2. **Explorer context menu** — right-click any file or folder anywhere in the Explorer and choose **LLM Wiki: Ingest Files or Folder**. Ctrl/Shift multi-selections are honoured.
3. **Welcome view** — when the Raw Sources view is empty, click **Ingest Files or Folder** from the welcome message.
4. **Drag-and-drop into `raw/`** — files dropped into the Raw Sources view are auto-ingested by the file watcher.

When the selection contains a folder the extension walks it recursively and skips:

- entries starting with a dot (`.git`, `.DS_Store`, …)
- common build/output directories: `node_modules`, `dist`, `out`, `build`, `.wiki`

External files are copied into `<workspace>/.wiki/raw/` first, then sent through the per-file ingestion pipeline (LM enrichment + `ingestSource`). Selecting more than 20 files triggers a confirmation prompt so you don't accidentally kick off a large batch.

Progress is reported in the notification area; cancelling stops further files from being processed.

## Views

The extension contributes an **LLM Wiki** activity-bar container with four tree views:

- **Wiki Pages** — Entities, Concepts, and Sources read from `wiki/index.md`.
- **Raw Sources** — Files in `raw/`, grouped by subdirectory if any exist.
- **Backlinks** — Pages that link to the currently open wiki page.
- **Lint Findings** — Errors, warnings, and info populated by the last lint run.

## `@wiki` Chat Participant

Open the Chat view and type `@wiki` to converse with the wiki via GitHub Copilot:

- `@wiki /status` — show wiki statistics.
- `@wiki /save` — save the previous answer as a wiki page.
- `@wiki /lint` — run health checks and get fix suggestions.
- `@wiki /fix` — auto-fix lint issues using the LLM.

## Configuration

The extension activates automatically when a workspace contains a wiki at `.wiki/wiki/`, or when you run **LLM Wiki: Initialize Wiki** to scaffold one.

## Requirements

- **VS Code** 1.93 or later
- **Node.js** 20.x or later (for building from source)
- **GitHub Copilot** subscription (the extension uses the VS Code Language Model API for ingestion enrichment)

## Architecture

The extension uses `@llmwiki/shared` exclusively for wiki logic — no operations are duplicated in extension code. Commands delegate to shared functions like `ingestSource`, `queryWiki`, `getWikiStatus`, `lintWiki`, and `getBacklinks`, keeping the extension a thin UI layer.

## MCP Server

The extension automatically registers an MCP (Model Context Protocol) server named **LLM Wiki** with Copilot Chat (via the `mcpServerDefinitionProviders` contribution) — no configuration required. Open the Chat view's MCP server picker and you'll see it listed; tools are available to any chat session that opts in.

The same server can be used from Claude Desktop, Cursor, or any other MCP-compatible client via the `llmwiki-mcp` stdio launcher shipped by `@llmwiki/shared`:

```jsonc
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["-y", "-p", "@llmwiki/shared", "llmwiki-mcp", "/abs/path/to/your-project/.wiki"]
    }
  }
}
```

See the [MCP Tools Reference](https://github.com/microsoft/llmwiki/blob/main/docs/mcp-tools.md) for the full tool inventory.

## License

MIT — see [LICENSE](https://github.com/microsoft/llmwiki/blob/main/LICENSE) for details.
