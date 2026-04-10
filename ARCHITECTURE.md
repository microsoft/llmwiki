# Architecture — LLM Wiki

> Technical design for the LLM Wiki system.

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Human Interface                           │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐           │
│  │ VS Code  │   │   Obsidian   │   │  GitHub Web    │           │
│  │ Extension│   │  (read-only) │   │   (browse)     │           │
│  └────┬─────┘   └──────────────┘   └────────────────┘           │
│       │                                                          │
│       ├──────────── @llmwiki/shared ◄────────┐                   │
│       │                                      │                   │
│       ▼                                      │                   │
│  ┌──────────┐   ┌──────────────┐       ┌─────┴────────┐         │
│  │  plaid   │──▶│ @llmwiki/    │   ┌──▶│ GitHub       │         │
│  │ wiki CLI │   │  shared      │◄──┤   │ Actions      │         │
│  └────┬─────┘   └──────┬───────┘   │   └──────┬───────┘         │
│       │                │           │           │                 │
│       │                │           │           │                 │
│       │          ┌─────┴────────┐  │                             │
│       │          │ MCP Server   │◄─┘── External LLM Agents      │
│       │          │ (stdio)      │      (Claude, GPT, etc.)      │
│       │          └──────────────┘                                │
└───────┼──────────────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
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
  - **`wiki/index.md`** — Content catalog. Every page listed with a link, one-line summary, and metadata. Organized by H2 category headings (`## Entities`, `## Concepts`, `## Sources`). The CLI reads this for query matching and lint checking.
  - **`wiki/log.md`** — Chronological append-only record of operations (ingests, queries, lint passes). Each entry has the format `## [YYYY-MM-DD] verb | subject` followed by detail text.

### Layer 3: Schema (`AGENTS.md`)

The conventions document that tells the LLM how the wiki is structured and what workflows to follow.

- **Co-evolved.** Human and LLM refine this together as patterns emerge.
- **Prescriptive.** Defines page types, frontmatter schema, naming conventions, cross-referencing rules.
- **Auto-generated.** `plaid wiki init` creates a starter template with seven sections: page types, directory structure, frontmatter schema, naming conventions, ingest workflow, lint rules, and cross-referencing guidelines.
- **Starts minimal.** Grows with use as the team discovers what works.

## CLI Tool Architecture

### Technology

