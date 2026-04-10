# Changelog

All notable changes to the LLM Wiki VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
