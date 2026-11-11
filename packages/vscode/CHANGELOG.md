# Changelog

All notable changes to the LLM Wiki VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

VS Code deprecated chat participants, and the Copilot harness (which VS Code 1.142 began rolling out as the default for new chat sessions) doesn't run them. This release replaces `@wiki` with skills, a custom agent and a richer MCP server. It is a breaking change.

### Removed

- The `@wiki` chat participant. Migration:

  | Before | Now |
  |--------|-----|
  | `@wiki <question>` | Ask in Agent mode, or `/wiki-ask <question>` |
  | `@wiki /status` | Status bar, **LLM Wiki: Show Status**, or the `wiki_status` tool |
  | `@wiki /lint` | **LLM Wiki: Run Lint**, or the `wiki_lint` tool |
  | `@wiki /fix` | **LLM Wiki: Fix Issues**, then `/wiki-fix` for the rest |
  | `@wiki /save` | `/wiki-save [title]` |

### Added

- Copilot skills contributed by the extension: `/wiki-ask`, `/wiki-research`, `/wiki-ingest`, `/wiki-save` and `/wiki-fix`.
- **Wiki Librarian** custom agent and instructions for files under `.wiki/`.
- Agent plugin (`plugin/`) with the same skills and agent plus a self-contained MCP server, for Copilot CLI, the GitHub Copilot app and other Agent Plugins clients (`copilot plugin install microsoft/llmwiki:plugin`).
- **LLM Wiki: Run Lint** and **LLM Wiki: Fix Remaining Issues with Copilot** commands, and the **Lint Findings** view.
- MCP server: `wiki_fix` and `wiki_delete_page` tools; `wiki_open` and `wiki_init` when the server isn't bound to a wiki root; tool titles and annotations (read-only tools no longer prompt for confirmation in VS Code); server instructions that include the wiki's `AGENTS.md`; structured output for `wiki_status`, `wiki_query`, `wiki_lint` and `wiki_fix`; argument completions; a server icon and version.
- `wiki_create_entity` and `wiki_create_concept` accept `sources`, and `wiki_update_page` accepts `addSources`, so pages created or extended by agents are cleaned up when all of their sources are removed.
- The `llmwiki-mcp` launcher reads `LLMWIKI_ROOT` and, without a wiki root, finds the wiki from the client's workspace roots.
- `wiki_ingest_with_context` reports the existing `summary_page` when a source was already ingested.

### Changed

- **LLM Wiki: Fix Issues** applies the deterministic fixes directly and lists what still needs judgment, instead of opening `@wiki /fix`. It no longer lets the model delete pages without confirmation.
- Removing a source (**Remove Source**, or deleting a file from `raw/`) deletes only the pages that have no other remaining source; pages that also draw on another source are kept.
- The extension's LLM ingest extends an entity or concept page that already exists (adding the new content, tags and source) instead of overwriting it, and keeps a summary page that was edited while the model was running.
- Requires VS Code 1.109 or later.

### Fixed

- `wiki_ingest_with_context` resolves relative `sourcePath` values (such as `raw/article.md`) against the wiki root instead of the server's working directory.
- **Refresh** and **Fix Issues** no longer delete pages whose `sources` list something other than summary pages (such as `raw/` paths or URLs); only `sources/<name>.md` entries are tracked.
- Lint auto-fix no longer adds an unindexed orphan page to the index twice, and creating an entity or concept page that already exists updates its index entry instead of adding a duplicate.
- Reading a page no longer returns frontmatter mutated by an earlier caller when the file's content repeats (gray-matter cache), which could make lint miss findings in long-running processes such as the MCP server.
- The MCP server definition sets `ELECTRON_RUN_AS_NODE` explicitly, so it also starts when spawned by a process that doesn't inherit it.
- Concurrent writers no longer overwrite each other's changes. For example, two ingests that extend the same entity page now both keep their content and `sources`. Page and index updates hold a write lock (`wiki/.llmwiki.lock`) that the extension and every MCP server process share.
- Deleting pages (**Remove Source**, cleanup after a source is removed, `wiki_delete_page`) never deletes `index.md` or `log.md` under another letter case. It also refuses paths that leave the wiki through a symlinked folder.

## [1.0.1] — 2026-10-12

### Security

- Updated `@modelcontextprotocol/sdk` to 1.32.1 (same-origin-only redirects in HTTP client transports, OAuth credentials bound to their issuing authorization server).
- Updated `@hono/node-server`, `hono`, `qs`, `js-yaml`, `fast-uri`, `ip-address`, `proxy-addr`, `brace-expansion` and `@xmldom/xmldom` to patched versions.
- Updated dev dependencies `source-map-js` (CVE-2026-93749), `esbuild`, `undici`, `form-data`, `markdown-it` and `vitest` to patched versions.
- Pinned all GitHub Actions to full-length commit SHAs.

### Fixed

- `@wiki` chat history now stays in chat turn order.

## [0.1.2] — 2026-06-03

### Changed

- Renamed the internal `@llmwiki/shared` package to `@llmwiki/core`.

### Fixed

- Bundled the MCP stdio launcher into `out/mcp-server.cjs` so the MCP server registers correctly in the packaged VSIX (previously failed to resolve outside a dev checkout).

## [0.1.0] — 2025-01-01

### Added

- **Wiki Pages tree view** — Browse all wiki pages in a dedicated sidebar panel
- **Raw Sources tree view** — View and manage ingested source files
- **Backlinks tree view** — Explore cross-references between wiki pages
- **Lint Findings tree view** — Review quality issues found during linting
- **Status bar integration** — Wiki health and page count at a glance
- **Initialize Wiki** command (`llmwiki.init`) — Create a new wiki in the workspace
- **Ingest Source** command (`llmwiki.ingest`) — Add source files to the wiki
- **Query Wiki** command (`llmwiki.query`) — Search wiki content
- **Lint Wiki** command (`llmwiki.lint`) — Run quality checks on wiki pages
- **Show Status** command (`llmwiki.status`) — Display wiki statistics
- **Open Page** command (`llmwiki.openPage`) — Navigate to a wiki page
- **Refresh** command (`llmwiki.refresh`) — Reload all tree views
- Context menu action for ingesting raw sources
- Auto-activation when workspace contains `wiki/index.md`