- **Runtime:** Node.js ≥ 20
- **Language:** TypeScript (ES2022 target, NodeNext modules, strict mode)
- **Build tools:** [tsup](https://tsup.egoist.dev/) for CLI bundling, [esbuild](https://esbuild.github.io/) for VS Code extension, `tsc` for shared library
- **Test framework:** [Vitest](https://vitest.dev/)
- **CLI framework:** [Commander.js](https://github.com/tj/commander.js/) v14
- **Frontmatter parsing:** [gray-matter](https://github.com/jonschlinkert/gray-matter) (in `@llmwiki/shared`)
- **Binary name:** `plaid` (via `packages/cli/package.json` `bin` field)
- **Monorepo:** npm workspaces with build order: shared → cli → vscode
- **Distribution:** `npm link --workspace=packages/cli` for local development; `vsce package` for VS Code extension

### Command Structure

```
plaid wiki <command> [options]

Commands:
  init      Initialize a new wiki knowledge base
  ingest    Ingest a source file into the wiki
  query     Search the wiki for pages matching a query
  lint      Run health checks on the wiki
  status    Show wiki knowledge base status and statistics
  list      List wiki pages, source files, or index entries
  mcp       Start MCP server for external LLM agent integration

Wiki-level flag:
  --json    Output results as JSON (inherited by all subcommands)

Global flags:
  --help    Show help
  --version Show version
```

The CLI uses a two-level command hierarchy: `plaid` is the top-level program, and `wiki` is a command group that registers the six subcommands. The `--json` flag is defined on the `wiki` group and accessed by subcommands via `cmd.parent?.opts().json`.

### Command Details

#### `plaid wiki init`

Creates the directory structure and initial files for a new wiki.

```
plaid wiki init [--path <dir>]

Creates:
  raw/                # Source document directory
  wiki/               # Generated wiki directory
  wiki/entities/      # Entity pages
  wiki/concepts/      # Concept pages
  wiki/sources/       # Source summary pages
  wiki/index.md       # Content catalog (with Entities, Concepts, Sources sections)
  wiki/log.md         # Operation log (first entry: "initialized")
  AGENTS.md           # Starter schema with wiki conventions
```

Returns `already_initialized` if the `wiki/` directory already exists.

#### `plaid wiki ingest <source>`

Reads a source file and creates a summary page in the wiki.

```
plaid wiki ingest [source] [--path <dir>] [--dry-run] [--force] [--all]

Steps:
  1. Validate wiki is initialized (wiki/ exists)
  2. If --all: run bulk ingest on all files in raw/ (skip already-ingested unless --force)
  3. Read the source file from disk
  4. Slugify the filename (lowercase, strip extension, hyphens for non-alphanumeric)
  5. Check for existing summary page (skip if duplicate; override with --force)
  6. Create wiki/sources/{slug}-summary.md with frontmatter and content preview
  7. Add entry to wiki/index.md under the Sources category
  8. Append entry to wiki/log.md
```

The summary page includes YAML frontmatter (`type: source`, `title`, `source_path`, `ingested` date, `tags`) and a body with file metadata and a 500-character content excerpt.

Duplicate detection: if a summary page already exists for the source, the command returns `status: 'skipped'` unless `--force` is specified. When `--force` is used, the existing entry is removed from the index before re-adding to prevent duplicates.

Bulk ingest (`--all`): processes all files in `raw/`, skipping already-ingested sources. Combined with `--force`, re-ingests everything. Progress is reported per-file.

#### `plaid wiki query <query>`

Searches the wiki for pages matching a keyword query.

```
plaid wiki query <query> [--path <dir>] [--save]

Steps:
  1. Read wiki/index.md to get all indexed entries
  2. Split query into terms, score entries by title (3×), summary (2×)
  3. For each matching entry, read the page body and add body score (1×)
  4. Sort results by score descending
  5. Optionally save results as wiki/queries/{slug}.md (--save)
```

Scoring uses case-insensitive substring occurrence counting. Results include title, path, score, and a 200-character excerpt.

#### `plaid wiki lint`

Runs health checks on the wiki knowledge base.

```
plaid wiki lint [--path <dir>] [--category <categories>]

Checks (6 categories):
  - broken-links (error)       — Internal .md links pointing to non-existent files
  - orphan-pages (warning)     — Pages with no inbound links and not in index
  - index-completeness (warning) — Wiki pages not listed in wiki/index.md
  - stale-entries (error)      — Index entries pointing to deleted files
  - missing-pages (info)       — Referenced pages that do not exist
  - frontmatter-validation     — Validates page frontmatter fields:
      • missing type (error), missing title (error)
      • invalid type value (warning)
      • missing tags (info), missing created (info)

The --category flag accepts a comma-separated list to run only specific checks.
Exit code 1 if any errors are found.
```

Link detection uses a regex that matches `[text](target.md)` patterns, ignoring external URLs (http/https).

#### `plaid wiki status`

Shows current wiki statistics.

```
plaid wiki status [--path <dir>]

Output:
  - Source count (files in raw/)
  - Wiki page count (*.md in wiki/, excluding index.md and log.md)
  - Last ingest date (from log.md)
  - Last lint date (from log.md)
  - Orphan page count (pages not in index)
  - Index coverage percentage
```

Returns zeros and nulls gracefully when the wiki is uninitialized.

#### `plaid wiki list <type>`

Lists wiki pages, source files, or index entries.

```
plaid wiki list <type> [--path <dir>]

Types:
  pages    — List all wiki pages with title, type, tags, and path
  sources  — List all source files in raw/ with name, size, modified date, extension
  entries  — List all index entries with category, title, path, summary, tags
```

Human-readable output uses a formatted table. With `--json`, returns a JSON array of the corresponding objects.

### Output Formats

All commands produce human-readable output by default. With `--json` on the `wiki` group, they emit structured JSON:

```json
{
  "command": "ingest",
  "api_version": "1",
  "status": "success",
  "pages_created": ["sources/my-report-summary.md"],
  "pages_updated": ["index.md", "log.md"],
  "dry_run": false
}
```

```json
{
  "command": "lint",
  "api_version": "1",
  "findings": [
    { "severity": "error", "category": "broken-links", "message": "...", "file": "..." }
  ],
  "errorCount": 1,
  "warningCount": 0,
  "infoCount": 0
}
```

```json
{
  "command": "status",
  "api_version": "1",
  "source_count": 5,
  "wiki_page_count": 3,
  "last_ingest_date": "2025-01-15",
  "last_lint_date": null,
  "orphan_page_count": 0,
  "index_coverage_pct": 100
}
```

## MCP Server Architecture

The MCP server exposes wiki operations via the [Model Context Protocol](https://modelcontextprotocol.io/), enabling external LLM agents (Claude Desktop, Cursor, VS Code Copilot, etc.) to read and write wiki content programmatically. It runs over stdio transport, started via `plaid wiki mcp`.

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
    MCP JSON-RPC (stdio)
         │
         ▼
┌─────────────────────┐
│ plaid wiki mcp      │
│ (StdioTransport)    │
└────────┬────────────┘
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

## Source Code Structure

The project is an npm workspaces monorepo with three packages:

```
llmwiki/
├── packages/
│   ├── shared/                     # @llmwiki/shared — core wiki operations
│   │   ├── src/
│   │   │   ├── index.ts            # Barrel export (re-exports all modules)
│   │   │   ├── constants.ts       # API_VERSION constant for JSON output versioning
│   │   │   ├── wiki.ts             # readPage, writePage, listPages, getPageLinks, directoryExists
│   │   │   ├── index-ops.ts        # readIndex, writeIndex, addEntry, removeEntry, findEntries
│   │   │   ├── log.ts              # appendEntry, readLog, getRecentEntries
│   │   │   ├── sources.ts          # listSources (raw/ directory metadata)
│   │   │   ├── backlinks.ts        # getBacklinks (reverse link resolution)
│   │   │   ├── lint.ts             # lintWiki (6 check categories)
│   │   │   ├── utils.ts            # slugify, excerpt (shared utility functions)
│   │   │   ├── search.ts           # countOccurrences (case-insensitive term matching)
│   │   │   ├── ingest.ts           # ingestSource (single-file ingest with duplicate detection)
│   │   │   ├── bulk-ingest.ts      # bulkIngest (batch ingest for raw/ directory)
│   │   │   ├── query.ts            # queryWiki, slugifyQuery (weighted keyword search)
│   │   │   ├── status.ts           # getWikiStatus (aggregate wiki statistics)
│   │   │   └── mcp/               # MCP server (Model Context Protocol)
│   │   │       ├── index.ts       # Barrel export
│   │   │       ├── server.ts      # createMcpServer — registers tools, handles dispatch
│   │   │       ├── read-tools.ts  # 7 read-only tools (status, query, lint, list, read)
│   │   │       └── write-tools.ts # 7 write tools (write, create, update, crosslink, ingest)
│   │   ├── package.json            # @llmwiki/shared, exports: ./dist/index.js
│   │   └── tsconfig.json           # Extends tsconfig.base.json, composite: true
│   │
│   ├── cli/                        # @llmwiki/cli — Commander.js CLI
│   │   ├── src/
│   │   │   ├── cli.ts              # Entry point — creates Commander program, registers commands
│   │   │   └── commands/
│   │   │       ├── init.ts         # plaid wiki init — directory scaffolding, AGENTS.md template
│   │   │       ├── ingest.ts       # plaid wiki ingest — source → summary page pipeline (single + bulk)
│   │   │       ├── query.ts        # plaid wiki query — keyword search with weighted scoring
│   │   │       ├── lint.ts         # plaid wiki lint — delegates to @llmwiki/shared lintWiki
│   │   │       ├── status.ts       # plaid wiki status — delegates to @llmwiki/shared getWikiStatus
│   │   │       ├── list.ts         # plaid wiki list — list pages, sources, or index entries
│   │   │       └── mcp.ts          # plaid wiki mcp — starts MCP server over stdio
│   │   ├── package.json            # bin: { plaid: ./dist/cli.js }, depends on @llmwiki/shared
│   │   └── tsup.config.ts          # ESM bundle, node20 target, shebang banner
│   │
│   └── vscode/                     # llmwiki-vscode — VS Code extension
│       ├── src/
│       │   ├── extension.ts        # activate/deactivate — registers tree views, commands, status bar
│       │   ├── commands.ts         # 7 command handlers (init, ingest, query, lint, status, openPage, refresh)
│       │   ├── statusBar.ts        # StatusBarManager — live page count with debounced file watching
│       │   ├── wikiPagesTree.ts    # WikiPagesTreeDataProvider — index-based category → page tree
│       │   ├── rawSourcesTree.ts   # RawSourcesTreeDataProvider — raw/ directory browser via listSources
│       │   ├── backlinksTree.ts    # BacklinksTreeDataProvider — reverse links for active editor page
│       │   └── lintFindingsTree.ts # LintFindingsTreeDataProvider — severity-grouped lint results
│       ├── package.json            # VS Code extension manifest (contributes, activationEvents)
│       └── esbuild.config.mjs      # CJS bundle, external: ['vscode'], node20 target
│
├── tests/                          # Test suite (Vitest)
│   ├── shared/                     # Shared library tests
│   ├── cli/                        # CLI command tests
│   ├── vscode/                     # VS Code extension tests
│   └── fixtures/                   # Test fixture data (index, log, wiki samples)
├── .github/
│   └── workflows/
│       ├── ci.yml                  # CI — lint, build, test on push/PR to main
│       └── ingest.yml              # Auto-ingest on push to raw/ or manual dispatch
├── package.json                    # Workspace root — workspaces: [packages/shared, packages/cli, packages/vscode]
├── tsconfig.base.json              # Shared TypeScript config (ES2022, NodeNext, strict)
├── tsconfig.json                   # Root references
├── vitest.config.ts                # tests/**/*.test.ts
├── AGENTS.md                       # Schema conventions (generated by init)
├── README.md
├── ARCHITECTURE.md
├── STRATEGY.md
├── SECURITY.md
└── LICENSE                         # MIT
```

## Wiki Data Structure

A wiki instance (created by `plaid wiki init`) has this layout:

```
wiki-root/
├── raw/                        # Human-curated sources (immutable)
├── wiki/                       # LLM-generated knowledge base
│   ├── index.md                # Content catalog (categorized markdown list)
│   ├── log.md                  # Operation log (append-only)
│   ├── entities/               # Entity pages (people, orgs, tools)
│   ├── concepts/               # Concept pages (ideas, patterns)
│   ├── sources/                # Source summary pages
│   └── queries/                # Saved query results (created by --save)
├── AGENTS.md                   # Schema — wiki conventions
```

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

## Data Flow

### Ingest Flow

```
Human drops file into raw/
         │
         ▼
┌─────────────────────┐
│ plaid wiki ingest    │
│ <source-path>        │
└────────┬────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Validate wiki/   │────▶│ Read source      │
│ exists           │     │ file             │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Slugify filename │
                        │ Extract excerpt  │
                        └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Create   │ │ Add to   │ │ Append   │
              │ summary  │ │ index.md │ │ log.md   │
              │ page     │ │          │ │          │
              └──────────┘ └──────────┘ └──────────┘
```

### Query Flow

```
Human provides search terms
         │
         ▼
┌─────────────────────┐
│ plaid wiki query     │
│ "<terms>"            │
└────────┬────────────┘
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
                        │ Return results  │
                        └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
              ┌──────────┐            ┌──────────────┐
              │ Display  │            │ --save: write │
              │ results  │            │ to queries/   │
              └──────────┘            └──────────────┘
```

### Lint Flow

```
┌─────────────────────┐
│ plaid wiki lint      │
└────────┬────────────┘
         │
         ▼
┌─────────────────┐
│ Scan all wiki    │
│ pages + index    │
└────────┬────────┘
         │
         ├──▶ broken-links (error)       — Links to non-existent .md files
         ├──▶ orphan-pages (warning)     — No inbound links, not indexed
         ├──▶ index-completeness (warning) — Pages missing from index
         ├──▶ stale-entries (error)      — Index entries → deleted files
         ├──▶ missing-pages (info)       — Referenced but non-existent pages
         └──▶ frontmatter-validation     — Type/title/tags/created checks
                    │
                    ▼
              ┌──────────┐
              │ Report   │──▶ Exit code 1 if errorCount > 0
              │ findings │
              └──────────┘
```

## GitHub Actions Integration

### CI (`ci.yml`)

Runs on every push and pull request to `main`. Executes lint (`tsc --noEmit`), build, and test (`vitest run`) across all workspaces on Node.js 20.

### Auto-Ingest (`ingest.yml`)

Triggers on pushes that modify `raw/**` or via manual `workflow_dispatch`. The workflow:

1. Checks out the repo with full history (`fetch-depth: 0`)
2. Installs dependencies and builds all packages
3. Runs `plaid wiki ingest --all --json` to ingest all un-ingested sources in one step
4. Auto-commits wiki updates via [stefanzweifel/git-auto-commit-action@v5](https://github.com/stefanzweifel/git-auto-commit-action)

## VS Code Extension Architecture

The extension (`packages/vscode`) provides a GUI layer over `@llmwiki/shared`. It never duplicates core logic — all wiki operations delegate to the shared library.

### Activation

The extension activates when:
- The workspace contains `wiki/index.md` (`workspaceContains:wiki/index.md`)
- The user runs `llmwiki.init` (`onCommand:llmwiki.init`)

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
        ├── Populated by llmwiki.lint command via setFindings()
        ├── Groups by severity (Errors → Warnings → Info)
        └── Click to open the affected file
```

### Commands

| Command ID | Trigger | Behavior |
|------------|---------|----------|
| `llmwiki.init` | Command palette | Creates wiki scaffold (dirs, index, log, AGENTS.md) |
| `llmwiki.ingest` | Command palette / context menu on raw source | Opens file picker, creates summary page, updates index + log |
| `llmwiki.query` | Command palette | Input box → weighted search → quick pick results |
| `llmwiki.lint` | Command palette | Runs `lintWiki()`, populates Lint Findings tree |
| `llmwiki.status` | Command palette / status bar click | Shows page count, sources, coverage, last ingest in notification |
| `llmwiki.openPage` | Command palette | Quick pick from index entries → opens selected page |
| `llmwiki.refresh` | Command palette | Refreshes Wiki Pages and Raw Sources tree views |

### Status Bar

`StatusBarManager` (left-aligned, priority 100) displays: `$(book) Wiki: N pages`

- **Tooltip:** source count, last ingest date, coverage %
- **Click action:** runs `llmwiki.status`
- **Auto-refresh:** file system watchers on `wiki/**/*.md` and `raw/**` with 300ms debounce
- **Uninitialized state:** shows "Wiki: Not initialized"

### Bundling

The extension uses esbuild (CJS format) with `vscode` as an external. Packaging via `vsce package --no-dependencies` produces a `.vsix` file with `@llmwiki/shared` bundled inline.

## Module Dependencies

### Package Dependency Graph

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   @llmwiki/cli      │     │   llmwiki-vscode     │     │   External Agents   │
│   (Commander.js)    │     │   (VS Code ext)      │     │   (via MCP)         │
└────────┬────────────┘     └────────┬────────────┘     └────────┬────────────┘
         │                           │                           │
         └───────────┬───────────────┼───────────────────────────┘
                     │               │
                     ▼               ▼
         ┌─────────────────────┐
         │   @llmwiki/shared   │
         │   (core operations) │
         └─────────────────────┘
```

### CLI Internal Dependencies

```
cli.ts
  └─► commands/init.ts ──► @llmwiki/shared (log)
  └─► commands/ingest.ts ──► @llmwiki/shared (ingest, bulk-ingest)
  └─► commands/query.ts ──► @llmwiki/shared (query)
  └─► commands/lint.ts ──► @llmwiki/shared (lint)
  └─► commands/status.ts ──► @llmwiki/shared (status)
  └─► commands/list.ts ──► @llmwiki/shared (wiki, index-ops, sources)
  └─► commands/mcp.ts ──► @llmwiki/shared (mcp/server)
```

### VS Code Extension Internal Dependencies

```
extension.ts
  └─► commands.ts ──► @llmwiki/shared (readIndex, directoryExists, lintWiki, appendEntry,
  │                    ingestSource, bulkIngest, queryWiki, getWikiStatus)
  └─► wikiPagesTree.ts ──► @llmwiki/shared (readIndex)
  └─► rawSourcesTree.ts ──► @llmwiki/shared (listSources)
  └─► backlinksTree.ts ──► @llmwiki/shared (getBacklinks)
  └─► lintFindingsTree.ts ──► @llmwiki/shared (LintFinding type)
  └─► statusBar.ts ──► @llmwiki/shared (readIndex, listPages, readLog, directoryExists)
```

### Shared Library Modules

| Module | Exports | Purpose |
|--------|---------|---------|
| `constants.ts` | `API_VERSION` | API version string (`'1'`) included in all JSON output for forward compatibility. |
| `wiki.ts` | `readPage`, `writePage`, `listPages`, `getPageLinks`, `directoryExists` | Read/write wiki pages with gray-matter frontmatter. List `.md` files recursively. Extract internal markdown links. |
| `index-ops.ts` | `readIndex`, `writeIndex`, `addEntry`, `removeEntry`, `findEntries` | Parse and serialize the categorized `index.md` format. CRUD operations on index entries. |
| `log.ts` | `appendEntry`, `readLog`, `getRecentEntries` | Append timestamped entries to `log.md`. Parse log entries. Retrieve recent entries. |
| `sources.ts` | `listSources` | List all files in `raw/` with metadata (name, path, size, modified, extension). |
| `backlinks.ts` | `getBacklinks` | Find all pages containing links to a target page via link resolution. |
| `lint.ts` | `lintWiki` | Run 6 health-check categories (including frontmatter-validation) and return structured `LintResult`. |
| `utils.ts` | `slugify`, `excerpt` | Slugify filenames for wiki paths. Extract text excerpts with configurable max length. |
| `search.ts` | `countOccurrences` | Case-insensitive substring occurrence counting for query scoring. |
| `ingest.ts` | `ingestSource` | Ingest a single source file into the wiki with duplicate detection and `--force` override. |
| `bulk-ingest.ts` | `bulkIngest` | Batch ingest all files from `raw/`, with progress callbacks and per-file status tracking. |
| `query.ts` | `queryWiki`, `slugifyQuery` | Weighted keyword search across index titles (3×), summaries (2×), and page bodies (1×). Optional save to `wiki/queries/`. |
| `status.ts` | `getWikiStatus` | Aggregate wiki statistics: source count, page count, last ingest/lint dates, orphan count, index coverage. |
| `mcp/` | `createMcpServer` | MCP server with 14 tools (7 read, 7 write) for external LLM agent integration via stdio transport. |

## Design Decisions

### Why a git repo of markdown files?

- **Zero infrastructure.** No database, no server, no hosting beyond GitHub.
- **Version history for free.** Every wiki change is a git commit. You can diff, revert, branch.
- **Universal readability.** Markdown renders in GitHub, VS Code, Obsidian, any text editor.
- **Agent-friendly.** LLMs read and write markdown natively. No serialization layer needed.

### Why a CLI as the foundation?

- **Single source of behavior.** The shared library (`@llmwiki/shared`) implements all logic. The CLI, VS Code extension, and GitHub Actions all consume the same library. No behavior duplication.
- **Agent interop via `--json`.** External LLM agents can invoke the CLI and parse structured output. This makes the wiki a shared knowledge layer, not a siloed tool.
- **Testable.** CLI commands are easy to unit test and integration test without UI dependencies.

### Why not RAG?

- **Pre-compiled knowledge.** The wiki is the synthesis — cross-references are already built, contradictions already flagged. RAG re-derives these on every query.
- **Scale-appropriate.** At personal scale (~100s of sources), `index.md` + keyword search is sufficient. Embedding infrastructure is overhead without proportional value.
- **Inspectable.** You can read the wiki directly. RAG chunks and embeddings are opaque.

### Why `index.md` instead of a search engine?

- **Simplicity.** A single markdown file that both humans and LLMs can read.
- **Sufficient at personal scale.** Hundreds of pages are navigable via a well-organized index.
- **Upgrade path.** When scale demands it, add [qmd](https://github.com/tobi/qmd) or a similar local search tool. The index remains useful as a human-readable catalog.

### Why TypeScript/Node.js?

- **Ecosystem.** Rich npm ecosystem for CLI tooling (Commander.js, gray-matter) and VS Code extension development.
- **LLM familiarity.** LLMs are fluent in TypeScript, making the codebase easy to maintain via LLM agents.
- **Modern toolchain.** tsup for CLI bundling, esbuild for VS Code extension, Vitest for testing, ESM throughout.

### Why a monorepo with npm workspaces?

- **Shared logic, multiple surfaces.** The core wiki operations live in `@llmwiki/shared` and are consumed by both the CLI and the VS Code extension without duplication.
- **Atomic changes.** A single PR can update the shared library and both consumers together, avoiding version drift.
- **Simple tooling.** npm workspaces require no additional monorepo tools — `npm ci` at the root resolves all cross-package dependencies via symlinks.

### Why a VS Code extension?

- **Primary editor.** Most wiki users already work in VS Code. A native extension removes context-switching between terminal and editor.
- **Zero logic duplication.** The extension imports `@llmwiki/shared` directly — tree views call `readIndex`, `listSources`, `getBacklinks`, and `lintWiki` without reimplementing any wiki logic.
- **Rich interaction.** Tree views, quick picks, and the status bar provide discovery and navigation that a CLI cannot match.
