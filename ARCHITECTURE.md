# Architecture — LLM Wiki

> Technical design for the LLM Wiki system.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Human Interface                     │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ VS Code  │   │   Obsidian   │   │  GitHub Web    │  │
│  │          │   │  (read-only) │   │   (browse)     │  │
│  └────┬─────┘   └──────────────┘   └────────────────┘  │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────┐   ┌──────────────┐                        │
│  │  plaid   │◄──│ GitHub       │                        │
│  │ wiki CLI │   │ Actions      │                        │
│  └────┬─────┘   └──────┬───────┘                        │
│       │                │                                │
└───────┼────────────────┼────────────────────────────────┘
        │                │
        ▼                ▼
┌─────────────────────────────────────────────────────────┐
│                    Git Repository                       │
│                                                         │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ raw/       │  │ wiki/      │  │ AGENTS.md         │  │
│  │ (sources)  │──▶│ (generated)│◀─│ (schema)          │  │
│  │ immutable  │  │ LLM-owned  │  │ conventions       │  │
│  └────────────┘  └────────────┘  └───────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
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
- **Build tool:** [tsup](https://tsup.egoist.dev/) — bundles `src/cli.ts` to ESM with a `#!/usr/bin/env node` banner
- **Test framework:** [Vitest](https://vitest.dev/)
- **CLI framework:** [Commander.js](https://github.com/tj/commander.js/) v14
- **Frontmatter parsing:** [gray-matter](https://github.com/jonschlinkert/gray-matter)
- **Binary name:** `plaid` (via `package.json` `bin` field)
- **Distribution:** `npm link` for local development

### Command Structure

```
plaid wiki <command> [options]

Commands:
  init      Initialize a new wiki knowledge base
  ingest    Ingest a source file into the wiki
  query     Search the wiki for pages matching a query
  lint      Run health checks on the wiki
  status    Show wiki knowledge base status and statistics

Wiki-level flag:
  --json    Output results as JSON (inherited by all subcommands)

Global flags:
  --help    Show help
  --version Show version
```

The CLI uses a two-level command hierarchy: `plaid` is the top-level program, and `wiki` is a command group that registers the five subcommands. The `--json` flag is defined on the `wiki` group and accessed by subcommands via `cmd.parent?.opts().json`.

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
plaid wiki ingest <source> [--path <dir>] [--dry-run]

Steps:
  1. Validate wiki is initialized (wiki/ exists)
  2. Read the source file from disk
  3. Slugify the filename (lowercase, strip extension, hyphens for non-alphanumeric)
  4. Create wiki/sources/{slug}-summary.md with frontmatter and content preview
  5. Add entry to wiki/index.md under the Sources category
  6. Append entry to wiki/log.md
```

The summary page includes YAML frontmatter (`type: source`, `title`, `source_path`, `ingested` date, `tags`) and a body with file metadata and a 500-character content excerpt.

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

Checks (5 categories):
  - broken-links (error)       — Internal .md links pointing to non-existent files
  - orphan-pages (warning)     — Pages with no inbound links and not in index
  - index-completeness (warning) — Wiki pages not listed in wiki/index.md
  - stale-entries (error)      — Index entries pointing to deleted files
  - missing-pages (info)       — Referenced pages that do not exist

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

### Output Formats

All commands produce human-readable output by default. With `--json` on the `wiki` group, they emit structured JSON:

```json
{
  "command": "ingest",
  "status": "success",
  "pages_created": ["sources/my-report-summary.md"],
  "pages_updated": ["index.md", "log.md"],
  "dry_run": false
}
```

```json
{
  "command": "lint",
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
  "source_count": 5,
  "wiki_page_count": 3,
  "last_ingest_date": "2025-01-15",
  "last_lint_date": null,
  "orphan_page_count": 0,
  "index_coverage_pct": 100
}
```

## Source Code Structure

```
llmwiki/
├── src/                        # CLI source code (TypeScript)
│   ├── cli.ts                  # Entry point — creates Commander program, registers commands
│   ├── commands/
│   │   ├── init.ts             # plaid wiki init — directory scaffolding, AGENTS.md template
│   │   ├── ingest.ts           # plaid wiki ingest — source → summary page pipeline
│   │   ├── query.ts            # plaid wiki query — keyword search with weighted scoring
│   │   ├── lint.ts             # plaid wiki lint — 5 health-check categories
│   │   └── status.ts           # plaid wiki status — aggregate stats from filesystem + log
│   └── lib/
│       ├── wiki.ts             # readPage, writePage, listPages, getPageLinks (gray-matter)
│       ├── index.ts            # readIndex, writeIndex, addEntry, removeEntry, findEntries
│       └── log.ts              # appendEntry, readLog, getRecentEntries
├── tests/                      # Test suite (Vitest)
│   ├── unit/                   # Unit tests (cli structure, ingest workflow)
│   ├── commands/               # Command integration tests (init, ingest, query, lint, status)
│   ├── lib/                    # Library unit tests (wiki, index, log)
│   ├── e2e/                    # End-to-end CLI integration tests
│   └── fixtures/               # Test fixture data (index, log, wiki samples)
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI — lint, build, test on push/PR to main
│       └── ingest.yml          # Auto-ingest on push to raw/ or manual dispatch
├── package.json                # bin: { plaid: ./dist/cli.js }
├── tsconfig.json               # ES2022, NodeNext, strict
├── tsup.config.ts              # ESM bundle, node20 target, shebang banner
├── vitest.config.ts            # tests/**/*.test.ts
├── AGENTS.md                   # Schema conventions (generated by init)
├── README.md
├── ARCHITECTURE.md
├── STRATEGY.md
├── SECURITY.md
└── LICENSE                     # MIT
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
         └──▶ missing-pages (info)       — Referenced but non-existent pages
                    │
                    ▼
              ┌──────────┐
              │ Report   │──▶ Exit code 1 if errorCount > 0
              │ findings │
              └──────────┘
```

## GitHub Actions Integration

### CI (`ci.yml`)

Runs on every push and pull request to `main`. Executes lint (`tsc --noEmit`), build (`tsup`), and test (`vitest run`) on Node.js 20.

### Auto-Ingest (`ingest.yml`)

Triggers on pushes that modify `raw/**` or via manual `workflow_dispatch`. The workflow:

1. Checks out the repo with full history (`fetch-depth: 0`)
2. Installs dependencies and builds the CLI
3. Detects changed files in `raw/` using `git diff` (or `find` for manual dispatch)
4. Runs `node dist/cli.js wiki ingest "$file"` for each changed file
5. Auto-commits wiki updates via [stefanzweifel/git-auto-commit-action@v5](https://github.com/stefanzweifel/git-auto-commit-action)

## Module Dependencies

```
cli.ts
  └─► commands/init.ts ──► lib/log.ts
  └─► commands/ingest.ts ──► lib/wiki.ts, lib/index.ts, lib/log.ts
  └─► commands/query.ts ──► lib/wiki.ts, lib/index.ts, lib/log.ts
  └─► commands/lint.ts ──► lib/wiki.ts, lib/index.ts
  └─► commands/status.ts ──► lib/wiki.ts, lib/index.ts, lib/log.ts
```

### Core Libraries

| Module | Exports | Purpose |
|--------|---------|---------|
| `lib/wiki.ts` | `readPage`, `writePage`, `listPages`, `getPageLinks` | Read/write wiki pages with gray-matter frontmatter. List `.md` files recursively. Extract internal markdown links. |
| `lib/index.ts` | `readIndex`, `writeIndex`, `addEntry`, `removeEntry`, `findEntries` | Parse and serialize the categorized `index.md` format. CRUD operations on index entries. |
| `lib/log.ts` | `appendEntry`, `readLog`, `getRecentEntries` | Append timestamped entries to `log.md`. Parse log entries. Retrieve recent entries. |

## Design Decisions

### Why a git repo of markdown files?

- **Zero infrastructure.** No database, no server, no hosting beyond GitHub.
- **Version history for free.** Every wiki change is a git commit. You can diff, revert, branch.
- **Universal readability.** Markdown renders in GitHub, VS Code, Obsidian, any text editor.
- **Agent-friendly.** LLMs read and write markdown natively. No serialization layer needed.

### Why a CLI as the foundation?

- **Single source of behavior.** The CLI implements all logic. GitHub Actions calls it. Extensions can wrap it. No behavior duplication.
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

- **Ecosystem.** Rich npm ecosystem for CLI tooling (Commander.js, gray-matter).
- **LLM familiarity.** LLMs are fluent in TypeScript, making the codebase easy to maintain via LLM agents.
- **Modern toolchain.** tsup for fast bundling, Vitest for testing, ESM throughout.
