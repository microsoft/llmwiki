# Architecture — LLM Wiki

> Technical design for the LLM Wiki system.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Human Interface                     │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ VS Code  │   │   Obsidian   │   │  GitHub Web    │  │
│  │Extension │   │  (read-only) │   │   (browse)     │  │
│  └────┬─────┘   └──────────────┘   └────────────────┘  │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────┐   ┌──────────────┐                        │
│  │ llmwiki  │◄──│ GitHub       │                        │
│  │   CLI    │   │ Actions      │                        │
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
- **Typed pages.** Summaries, entity pages, concept pages, comparisons, syntheses.
- **Two special files:**
  - **`wiki/index.md`** — Content catalog. Every page listed with a link, one-line summary, and metadata. Organized by category. The LLM reads this first when answering queries to find relevant pages.
  - **`wiki/log.md`** — Chronological append-only record of operations (ingests, queries, lint passes). Each entry prefixed with `## [YYYY-MM-DD] operation | description` for parseability.

### Layer 3: Schema (`AGENTS.md`)

The conventions document that tells the LLM how the wiki is structured and what workflows to follow.

- **Co-evolved.** Human and LLM refine this together as patterns emerge.
- **Prescriptive.** Defines page formats, naming conventions, frontmatter fields, cross-referencing rules.
- **Workflow definitions.** Step-by-step procedures for ingest, query, and lint operations.
- **Starts minimal.** Grows with use as the team discovers what works.

## CLI Tool Architecture

### Technology

- **Runtime:** Node.js (LTS)
- **Language:** TypeScript
- **Package name:** `llmwiki`
- **Distribution:** npm (local install or npx)

### Command Structure

```
llmwiki <command> [options]

Commands:
  init      Initialize a new wiki repository
  ingest    Process raw sources into wiki updates
  query     Search the wiki and synthesize answers
  lint      Health-check wiki consistency
  status    Show wiki statistics

Global Flags:
  --json    Output structured JSON (for agent interop)
  --help    Show help
  --version Show version
```

### Command Details

#### `llmwiki init`

Creates the directory structure and initial files for a new wiki.

```
llmwiki init [--path <dir>]

Creates:
  raw/              # Source document directory
  wiki/             # Generated wiki directory
  wiki/index.md     # Empty content catalog
  wiki/log.md       # Empty operation log
  AGENTS.md         # Starter schema with default conventions
```

#### `llmwiki ingest`

Processes one or more raw sources and updates the wiki.

```
llmwiki ingest <source-path> [--batch] [--dry-run]

Steps:
  1. Read the source document
  2. Extract key information
  3. Create or update wiki pages (summaries, entities, concepts)
  4. Update cross-references across affected pages
  5. Update wiki/index.md
  6. Append entry to wiki/log.md
  7. Commit changes to git
```

#### `llmwiki query`

Searches the wiki and synthesizes an answer.

```
llmwiki query "<question>" [--save] [--format md|json]

Steps:
  1. Read wiki/index.md to identify relevant pages
  2. Read identified pages
  3. Synthesize answer with citations
  4. Optionally save the answer as a new wiki page (--save)
```

#### `llmwiki lint`

Runs health checks on the wiki.

```
llmwiki lint [--fix] [--category <type>]

Checks:
  - Contradictions between pages
  - Stale claims superseded by newer sources
  - Orphan pages with no inbound links
  - Concepts mentioned but lacking their own page
  - Missing cross-references
  - Broken internal links
  - Index completeness (every page listed)
```

#### `llmwiki status`

Shows current wiki statistics.

```
llmwiki status

Output:
  - Source count (files in raw/)
  - Wiki page count (files in wiki/)
  - Last ingest date
  - Last lint date
  - Orphan page count
  - Index coverage percentage
```

### Output Formats

All commands produce human-readable output by default. With `--json`, they emit structured JSON:

```jsonc
{
  "command": "ingest",
  "status": "success",
  "source": "raw/articles/llm-agents.md",
  "pages_created": ["wiki/llm-agents-summary.md"],
  "pages_updated": ["wiki/index.md", "wiki/agents.md"],
  "log_entry": "## [2025-01-15] ingest | LLM Agents Overview"
}
```

## Directory Structure

```
llmwiki-repo/
├── raw/                        # Human-curated sources (immutable)
│   ├── articles/
│   ├── papers/
│   └── assets/                 # Images, data files
├── wiki/                       # LLM-generated knowledge base
│   ├── index.md                # Content catalog
│   ├── log.md                  # Operation log
│   ├── entities/               # Entity pages (people, orgs, tools)
│   ├── concepts/               # Concept pages (ideas, patterns)
│   └── sources/                # Source summary pages
├── AGENTS.md                   # Schema — wiki conventions
├── .github/
│   └── workflows/
│       └── ingest.yml          # Auto-ingest on push to raw/
├── src/                        # CLI source code
│   ├── cli.ts                  # Entry point and command router
│   ├── commands/
│   │   ├── init.ts
│   │   ├── ingest.ts
│   │   ├── query.ts
│   │   ├── lint.ts
│   │   └── status.ts
│   └── lib/
│       ├── wiki.ts             # Wiki read/write operations
│       ├── index.ts            # Index file management
│       ├── log.ts              # Log file management
│       └── git.ts              # Git operations
├── package.json
├── tsconfig.json
└── README.md
```

## Data Flow

### Ingest Flow

