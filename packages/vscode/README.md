# LLM Wiki — VS Code Extension

Interactive wiki browsing powered by LLM maintenance. Browse, query, and manage your LLM-generated wiki directly from VS Code.

## Features

- **Wiki Pages Tree View** — Browse all wiki pages in a dedicated sidebar with hierarchical navigation
- **Raw Sources Tree View** — View and manage ingested source files
- **Backlinks Explorer** — Discover page relationships and cross-references
- **Lint Findings Panel** — Review and fix wiki quality issues at a glance
- **Status Bar Integration** — See wiki health and page count in the status bar
- **Command Palette Commands** — Full CLI parity from within VS Code
- **Context Menu Actions** — Right-click source files to ingest them

## Screenshots

<!-- TODO: Add screenshots -->
_Screenshots coming soon._

## Installation

### From VSIX (Local)

1. Download the `.vsix` file from the [Releases](https://github.com/microsoft/llmwiki/releases) page
2. Open VS Code
3. Run **Extensions: Install from VSIX...** from the Command Palette (`Ctrl+Shift+P`)
4. Select the downloaded `.vsix` file

### From Source

```bash
git clone https://github.com/microsoft/llmwiki.git
cd llmwiki
npm install
npm run build --workspace=packages/vscode
cd packages/vscode
npm run package
# Install the generated .vsix via "Extensions: Install from VSIX..."
```

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `llmwiki.init` | LLM Wiki: Initialize Wiki | Initialize a new wiki in the current workspace |
| `llmwiki.ingest` | LLM Wiki: Ingest Source | Ingest source files into the wiki |
| `llmwiki.query` | LLM Wiki: Query Wiki | Search and query the wiki |
| `llmwiki.lint` | LLM Wiki: Lint Wiki | Run lint checks on wiki pages |
| `llmwiki.status` | LLM Wiki: Show Status | Display wiki health and statistics |
| `llmwiki.openPage` | LLM Wiki: Open Page | Open a specific wiki page |
| `llmwiki.refresh` | LLM Wiki: Refresh | Refresh all tree views and status |

## Views

The extension adds an **LLM Wiki** activity bar icon with four tree views:

- **Wiki Pages** — All wiki pages with navigation
- **Raw Sources** — Ingested source files
- **Backlinks** — Cross-reference relationships between pages
- **Lint Findings** — Quality issues found during linting

## Configuration

The extension activates automatically when a workspace contains a `wiki/index.md` file, or when you run the `LLM Wiki: Initialize Wiki` command.

## Requirements

- **VS Code** 1.85.0 or later
- **Node.js** 20.x or later
- **Git** (for wiki version tracking)

## License

MIT — see [LICENSE](https://github.com/microsoft/llmwiki/blob/main/LICENSE) for details.
