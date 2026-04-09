# LLM Wiki

> A personal knowledge base where the LLM does all the maintenance.

## What is this?

LLM Wiki is a pattern — and a toolset — for building personal knowledge bases that compound over time with zero bookkeeping burden. Instead of retrieving from raw documents at query time (like RAG), the LLM **incrementally builds and maintains a persistent wiki**: a structured, interlinked collection of markdown files that sits between you and your raw sources.

When you add a new source, the LLM reads it, extracts key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions, and strengthening the evolving synthesis. The knowledge is compiled once and kept current, not re-derived on every query.

You never write the wiki yourself. You curate sources, ask questions, and think. The LLM handles summarizing, cross-referencing, filing, and every other piece of maintenance that makes a knowledge base actually useful over time.

## Architecture

The system has three layers:

| Layer | Owner | Purpose |
|-------|-------|---------|
| **Raw Sources** | Human | Immutable source documents — articles, papers, notes. The LLM reads but never modifies these. |
| **Wiki** | LLM | Generated markdown files — summaries, entity pages, concept pages, cross-references. The LLM owns this layer entirely. |
| **Schema** | Human + LLM | Conventions document (AGENTS.md) defining wiki structure, workflows, and rules. Co-evolved over time. |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full technical design and data-flow diagrams.

## Prerequisites

- [Node.js](https://nodejs.org/) v20 or later

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd llmwiki

# Install dependencies
npm ci

# Build the CLI
npm run build

# Link globally (optional — makes `plaid` available everywhere)
npm link
```

After building, the CLI is available at `./dist/cli.js` or, if linked, as the `plaid` command.

## CLI Tool (`plaid wiki`)

The primary interface is a TypeScript/Node.js CLI invoked as `plaid wiki <command>`. All subcommands inherit a `--json` flag from the `wiki` group for machine-readable output.

### Commands

| Command | Description |
|---------|-------------|
| `plaid wiki init` | Initialize a new wiki knowledge base with directory structure and schema |
| `plaid wiki ingest <source>` | Ingest a source file — creates a summary page, updates index and log |
| `plaid wiki query <query>` | Search wiki pages by keyword with scored results |
| `plaid wiki lint` | Run health checks — broken links, orphan pages, index completeness |
| `plaid wiki status` | Show wiki statistics — source count, page count, last activity |

### `plaid wiki init`

Creates the directory structure and starter files for a new wiki.

```bash
plaid wiki init [--path <dir>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `.` | Target directory for the wiki |

Creates: `raw/`, `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/index.md`, `wiki/log.md`, and `AGENTS.md` with a starter schema template.

### `plaid wiki ingest <source>`

Reads a source file, creates a summary page in `wiki/sources/`, updates `wiki/index.md`, and appends to `wiki/log.md`.

```bash
plaid wiki ingest <source> [--path <dir>] [--dry-run]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `.` | Wiki root directory |
| `--dry-run` | `false` | Preview changes without writing files |

The source filename is slugified for the output path. Example: `raw/My Report (2024).pdf` produces `wiki/sources/my-report-2024-summary.md`.

### `plaid wiki query <query>`

Searches wiki pages by keyword. Terms are matched against index titles (3× weight), summaries (2× weight), and page bodies (1× weight). Results are returned sorted by score.

```bash
plaid wiki query <query> [--path <dir>] [--save]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `.` | Wiki root directory |
| `--save` | `false` | Save query results as a wiki page under `wiki/queries/` |

### `plaid wiki lint`

Runs health checks on the wiki and reports findings by severity.

```bash
plaid wiki lint [--path <dir>] [--category <categories>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `.` | Wiki root directory |
| `--category <categories>` | all | Comma-separated list of check categories to run |

**Lint categories:**

| Category | Severity | Description |
|----------|----------|-------------|
| `broken-links` | error | Internal links pointing to non-existent `.md` files |
| `orphan-pages` | warning | Pages with no inbound links and not listed in the index |
| `index-completeness` | warning | Wiki pages not listed in `wiki/index.md` |
| `stale-entries` | error | Index entries pointing to deleted files |
| `missing-pages` | info | Referenced pages that do not exist yet |

Exits with code 1 if any errors are found.

### `plaid wiki status`

Displays a summary of wiki health and activity.

```bash
plaid wiki status [--path <dir>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `.` | Wiki root directory |

Reports: source count (`raw/`), wiki page count (`wiki/`), last ingest date, last lint date, orphan page count, and index coverage percentage.

### JSON output

Pass `--json` to the `wiki` group to get structured JSON from any subcommand:

```bash
plaid wiki --json init
plaid wiki --json ingest raw/notes.md
plaid wiki --json lint --category broken-links,stale-entries
```

Example output from `plaid wiki --json ingest raw/notes.md`:

```json
{
  "command": "ingest",
  "status": "success",
  "pages_created": ["sources/notes-summary.md"],
  "pages_updated": ["index.md", "log.md"],
  "dry_run": false
}
```

## GitHub Actions

Two workflows are included in `.github/workflows/`:

- **`ci.yml`** — Runs on push and PR to `main`. Lints (`tsc --noEmit`), builds (`tsup`), and tests (`vitest`).
- **`ingest.yml`** — Triggers on pushes that modify `raw/**` or via manual `workflow_dispatch`. Detects changed files, runs `plaid wiki ingest` on each, and auto-commits wiki updates.

## Development

```bash
npm ci            # Install dependencies
npm run build     # Build with tsup
npm test          # Run tests (vitest)
npm run lint      # Type-check (tsc --noEmit)
npm run dev       # Watch mode (vitest watch)
```

## License

[MIT](./LICENSE) — Copyright (c) Microsoft Corporation.
