# Strategy — LLM Wiki

> References: [idea.md](./idea.md) | [research_findings_hosted_git_integration.yaml](docs/plan/llmwiki/initial-research_findings_hosted_git_integration.yaml)

## Ultimate Goal

A personal knowledge base where the LLM does all the maintenance — summarizing, cross-referencing, filing, updating — so the human only curates sources, asks questions, and thinks. The wiki compounds over time with zero bookkeeping burden. It lives in a GitHub repo, is browsable from VS Code, Obsidian, and the web, and is operable by both humans and other LLM agents via a CLI.

## What Better Means

- **Less infrastructure**: no self-hosted servers, no custom middleware, no databases. The entire system runs on GitHub (hosting + Actions), a local git clone, and lightweight client tools (VS Code extension, CLI). If you can push to git, the system works.
- **More compound value**: every source ingested, every question asked, every lint pass makes the wiki richer. Cross-references are already built. Contradictions are already flagged. The cost of adding the 100th source is no higher than the 1st.
- **Agent interop**: external LLM agents can talk to the wiki via `plaid wiki` CLI commands with structured JSON output. The wiki becomes a shared knowledge layer, not a siloed tool.
- **Interactive when you want it**: VS Code extension provides drag-and-drop source upload, wiki browsing, and query interface — no terminal required for casual use.
- **Automated when you don't**: push a source to `raw/` and walk away. GitHub Actions handles the ingest.

## Current Priority

1. **CLI tool (`plaid wiki`)** — the foundation. Implement `init`, `ingest`, `query`, `lint`, `status` commands. TypeScript/Node.js. `--json` flag for agent interop. This unblocks everything else — the VS Code extension wraps it, GitHub Actions calls it, external agents invoke it.
2. **GitHub Actions workflow** — `ingest.yml` that triggers on push to `raw/**`, runs the CLI ingest command, commits wiki updates. This is the automation backbone.
3. **VS Code extension** — interactive layer on top of the CLI. Tree view for wiki browsing, command palette for operations, webview for rendered pages. Build after CLI is stable.
4. **Schema (AGENTS.md)** — co-evolve with the CLI as we discover what conventions work. Start minimal, grow with use.

## What Not To Try

- **Self-hosted git forges (Gitea, Forgejo, GitLab)** — too much infra for personal use. Maintaining a server, updates, backups, TLS is overhead that doesn't serve the goal. GitHub gives us everything we need with zero ops.
- **Custom webhook middleware** — GitHub Actions replaces this entirely. No need for a separate service listening for push events.
- **Embedding-based RAG infrastructure** — the wiki IS the pre-compiled knowledge. At personal scale (~100s of sources), the index file + QMD search is sufficient. Don't build a vector database.
- **Multi-user/team features** — scope is personal use only. No auth complexity, no collaboration workflows, no review processes. One user, one repo, one wiki.
- **Obsidian plugin development** — Obsidian works great as a passive reader of the git repo. Don't invest in custom Obsidian plugins when VS Code is the active workspace.
- **Complex MCP server from day one** — start with CLI `--json` output. Add MCP server mode (`plaid wiki mcp`) later when agent interop patterns stabilize.
