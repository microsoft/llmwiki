# Architecture — LLM Wiki

> Technical design for the LLM Wiki system.

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Human Interface                           │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐        │
│  │   VS Code    │   │   Obsidian   │   │  GitHub Web    │        │
│  │  Extension   │   │ (read-only)  │   │   (browse)     │        │
│  └──────┬───────┘   └──────────────┘   └────────────────┘        │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐         ┌──────────────┐                       │
│  │  @llmwiki/   │◄────────│  MCP Server  │◄── External LLM      │
│  │   shared     │         │  (in-proc /  │    Agents             │
│  │              │         │   stdio)     │    (Claude, GPT, …)  │
│  └──────┬───────┘         └──────────────┘                       │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Git Repository                             │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────┐           │
│  │ raw/       │  │ wiki/      │  │ AGENTS.md         │           │
│  │ (sources)  │──▶│ (generated)│◀─│ (schema)          │           │
│  │ immutable  │  │ LLM-owned  │  │ conventions       │           │
│  └────────────┘  └────────────┘  └───────────────────┘           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Three-Layer Architecture

### Layer 1: Raw Sources (`raw/`)

The human-curated collection of source documents. Articles, papers, images, data files, notes clipped from the web.

- **Immutable.** The LLM reads from this layer but never modifies it.
- **Source of truth.** All wiki content traces back to raw sources.
- **Format-agnostic.** Markdown, PDF, plain text, images — anything the LLM can read.
- **Organized by the human.** Subdirectories are optional and user-defined (e.g., `raw/papers/`, `raw/articles/`).

### Layer 2: Wiki (`wiki/`)

LLM-generated markdown files — the compiled knowledge base.

- **LLM-owned.** The LLM creates, updates, and deletes wiki pages. Humans read but don't edit.
- **Interlinked.** Pages cross-reference each other with standard markdown links.
- **Typed pages.** Summaries, entity pages, concept pages — defined via YAML frontmatter (`type` field).
- **Two special files:**
  - **`wiki/index.md`** — Content catalog. Every page listed with a link, one-line summary, and metadata. Organized by H2 category headings (`## Entities`, `## Concepts`, `## Sources`). The extension reads this for query matching and lint checking.
  - **`wiki/log.md`** — Chronological append-only record of operations (ingests, queries, lint passes). Each entry has the format `## [YYYY-MM-DD] verb | subject` followed by detail text.

### Layer 3: Schema (`AGENTS.md`)

The conventions document that tells the LLM how the wiki is structured and what workflows to follow.

- **Co-evolved.** Human and LLM refine this together as patterns emerge.
- **Prescriptive.** Defines page types, frontmatter schema, naming conventions, cross-referencing rules.
- **Auto-generated.** The **LLM Wiki: Initialize Wiki** command creates a starter template with seven sections: page types, directory structure, frontmatter schema, naming conventions, ingest workflow, lint rules, and cross-referencing guidelines.
- **Starts minimal.** Grows with use as the team discovers what works.

## Technology Stack

