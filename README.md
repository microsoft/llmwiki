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

## CLI Tool (`llmwiki`)

The primary interface is a TypeScript/Node.js CLI with structured JSON output for agent interop.

| Command | Description |
|---------|-------------|
| `llmwiki init` | Initialize a new wiki repository with directory structure and schema |
| `llmwiki ingest` | Process a raw source into wiki updates (summaries, cross-references, index) |
| `llmwiki query` | Search the wiki and synthesize an answer with citations |
| `llmwiki lint` | Health-check the wiki for contradictions, orphans, and stale content |
| `llmwiki status` | Show wiki statistics — source count, page count, last activity |

All commands support `--json` for machine-readable output.

## Development Status

🚧 **Early development** — the project is in the design and bootstrapping phase. No functional CLI exists yet. See [STRATEGY.md](./STRATEGY.md) for priorities and [ARCHITECTURE.md](./ARCHITECTURE.md) for technical design.

## License

[MIT](./LICENSE) — Copyright (c) Microsoft Corporation.