```
Human drops file into raw/
         │
         ▼
┌─────────────────┐
│ llmwiki ingest   │
│ <source-path>    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Read source      │────▶│ Extract entities,│
│ document         │     │ concepts, claims │
└─────────────────┘     └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Create/  │ │ Update   │ │ Update   │
              │ update   │ │ cross-   │ │ index +  │
              │ pages    │ │ refs     │ │ log      │
              └──────────┘ └──────────┘ └──────────┘
                    │            │            │
                    └────────────┼────────────┘
                                 ▼
                          ┌──────────┐
                          │ Git      │
                          │ commit   │
                          └──────────┘
```

### Query Flow

```
Human asks question
         │
         ▼
┌─────────────────┐
│ llmwiki query    │
│ "<question>"     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Read             │────▶│ Identify         │
│ wiki/index.md    │     │ relevant pages   │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Read relevant    │
                        │ wiki pages       │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Synthesize       │
                        │ answer + cite    │
                        └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
              ┌──────────┐            ┌──────────────┐
              │ Return   │            │ --save: write │
              │ answer   │            │ as wiki page  │
              └──────────┘            └──────────────┘
```

### Lint Flow

```
┌─────────────────┐
│ llmwiki lint     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Scan all wiki    │
│ pages            │
└────────┬────────┘
         │
         ├──▶ Check internal links (broken?)
         ├──▶ Check index coverage (every page listed?)
         ├──▶ Check orphan pages (no inbound links?)
         ├──▶ Check contradictions (conflicting claims?)
         ├──▶ Check staleness (superseded by newer sources?)
         └──▶ Check missing pages (concepts mentioned but no page?)
                    │
                    ▼
              ┌──────────┐
              │ Report   │──▶ --fix: auto-remediate
              │ findings │
              └──────────┘
```

## GitHub Actions Integration

A workflow triggers on pushes to the `raw/` directory, automating the ingest pipeline.

```yaml
# .github/workflows/ingest.yml
name: Auto-Ingest Sources
on:
  push:
    paths:
      - 'raw/**'

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: |
          # Identify new/changed files in raw/
          CHANGED=$(git diff --name-only HEAD~1 -- raw/)
          for file in $CHANGED; do
            npx llmwiki ingest "$file" --json
          done
      - run: |
          git config user.name "llmwiki[bot]"
          git config user.email "llmwiki[bot]@users.noreply.github.com"
          git add wiki/ AGENTS.md
          git diff --cached --quiet || git commit -m "wiki: auto-ingest from raw/ update"
          git push
```

**Key design points:**

- The workflow detects which files in `raw/` changed and ingests only those.
- Wiki updates are committed by a bot account, keeping human and LLM commits distinct.
- The `--json` flag enables structured logging of ingest results in the Actions output.

## VS Code Extension Integration

The VS Code extension wraps the CLI to provide a graphical interface. It does not implement its own logic — the CLI is the single source of behavior.

| Feature | Implementation |
|---------|---------------|
| **Tree view** | Reads `wiki/index.md` to build a navigable tree of wiki pages in the sidebar. |
| **Command palette** | Exposes `LLM Wiki: Ingest`, `LLM Wiki: Query`, `LLM Wiki: Lint`, `LLM Wiki: Status` commands that shell out to the CLI. |
| **Webview** | Renders wiki pages as formatted HTML with working internal links. |
| **Source upload** | Drag-and-drop files into `raw/` via the tree view, then triggers ingest. |
| **Status bar** | Shows wiki stats (page count, last ingest) from `llmwiki status --json`. |

**Dependency chain:** The extension depends on a stable CLI. It is Priority 3 — built after the CLI and GitHub Actions workflow are working.

## Design Decisions

### Why a git repo of markdown files?

- **Zero infrastructure.** No database, no server, no hosting beyond GitHub.
- **Version history for free.** Every wiki change is a git commit. You can diff, revert, branch.
- **Universal readability.** Markdown renders in GitHub, VS Code, Obsidian, any text editor.
- **Agent-friendly.** LLMs read and write markdown natively. No serialization layer needed.

### Why a CLI as the foundation?

- **Single source of behavior.** The CLI implements all logic. GitHub Actions calls it. The VS Code extension wraps it. No behavior duplication.
- **Agent interop via `--json`.** External LLM agents can invoke the CLI and parse structured output. This makes the wiki a shared knowledge layer, not a siloed tool.
- **Testable.** CLI commands are easy to unit test and integration test without UI dependencies.

### Why not RAG?

- **Pre-compiled knowledge.** The wiki is the synthesis — cross-references are already built, contradictions already flagged. RAG re-derives these on every query.
- **Scale-appropriate.** At personal scale (~100s of sources), `index.md` + simple search is sufficient. Embedding infrastructure is overhead without proportional value.
- **Inspectable.** You can read the wiki directly. RAG chunks and embeddings are opaque.

### Why `index.md` instead of a search engine?

- **Simplicity.** A single markdown file that both humans and LLMs can read.
- **Sufficient at personal scale.** Hundreds of pages are navigable via a well-organized index.
- **Upgrade path.** When scale demands it, add [qmd](https://github.com/tobi/qmd) or a similar local search tool. The index remains useful as a human-readable catalog.

### Why TypeScript/Node.js?

- **Ecosystem.** Rich npm ecosystem for CLI tooling (commander, inquirer, chalk).
- **VS Code affinity.** The VS Code extension is also TypeScript — shared types and utilities.
- **LLM familiarity.** LLMs are fluent in TypeScript, making the codebase easy to maintain via LLM agents.
