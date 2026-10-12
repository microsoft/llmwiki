# Changelog

All notable changes to the LLM Wiki VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