- **Runtime:** Node.js ≥ 20
- **Language:** TypeScript (ES2022 target, NodeNext modules, strict mode)
- **Build tools:** [esbuild](https://esbuild.github.io/) for the VS Code extension, `tsc` for the shared library
- **Test framework:** [Vitest](https://vitest.dev/) (single config at the repo root)
- **Frontmatter parsing:** [gray-matter](https://github.com/jonschlinkert/gray-matter) (in `@llmwiki/shared`)
- **MCP SDK:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) (in `@llmwiki/shared`)
- **Monorepo:** npm workspaces with build order `shared → vscode`
- **Distribution:** `npm run package --workspace=packages/vscode` produces a `.vsix`

## Source Code Structure

The project is an npm workspaces monorepo with two packages:

```
llmwiki/
├── packages/
│   ├── shared/                     # @llmwiki/shared — core wiki operations + MCP server
│   │   ├── src/
│   │   │   ├── index.ts            # Barrel export
│   │   │   ├── constants.ts        # API_VERSION
│   │   │   ├── errors.ts           # isNotFoundError, isPermissionError
│   │   │   ├── wiki.ts             # readPage, writePage, listPages, getPageLinks,
│   │   │   │                       # directoryExists, createEntityPage,
│   │   │   │                       # createConceptPage, addCrosslinks
│   │   │   ├── index-ops.ts        # readIndex, writeIndex, addEntry, removeEntry,
│   │   │   │                       # findEntries, updateIndexEntry
│   │   │   ├── log.ts              # appendEntry, readLog, getRecentEntries
│   │   │   ├── sources.ts          # listSources (raw/ directory metadata)
│   │   │   ├── backlinks.ts        # getBacklinks (reverse link resolution)
│   │   │   ├── lint.ts             # lintWiki (6 check categories)
│   │   │   ├── utils.ts            # slugify, excerpt
│   │   │   ├── search.ts           # countOccurrences (case-insensitive matching)
│   │   │   ├── init.ts             # initWiki (directory scaffolding, AGENTS.md template)
│   │   │   ├── ingest.ts           # ingestSource (single-file ingest)
│   │   │   ├── ingest-context.ts   # ingestWithContext (enriched response)
│   │   │   ├── bulk-ingest.ts      # bulkIngest (batch ingest helper)
│   │   │   ├── query.ts            # queryWiki, slugifyQuery (weighted search)
│   │   │   ├── status.ts           # getWikiStatus (aggregate statistics)
│   │   │   └── mcp/
│   │   │       ├── index.ts        # Barrel export
│   │   │       ├── server.ts       # createMcpServer — registers tools, dispatches
│   │   │       ├── read-tools.ts   # 7 read-only tools
│   │   │       ├── write-tools.ts  # 7 write tools
│   │   │       └── bin.ts          # llmwiki-mcp stdio launcher (shebang + StdioServerTransport)
│   │   ├── package.json            # @llmwiki/shared (bin: llmwiki-mcp)
│   │   └── tsconfig.json
│   │
│   └── vscode/                     # llmwiki — VS Code extension
│       ├── src/
│       │   ├── extension.ts        # activate/deactivate — wires providers & watchers
│       │   ├── commands.ts         # Command handlers (init, ingest, query, status, …)
│       │   ├── llmIngest.ts        # LM API enrichment pipeline for single-file ingest
│       │   ├── statusBar.ts        # StatusBarManager — debounced live page count
│       │   ├── wikiPagesTree.ts    # WikiPagesTreeDataProvider (Entities/Concepts/Sources)
│       │   ├── rawSourcesTree.ts   # RawSourcesTreeDataProvider (raw/ browser)
│       │   ├── backlinksTree.ts    # BacklinksTreeDataProvider (reverse links)
│       │   ├── lintFindingsTree.ts # LintFindingsTreeDataProvider (severity-grouped)
│       │   ├── mcpProvider.ts      # vscode.lm.registerMcpServerDefinitionProvider → llmwiki-mcp
│       │   └── chatParticipant.ts  # @wiki chat participant (/status, /save, /lint, /fix)
│       ├── package.json            # VS Code extension manifest
│       └── esbuild.config.mjs      # CJS bundle, external: ['vscode']
│
├── tests/
│   ├── shared/                     # Shared library tests (incl. mcp/)
│   ├── vscode/                     # Extension tests (mocked vscode module)
│   └── fixtures/                   # Test fixture data
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI — lint, build, test on push/PR to main
├── package.json                    # Workspace root — workspaces:
│                                   #   [packages/shared, packages/vscode]
├── tsconfig.base.json              # Shared TypeScript config
├── tsconfig.json                   # Root references
├── vitest.config.ts                # Single test config
├── AGENTS.md                       # Schema conventions (generated by init)
├── README.md
├── ARCHITECTURE.md
├── SECURITY.md
└── LICENSE                         # MIT
```

## Wiki Data Structure

A wiki instance (created by the **LLM Wiki: Initialize Wiki** command) has this layout:

```
<workspace>/.wiki/
├── raw/                        # Human-curated sources (immutable)
├── wiki/                       # LLM-generated knowledge base
│   ├── index.md                # Content catalog (categorized markdown list)
│   ├── log.md                  # Operation log (append-only)
│   ├── entities/               # Entity pages (people, orgs, tools)
│   ├── concepts/               # Concept pages (ideas, patterns)
│   ├── sources/                # Source summary pages
│   └── queries/                # Saved query results
└── AGENTS.md                   # Schema — wiki conventions
```

The `.wiki/` directory is the wiki root. The extension activates whenever a workspace contains `.wiki/wiki/`.

### Index format

```markdown
# Wiki Index

## Entities

- [Ada Lovelace](entities/ada-lovelace.md) — Mathematician and writer #history

## Concepts

## Sources

- [notes.txt](sources/notes-summary.md) — Source file (.txt) #research
```

### Log format

```markdown
## [2025-01-15] initialized | wiki

Wiki knowledge base initialized.

## [2025-01-15] ingested | notes.txt

Ingested source "notes.txt" → sources/notes-summary.md
```

### Page frontmatter

```yaml
type: source          # entity | concept | source | summary | query
title: notes.txt
source_path: raw/notes.txt
ingested: 2025-01-15
tags: []
```

## VS Code Extension Architecture

The extension (`packages/vscode`) is the primary UI. It never duplicates wiki logic — every operation delegates to `@llmwiki/shared`.

### Activation

The extension activates when the workspace contains a wiki at `.wiki/wiki/` (the activation key `llmwiki.isWikiWorkspace` is set). The **LLM Wiki: Initialize Wiki** command is always available so a fresh workspace can be bootstrapped.

### Tree View Providers

```
Activity Bar: "LLM Wiki" ($(book) icon)
├── Wiki Pages (wikiPagesTree.ts)
│   └── WikiPagesTreeDataProvider
│       ├── Reads wiki/index.md via readIndex()
│       ├── Root: category nodes (Entities, Concepts, Sources)
│       └── Children: page items with click-to-open
│
├── Raw Sources (rawSourcesTree.ts)
│   └── RawSourcesTreeDataProvider
│       ├── Reads raw/ via listSources()
│       ├── Groups files by subdirectory (flat if no subdirs)
│       └── Shows size + date in description
│
├── Backlinks (backlinksTree.ts)
│   └── BacklinksTreeDataProvider
│       ├── Calls getBacklinks() for the active editor's wiki page
│       ├── Updates on editor change (200ms debounce)
│       └── Shows "Open a wiki page" message when no wiki page is active
│
└── Lint Findings (lintFindingsTree.ts)
    └── LintFindingsTreeDataProvider
        ├── Populated by llmwiki.lint via setFindings()
        ├── Groups by severity (Errors → Warnings → Info)
        └── Click to open the affected file
```

### Commands

| Command ID | Trigger | Behaviour |
|------------|---------|-----------|
| `llmwiki.init` | Command palette | Creates wiki scaffold (dirs, index, log, AGENTS.md) |
| `llmwiki.ingest` | Palette / Explorer context menu / welcome view | Bulk-ingests selected files and/or folders (see Bulk Ingest below) |
| `llmwiki.query` | Command palette | Input box → weighted search → quick pick results |
| `llmwiki.status` | Palette / status bar click | Shows page count, sources, coverage, last ingest in a notification |
| `llmwiki.openPage` | Command palette | Quick pick from index entries → opens selected page |
| `llmwiki.search` | Command palette | Filter entities/concepts by title, summary, or tag |
| `llmwiki.searchRaw` | Command palette | Find a raw source file by name |
| `llmwiki.refresh` | Command palette | Runs lint-fix, prunes orphans, refreshes trees |
| `llmwiki.fix` | Lint Findings view | Opens `@wiki /fix` chat to interactively resolve findings |
| `llmwiki.removeSource` | Raw Sources context menu | Deletes a raw source plus pages derived from it |

### Bulk Ingest

The `llmwiki.ingest` handler accepts three invocation shapes:

1. **No arguments** (Command Palette) — opens a native `showOpenDialog` with `canSelectFiles=true`, `canSelectFolders=true`, `canSelectMany=true`.
2. **Single Uri** — fired by single-file Explorer context-menu clicks.
3. **`(focusedUri, selectedUris[])`** — fired by Explorer context-menu invocations with multi-selection (Ctrl/Shift-click); the second argument is honoured when present.

The flow:

```
raw URIs (files + folders)
   │
   ▼
expandSelectionToFiles()
   ├─ stat each URI
   ├─ files → keep
   └─ folders → walkFolder() BFS
                  ├─ skip names starting with "."
                  └─ skip SKIP_DIRS = { node_modules, out, dist, build, .wiki }
   │
   ▼
deduplicate by resolved fsPath
   │
   ▼
if (count === 0) → "No files found in the selection." (info)
if (count >  20) → modal confirmation "You are about to ingest N files. Continue?"
   │
   ▼
withProgress (Notification) → for each file:
   ├─ ensureInRaw() — copy external files into <workspace>/.wiki/raw/
   └─ llmIngest()   — LM API enrichment + ingestSource()
```

### Status Bar

`StatusBarManager` (left-aligned, priority 100) displays: `$(book) Wiki: N pages`

- **Tooltip:** source count, last ingest date, coverage %
- **Click action:** runs `llmwiki.status`
- **Auto-refresh:** file system watchers on `wiki/**/*.md` and `raw/**` with 300ms debounce
- **Uninitialized state:** shows "Wiki: Not initialized"

### Chat Participant (`@wiki`)

The extension contributes a chat participant for GitHub Copilot Chat:

- `@wiki /status` — show wiki statistics.
- `@wiki /save` — save the previous answer as a wiki page.
- `@wiki /lint` — run health checks and get fix suggestions.
- `@wiki /fix` — auto-fix lint issues using the LLM.

### Bundling

The extension uses esbuild (CJS format) with `vscode` as an external. Packaging via `vsce package --no-dependencies` produces a `.vsix` file with `@llmwiki/shared` bundled inline.

## MCP Server Architecture

The MCP server lives in `@llmwiki/shared` and exposes wiki operations via the [Model Context Protocol](https://modelcontextprotocol.io/), enabling external LLM agents (Claude Desktop, Cursor, VS Code Copilot, etc.) to read and write wiki content programmatically. The shared library exports `createMcpServer` plus per-tool handlers, and ships a stdio launcher binary (`llmwiki-mcp`) so any MCP-compatible client can spawn a server pointed at a `.wiki/` directory.

### Launcher (`llmwiki-mcp`)

`packages/shared/src/mcp/bin.ts` is the executable entry point declared in the package `bin` field. It accepts a single argument — the path to a wiki root (defaulting to `./.wiki`) — validates the directory exists, builds a server via `createMcpServer({ wikiRoot })`, and connects it to a `StdioServerTransport`. The CJS bundle output is `dist/mcp/bin.js` with a Node shebang preserved by tsc.

Once `@llmwiki/shared` is installed, the launcher is invoked as:

```bash
npx llmwiki-mcp ./.wiki
```

This is what `mcp.json` entries (Claude Desktop, Cursor, `.vscode/mcp.json`) point at.

### VS Code Auto-Registration

`packages/vscode/src/mcpProvider.ts` calls `vscode.lm.registerMcpServerDefinitionProvider` (stable API, requires VS Code ≥ 1.101) to advertise the launcher to Copilot automatically when a `.wiki` workspace is detected. The provider resolves `@llmwiki/shared/mcp-bin` via `require.resolve`, builds a `vscode.McpStdioServerDefinition` pointing at `process.execPath <launcher> <wikiRoot>`, and exposes it under the id `llmwiki`. No `mcp.json` is required for the VS Code path.

### Tool Inventory

| Tool | Type | Description |
|------|------|-------------|
| `wiki_status` | Read | Wiki statistics (source/page counts, coverage) |
| `wiki_query` | Read | Free-text search with relevance scores |
| `wiki_lint` | Read | Health checks by severity with category filter |
| `wiki_list_pages` | Read | All pages with frontmatter metadata |
| `wiki_list_sources` | Read | Raw source files with metadata |
| `wiki_read_page` | Read | Single page content by path |
| `wiki_read_index` | Read | All index entries |
| `wiki_write_page` | Write | Create/overwrite page with auto-index |
| `wiki_create_entity` | Write | Create entity page at `entities/{slug}.md` |
| `wiki_create_concept` | Write | Create concept page at `concepts/{slug}.md` |
| `wiki_update_page` | Write | Merge partial updates into existing page |
| `wiki_add_crosslinks` | Write | Add "See also" section with validated links |
| `wiki_update_index` | Write | Update index entry metadata |
| `wiki_ingest_with_context` | Write | Ingest source with context-rich response |

### MCP Data Flow

```
External LLM Agent
         │
    MCP JSON-RPC
         │
         ▼
┌─────────────────────┐
│ MCP Server          │
│ (createMcpServer)   │
├─────────┬───────────┤
│ Read    │ Write     │
│ Tools   │ Tools     │
│ (7)     │ (7)       │
└────┬────┴────┬──────┘
     │         │
     ▼         ▼
┌─────────────────────┐
│ @llmwiki/shared     │
│ (core operations)   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Git Repository      │
│ raw/ + wiki/        │
└─────────────────────┘
```

### Write Tool Safety Model

- **Path traversal protection:** All path arguments are validated via `assertWithinDir()` — resolved paths must stay within the wiki directory.
- **Frontmatter validation:** `wiki_write_page` requires `title` and `type` fields in frontmatter.
- **Input validation:** All required fields are checked for non-empty strings; arrays are validated for correct element types.
- **Empty slug/title rejection:** Tools reject empty or whitespace-only slug and title arguments.
- **Index injection prevention:** Index updates use an upsert (find-or-replace) pattern to prevent duplicate entries.
- **Error isolation:** Each tool call is wrapped in try/catch, returning `isError: true` on failure without crashing the server.

## Data Flow

### Ingest Flow

```
Human drops file(s) into raw/, picks them via the palette,
or right-clicks a folder in the Explorer
                  │
                  ▼
         ┌──────────────────────┐
         │ llmwiki.ingest        │
         │ (extension command)   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ expandSelectionToFiles│ ── walks folders, skips
         │ (files + folders)     │    hidden / build dirs
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ ensureInRaw()         │ ── copies external
         │  + llmIngest() per    │    files into .wiki/raw/
         │  file (LM enrichment) │
         └──────────┬───────────┘
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ Create   │ │ Add to   │ │ Append   │
  │ summary  │ │ index.md │ │ log.md   │
  │ page     │ │          │ │          │
  └──────────┘ └──────────┘ └──────────┘
```

### Query Flow

```
Human runs llmwiki.query and supplies search terms
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Read             │────▶│ Score entries    │
│ wiki/index.md    │     │ by title (3×)   │
└─────────────────┘     │ + summary (2×)  │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Read matched    │
                        │ page bodies     │
                        │ + body score 1× │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Sort by score   │
                        │ Show quick pick │
                        └─────────────────┘
```

### Lint Flow

```
llmwiki.lint or @wiki /lint
         │
         ▼
┌─────────────────┐
│ Scan all wiki    │
│ pages + index    │
└────────┬────────┘
         │
         ├──▶ broken-links (error)         — Links to non-existent .md files
         ├──▶ orphan-pages (warning)       — No inbound links, not indexed
         ├──▶ index-completeness (warning) — Pages missing from index
         ├──▶ stale-entries (error)        — Index entries → deleted files
         ├──▶ missing-pages (info)         — Referenced but non-existent pages
         └──▶ frontmatter-validation       — Type/title/tags/created checks
                    │
                    ▼
              ┌──────────────────┐
              │ Populate Lint    │
              │ Findings tree    │
              └──────────────────┘
```

## GitHub Actions Integration

### CI (`ci.yml`)

Runs on every push and pull request to `main`. Executes lint (`tsc --noEmit`), build, and test (`vitest run` with coverage) for `@llmwiki/shared` and the VS Code extension on Node.js 20.

## Module Dependencies

### Package Dependency Graph

```
┌─────────────────────┐     ┌─────────────────────┐
│   llmwiki-vscode    │     │   External Agents   │
│   (VS Code ext)     │     │   (via MCP)         │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           └────────────┬──────────────┘
                        │
                        ▼
            ┌─────────────────────┐
            │   @llmwiki/shared   │
            │   (core + MCP)      │
            └─────────────────────┘
```

### VS Code Extension Internal Dependencies

```
extension.ts
  └─► commands.ts ──► @llmwiki/shared (readIndex, directoryExists, lintWiki,
  │                    appendEntry, ingestSource, queryWiki, getWikiStatus)
  │                  └─► llmIngest.ts (LM API enrichment)
  └─► wikiPagesTree.ts ──► @llmwiki/shared (readIndex)
  └─► rawSourcesTree.ts ──► @llmwiki/shared (listSources)
  └─► backlinksTree.ts ──► @llmwiki/shared (getBacklinks)
  └─► lintFindingsTree.ts ──► @llmwiki/shared (LintFinding type)
  └─► statusBar.ts ──► @llmwiki/shared (directoryExists, getWikiStatus)
  └─► chatParticipant.ts ──► @llmwiki/shared (queryWiki, lintWiki, writePage, …)
  └─► mcpProvider.ts ──► vscode.lm.registerMcpServerDefinitionProvider
                         (spawns `@llmwiki/shared/mcp-bin` over stdio)
```

### Shared Library Modules

| Module | Exports | Purpose |
|--------|---------|---------|
| `constants.ts` | `API_VERSION` | API version string (`'1'`) included in MCP JSON output. |
| `errors.ts` | `isNotFoundError`, `isPermissionError` | Error classification guards for ENOENT and EACCES. |
| `wiki.ts` | `readPage`, `writePage`, `listPages`, `getPageLinks`, `directoryExists`, `createEntityPage`, `createConceptPage`, `addCrosslinks` | Read/write wiki pages with gray-matter frontmatter. List `.md` files recursively. Extract internal markdown links. Create typed pages with auto-index registration. Append cross-reference links. |
| `index-ops.ts` | `readIndex`, `writeIndex`, `addEntry`, `removeEntry`, `findEntries`, `updateIndexEntry` | Parse and serialize the categorized `index.md` format. CRUD operations on index entries including partial metadata updates. |
| `log.ts` | `appendEntry`, `readLog`, `getRecentEntries` | Append timestamped entries to `log.md`. Parse log entries. Retrieve recent entries. |
| `sources.ts` | `listSources` | List all files in `raw/` with metadata (name, path, size, modified, extension). |
| `backlinks.ts` | `getBacklinks` | Find all pages containing links to a target page via link resolution. |
| `lint.ts` | `lintWiki` | Run 6 health-check categories (including frontmatter-validation) and return structured `LintResult`. |
| `utils.ts` | `slugify`, `excerpt` | Slugify filenames for wiki paths. Extract text excerpts with configurable max length. |
| `search.ts` | `countOccurrences` | Case-insensitive substring occurrence counting for query scoring. |
| `init.ts` | `initWiki` | Initialize a wiki: create directory structure, index, log, and AGENTS.md template. |
| `ingest.ts` | `ingestSource` | Ingest a single source file with duplicate detection. |
| `ingest-context.ts` | `ingestWithContext` | Ingest a source with enriched context: word count, content type detection, related pages, follow-up actions. Used by `wiki_ingest_with_context`. |
| `bulk-ingest.ts` | `bulkIngest` | Batch ingest all files from `raw/`, with progress callbacks and per-file status tracking. |
| `query.ts` | `queryWiki`, `slugifyQuery` | Weighted keyword search across titles (3×), summaries (2×), and bodies (1×). |
| `status.ts` | `getWikiStatus` | Aggregate wiki statistics: source count, page count, last ingest/lint dates, orphan count, index coverage. |
| `mcp/` | `createMcpServer` | MCP server with 14 tools (7 read, 7 write). |
| `mcp/bin.ts` | `llmwiki-mcp` binary | Stdio launcher: validates wiki root arg, builds the server, connects `StdioServerTransport`. |

## Design Decisions

### Why a git repo of markdown files?

- **Zero infrastructure.** No database, no server, no hosting beyond GitHub.
- **Version history for free.** Every wiki change is a git commit. You can diff, revert, branch.
- **Universal readability.** Markdown renders in GitHub, VS Code, Obsidian, any text editor.
- **Agent-friendly.** LLMs read and write markdown natively. No serialization layer needed.

### Why a VS Code extension as the only UI?

- **Primary editor.** Most wiki users already work in VS Code. A native extension removes context-switching between terminal and editor.
- **Rich interaction.** Tree views, quick picks, the status bar, and the `@wiki` chat participant provide discovery and navigation that a CLI cannot match.
- **LM API built in.** The extension uses VS Code's Language Model API for ingestion enrichment, with no extra credentials or HTTP wiring.
- **Single surface.** Concentrating on one client keeps the shared library focused and the test surface small.

### Why a shared library + MCP server?

- **Single source of behaviour.** `@llmwiki/shared` implements every wiki operation. The extension and the MCP server both consume it — there is no behaviour duplication.
- **Agent interop via MCP.** External LLM agents (Claude Desktop, Cursor, …) can read and write the same wiki the extension uses, with strict path-traversal and frontmatter safety checks built in.
- **Testable.** The library is plain TypeScript with no UI dependencies, so the vast majority of behaviour is unit-tested against fixture wikis.

### Why not RAG?

- **Pre-compiled knowledge.** The wiki *is* the synthesis — cross-references are already built, contradictions already flagged. RAG re-derives these on every query.
- **Scale-appropriate.** At personal scale (~100s of sources), `index.md` + keyword search is sufficient. Embedding infrastructure is overhead without proportional value.
- **Inspectable.** You can read the wiki directly. RAG chunks and embeddings are opaque.

### Why `index.md` instead of a search engine?

- **Simplicity.** A single markdown file that both humans and LLMs can read.
- **Sufficient at personal scale.** Hundreds of pages are navigable via a well-organized index.
- **Upgrade path.** When scale demands it, add a local search tool. The index remains useful as a human-readable catalog.

### Why TypeScript/Node.js?

- **Ecosystem.** Rich npm ecosystem for VS Code extension development and markdown tooling (gray-matter, MCP SDK).
- **LLM familiarity.** LLMs are fluent in TypeScript, making the codebase easy to maintain via LLM agents.
- **Modern toolchain.** esbuild for the extension, `tsc` for the shared library, Vitest for testing.

### Why a monorepo with npm workspaces?

- **Shared logic, multiple consumers.** The core wiki operations live in `@llmwiki/shared` and are consumed by both the extension and the MCP server without duplication.
- **Atomic changes.** A single PR can update the shared library and the extension together, avoiding version drift.
- **Simple tooling.** npm workspaces require no additional monorepo tools — `npm ci` at the root resolves all cross-package dependencies via symlinks.
