# MCP Tools Reference — LLM Wiki

> Complete reference for the 14 MCP tools exposed by the `llmwiki` server.

## Table of Contents

- [Overview](#overview)
- [Read Tools](#read-tools)
  - [wiki_status](#wiki_status)
  - [wiki_query](#wiki_query)
  - [wiki_lint](#wiki_lint)
  - [wiki_list_pages](#wiki_list_pages)
  - [wiki_list_sources](#wiki_list_sources)
  - [wiki_read_page](#wiki_read_page)
  - [wiki_read_index](#wiki_read_index)
- [Write Tools](#write-tools)
  - [wiki_write_page](#wiki_write_page)
  - [wiki_create_entity](#wiki_create_entity)
  - [wiki_create_concept](#wiki_create_concept)
  - [wiki_update_page](#wiki_update_page)
  - [wiki_add_crosslinks](#wiki_add_crosslinks)
  - [wiki_update_index](#wiki_update_index)
  - [wiki_ingest_with_context](#wiki_ingest_with_context)
- [Security Model](#security-model)
- [Example Workflows](#example-workflows)
- [See Also](#see-also)

---

## Overview

The `llmwiki` MCP server exposes wiki operations over the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) using stdio transport. An MCP-compatible client (such as a Copilot agent or VS Code extension) connects to the server and invokes tools by name with JSON parameters.

| Property | Value |
|----------|-------|
| **Server name** | `llmwiki` |
| **Version** | `0.1.0` |
| **Protocol** | MCP over stdio |
| **Launcher** | `llmwiki-mcp [wiki-root]` (bin from `@llmwiki/core`) |
| **VS Code** | Auto-registered by the LLM Wiki extension via `mcpServerDefinitionProviders` |
| **Response format** | JSON text content |
| **Error shape** | `{ isError: true }` with an error message string |

### Connecting

**VS Code (Copilot Chat)** — install the LLM Wiki extension and initialize a wiki (`LLM Wiki: Initialize`). The server appears in the Copilot MCP picker automatically; no `.vscode/mcp.json` editing required.

**Claude Desktop / Cursor / standalone clients** — register the stdio launcher in your client's MCP config:

```jsonc
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["-y", "-p", "@llmwiki/core", "llmwiki-mcp", "/abs/path/to/your-project/.wiki"]
    }
  }
}
```

The wiki-root argument is optional; when omitted the launcher defaults to `<cwd>/.wiki`. Install `@llmwiki/core` globally (`npm i -g @llmwiki/core`) to skip the `npx` indirection.

The server provides **7 read tools** for querying and inspecting the wiki, and **7 write tools** for creating, updating, and maintaining content. All tools accept a single JSON object as input and return a single JSON object as output.

---

## Read Tools

### `wiki_status`

Return wiki status including source count, page count, lint dates, orphan pages, and index coverage.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | This tool takes no parameters. |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `sourceCount` | number | Total raw source files |
| `wikiPageCount` | number | Total generated wiki pages |
| `lastIngestDate` | string | ISO timestamp of last ingest |
| `lastLintDate` | string | ISO timestamp of last lint run |
| `orphanPageCount` | number | Pages not referenced in the index |
| `indexCoveragePct` | number | Percentage of pages covered by the index |

**Example**

```json
// Request
{ "tool": "wiki_status", "input": {} }

// Response
{
  "sourceCount": 12,
  "wikiPageCount": 34,
  "lastIngestDate": "2025-01-15T10:30:00Z",
  "lastLintDate": "2025-01-15T09:00:00Z",
  "orphanPageCount": 2,
  "indexCoveragePct": 94.1
}
```

---

### `wiki_query`

Search the wiki for pages matching a free-text query. Returns matched pages with relevance scores.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | **Yes** | Free-text search query |

**Output**

Array of objects:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page title |
| `path` | string | Relative path within the wiki |
| `score` | number | Relevance score (higher is better) |
| `excerpt` | string | Matching text excerpt |

**Example**

```json
// Request
{ "tool": "wiki_query", "input": { "query": "transformer attention mechanism" } }

// Response
[
  {
    "title": "Attention Mechanisms",
    "path": "concepts/attention-mechanisms.md",
    "score": 0.92,
    "excerpt": "The transformer architecture relies on multi-head self-attention..."
  },
  {
    "title": "Transformer",
    "path": "entities/transformer.md",
    "score": 0.85,
    "excerpt": "Introduced in 'Attention Is All You Need' (2017)..."
  }
]
```

---

### `wiki_lint`

Lint the wiki and return findings grouped by severity (error, warning, info) with an optional category filter.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter to a single lint category. One of: `broken-links`, `orphan-pages`, `index-completeness`, `stale-entries`, `missing-pages`, `frontmatter-validation` |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `findings` | array | Array of finding objects with `severity`, `category`, `message`, and `path` |
| `errorCount` | number | Total errors |
| `warningCount` | number | Total warnings |
| `infoCount` | number | Total info-level findings |

**Example**

```json
// Request
{ "tool": "wiki_lint", "input": { "category": "broken-links" } }

// Response
{
  "findings": [
    {
      "severity": "error",
      "category": "broken-links",
      "message": "Link target 'concepts/rlhf.md' does not exist",
      "path": "entities/chatgpt.md"
    }
  ],
  "errorCount": 1,
  "warningCount": 0,
  "infoCount": 0
}
```

---

### `wiki_list_pages`

List all wiki pages with their file paths and frontmatter metadata.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | This tool takes no parameters. |

**Output**

Array of objects:

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Relative path within the wiki |
| `frontmatter` | object | Parsed frontmatter containing `type`, `title`, `tags`, and other metadata |

**Example**

```json
// Request
{ "tool": "wiki_list_pages", "input": {} }

// Response
[
  {
    "path": "concepts/attention-mechanisms.md",
    "frontmatter": { "type": "concept", "title": "Attention Mechanisms", "tags": ["transformers", "nlp"] }
  },
  {
    "path": "entities/openai.md",
    "frontmatter": { "type": "entity", "title": "OpenAI", "tags": ["organization", "ai-lab"] }
  }
]
```

---

### `wiki_list_sources`

List all raw source files with name, path, size, modified date, and extension.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | This tool takes no parameters. |

**Output**

Array of objects:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | File name |
| `path` | string | Relative path from project root |
| `size` | number | File size in bytes |
| `modified` | string | ISO timestamp of last modification |
| `extension` | string | File extension (e.g. `.pdf`, `.md`) |

**Example**

```json
// Request
{ "tool": "wiki_list_sources", "input": {} }

// Response
[
  {
    "name": "attention-is-all-you-need.pdf",
    "path": "raw/attention-is-all-you-need.pdf",
    "size": 2145832,
    "modified": "2025-01-10T08:00:00Z",
    "extension": ".pdf"
  }
]
```

---

### `wiki_read_page`

Read a single wiki page by relative path. Returns parsed frontmatter and body content.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | **Yes** | Relative path within `wiki/` (e.g. `"concepts/ai.md"`) |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `frontmatter` | object | Parsed YAML frontmatter (`type`, `title`, `tags`, etc.) |
| `body` | string | Markdown body content (everything after the frontmatter) |

> **Security:** Path traversal protection via `assertWithinDir` — the resolved path must remain within the wiki directory.

**Example**

```json
// Request
{ "tool": "wiki_read_page", "input": { "path": "concepts/attention-mechanisms.md" } }

// Response
{
  "frontmatter": {
    "type": "concept",
    "title": "Attention Mechanisms",
    "tags": ["transformers", "nlp"]
  },
  "body": "# Attention Mechanisms\n\nAttention allows a model to focus on relevant parts of the input..."
}
```

---

### `wiki_read_index`

Read the wiki index file and return parsed entries with path, title, summary, category, and tags.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | This tool takes no parameters. |

**Output**

Array of objects:

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Relative path of the indexed page |
| `title` | string | Page title |
| `summary` | string | Brief summary |
| `category` | string | Index category |
| `tags` | string[] | Associated tags |

**Example**

```json
// Request
{ "tool": "wiki_read_index", "input": {} }

// Response
[
  {
    "path": "concepts/attention-mechanisms.md",
    "title": "Attention Mechanisms",
    "summary": "How attention allows models to focus on relevant input parts.",
    "category": "concepts",
    "tags": ["transformers", "nlp"]
  }
]
```

---

## Write Tools

### `wiki_write_page`

Create or overwrite a wiki page with frontmatter and body content. Automatically updates the index.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pagePath` | string | **Yes** | Relative path for the page (e.g. `"concepts/rlhf.md"`) |
| `title` | string | **Yes** | Page title for frontmatter |
| `type` | string | **Yes** | Page type (e.g. `"concept"`, `"entity"`, `"summary"`) |
| `body` | string | **Yes** | Markdown body content |
| `tags` | string[] | No | Tags for frontmatter and index |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"created"` |
| `path` | string | Path of the written page |
| `title` | string | Page title |
| `type` | string | Page type |
| `tags` | string[] | Applied tags |

> **Security:** Path traversal protection via `assertWithinDir`. Frontmatter validation requires both `title` and `type`.

**Example**

```json
// Request
{
  "tool": "wiki_write_page",
  "input": {
    "pagePath": "concepts/rlhf.md",
    "title": "Reinforcement Learning from Human Feedback",
    "type": "concept",
    "body": "# RLHF\n\nA technique for aligning language models with human preferences...",
    "tags": ["alignment", "reinforcement-learning"]
  }
}

// Response
{
  "status": "created",
  "path": "concepts/rlhf.md",
  "title": "Reinforcement Learning from Human Feedback",
  "type": "concept",
  "tags": ["alignment", "reinforcement-learning"]
}
```

---

### `wiki_create_entity`

Create a new wiki entity page at `wiki/entities/{slug}.md` with proper frontmatter and auto-register it in the index.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Entity name (used for title and slug generation) |
| `content` | string | **Yes** | Markdown body content |
| `tags` | string[] | No | Tags for frontmatter and index |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"created"` |
| `path` | string | Generated path (`entities/{slug}.md`) |
| `title` | string | Entity name used as title |
| `type` | string | Always `"entity"` |
| `tags` | string[] | Applied tags |

**Example**

```json
// Request
{
  "tool": "wiki_create_entity",
  "input": {
    "name": "OpenAI",
    "content": "OpenAI is an AI research organization founded in 2015...",
    "tags": ["organization", "ai-lab"]
  }
}

// Response
{
  "status": "created",
  "path": "entities/openai.md",
  "title": "OpenAI",
  "type": "entity",
  "tags": ["organization", "ai-lab"]
}
```

---

### `wiki_create_concept`

Create a new wiki concept page at `wiki/concepts/{slug}.md` with proper frontmatter and auto-register it in the index.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Concept name (used for title and slug generation) |
| `content` | string | **Yes** | Markdown body content |
| `tags` | string[] | No | Tags for frontmatter and index |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"created"` |
| `path` | string | Generated path (`concepts/{slug}.md`) |
| `title` | string | Concept name used as title |
| `type` | string | Always `"concept"` |
| `tags` | string[] | Applied tags |

**Example**

```json
// Request
{
  "tool": "wiki_create_concept",
  "input": {
    "name": "Chain of Thought",
    "content": "Chain of thought prompting encourages LLMs to show intermediate reasoning steps...",
    "tags": ["prompting", "reasoning"]
  }
}

// Response
{
  "status": "created",
  "path": "concepts/chain-of-thought.md",
  "title": "Chain of Thought",
  "type": "concept",
  "tags": ["prompting", "reasoning"]
}
```

---

### `wiki_update_page`

Update an existing wiki page by merging partial frontmatter changes and/or appending or replacing body content. Updates the index if metadata changed.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pagePath` | string | **Yes** | Relative path of the page to update |
| `title` | string | No | New title (merges into frontmatter) |
| `type` | string | No | New type (merges into frontmatter) |
| `tags` | string[] | No | New tags (replaces existing tags) |
| `bodyAppend` | string | No | Markdown to append to existing body |
| `bodyReplace` | string | No | Markdown to replace entire body |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"updated"` |
| `path` | string | Path of the updated page |
| `frontmatter` | object | Updated frontmatter |
| `bodyUpdated` | boolean | Whether the body was changed |
| `indexUpdated` | boolean | Whether the index was refreshed |

> **Note:** Fails gracefully if the target page does not exist.

**Example**

```json
// Request
{
  "tool": "wiki_update_page",
  "input": {
    "pagePath": "concepts/rlhf.md",
    "tags": ["alignment", "reinforcement-learning", "safety"],
    "bodyAppend": "\n\n## Recent Developments\n\nDPO has emerged as a simpler alternative to PPO-based RLHF..."
  }
}

// Response
{
  "status": "updated",
  "path": "concepts/rlhf.md",
  "frontmatter": {
    "type": "concept",
    "title": "Reinforcement Learning from Human Feedback",
    "tags": ["alignment", "reinforcement-learning", "safety"]
  },
  "bodyUpdated": true,
  "indexUpdated": true
}
```

---

### `wiki_add_crosslinks`

Add cross-reference links ("See also" section) from one wiki page to one or more target pages. Validates that all target pages exist before writing.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pagePath` | string | **Yes** | Source page to add links to |
| `targetPages` | string[] | **Yes** | Non-empty array of target page paths |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"updated"` |
| `path` | string | Source page path |
| `crosslinks` | string[] | All target page paths that were linked |

**Example**

```json
// Request
{
  "tool": "wiki_add_crosslinks",
  "input": {
    "pagePath": "concepts/rlhf.md",
    "targetPages": [
      "concepts/attention-mechanisms.md",
      "entities/openai.md"
    ]
  }
}

// Response
{
  "status": "updated",
  "path": "concepts/rlhf.md",
  "crosslinks": [
    "concepts/attention-mechanisms.md",
    "entities/openai.md"
  ]
}
```

---

### `wiki_update_index`

Update metadata (summary, tags, category) for an existing entry in the wiki index.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pagePath` | string | **Yes** | Path of the index entry to update |
| `summary` | string | No | New summary text |
| `tags` | string[] | No | New tags |
| `category` | string | No | New category |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"updated"` or `"not_found"` |
| `path` | string | Path of the entry |
| `fieldsUpdated` | string[] | Names of fields that were changed |

**Example**

```json
// Request
{
  "tool": "wiki_update_index",
  "input": {
    "pagePath": "concepts/rlhf.md",
    "summary": "Technique for aligning LLMs with human preferences using reward models.",
    "category": "alignment"
  }
}

// Response
{
  "status": "updated",
  "path": "concepts/rlhf.md",
  "fieldsUpdated": ["summary", "category"]
}
```

---

### `wiki_ingest_with_context`

Ingest a source file into the wiki and return enhanced context including related pages, word count, content type, and suggested next actions.

**Input Schema**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourcePath` | string | **Yes** | Path to source file, relative to project root |
| `dryRun` | boolean | No | If `true`, preview the ingest without writing files |
| `force` | boolean | No | If `true`, re-ingest even if the source was previously processed |

**Output**

Ingest result plus enriched context:

| Field | Type | Description |
|-------|------|-------------|
| `ingest` | object | Standard ingest output (`status`, `pages_created`, `pages_updated`, `dry_run`, etc.) |
| `source_word_count` | number | Word count of the source file |
| `source_content_type` | string | Detected content type from file extension (e.g. `"markdown"`, `"pdf"`, `"text"`, `"html"`) |
| `related_pages` | array | Existing wiki pages related to the ingested content (each with `path`, `title`, `score`, `excerpt`) |
| `suggested_actions` | string[] | Recommended follow-up actions (e.g. create entity, add crosslinks) |

**Example**

```json
// Request
{
  "tool": "wiki_ingest_with_context",
  "input": {
    "sourcePath": "raw/attention-is-all-you-need.pdf",
    "dryRun": false
  }
}

// Response
{
  "ingest": {
    "command": "ingest",
    "api_version": "1",
    "status": "success",
    "pages_created": ["sources/attention-is-all-you-need-summary.md"],
    "pages_updated": ["index.md", "log.md"],
    "dry_run": false
  },
  "source_word_count": 8420,
  "source_content_type": "pdf",
  "related_pages": [
    { "path": "entities/transformer.md", "title": "Transformer", "score": 12, "excerpt": "Introduced in 'Attention Is All You Need' (2017)..." }
  ],
  "suggested_actions": [
    "Review the generated summary page for accuracy",
    "Create entity pages for mentioned people, organizations, or concepts",
    "Add crosslinks between the new page and related existing pages"
  ]
}
```

---

## Security Model

All MCP tools enforce a layered security model to prevent unauthorized file system access and data corruption.

### Path Traversal Protection

Every tool that reads or writes wiki files validates paths with `assertWithinDir()`. The resolved absolute path must remain within the wiki directory. Attempts to escape (e.g. `../../etc/passwd`) are rejected before any I/O occurs.

### Input Validation

| Check | Tools | Description |
|-------|-------|-------------|
| **Required field validation** | All tools | Non-empty string checks on all required parameters |
| **Frontmatter validation** | `wiki_write_page` | Both `title` and `type` must be present |
| **String array validation** | All tools with `tags` | Tags must be an array of strings |
| **Empty slug rejection** | `wiki_create_entity`, `wiki_create_concept` | Names that produce empty slugs are rejected |
| **Target existence check** | `wiki_add_crosslinks` | All target pages must exist before links are written |
| **Index injection prevention** | `wiki_update_index`, `wiki_write_page` | Upsert pattern prevents duplicate or malformed index entries |

---

## Example Workflows

### 1. Explore an Existing Wiki

Check the current state, browse pages, read specific content, and search for topics.

```jsonc
// Step 1 — Check overall wiki health
{ "tool": "wiki_status", "input": {} }

// Step 2 — Browse all available pages
{ "tool": "wiki_list_pages", "input": {} }

// Step 3 — Read a page of interest
{ "tool": "wiki_read_page", "input": { "path": "concepts/attention-mechanisms.md" } }

// Step 4 — Search for related content
{ "tool": "wiki_query", "input": { "query": "multi-head attention" } }
```

### 2. Add New Knowledge

Ingest a source file, create a new entity from the findings, and link it to existing content.

```jsonc
// Step 1 — Ingest the source and see what the wiki suggests
{
  "tool": "wiki_ingest_with_context",
  "input": { "sourcePath": "raw/gpt-4-technical-report.pdf" }
}

// Step 2 — Create an entity page for a key subject
{
  "tool": "wiki_create_entity",
  "input": {
    "name": "GPT-4",
    "content": "GPT-4 is a large multimodal model developed by OpenAI...",
    "tags": ["model", "openai", "multimodal"]
  }
}

// Step 3 — Cross-link the new entity to related pages
{
  "tool": "wiki_add_crosslinks",
  "input": {
    "pagePath": "entities/gpt-4.md",
    "targetPages": ["entities/openai.md", "concepts/rlhf.md"]
  }
}
```

### 3. Maintain Wiki Health

Run a lint pass, fix issues found, and update the index to keep metadata accurate.

```jsonc
// Step 1 — Run lint to discover problems
{ "tool": "wiki_lint", "input": {} }

// Step 2 — Fix a page with outdated content
{
  "tool": "wiki_update_page",
  "input": {
    "pagePath": "concepts/rlhf.md",
    "tags": ["alignment", "reinforcement-learning", "safety"],
    "bodyAppend": "\n\n## 2024 Update\n\nDirect Preference Optimization (DPO) has simplified the RLHF pipeline..."
  }
}

// Step 3 — Update the index entry to match
{
  "tool": "wiki_update_index",
  "input": {
    "pagePath": "concepts/rlhf.md",
    "summary": "Aligning LLMs with human preferences — covers PPO-based RLHF and DPO.",
    "tags": ["alignment", "reinforcement-learning", "safety"]
  }
}
```

---

## See Also

- [README.md](../README.md) — Project overview, installation, and CLI usage
- [ARCHITECTURE.md](../ARCHITECTURE.md) — System design, three-layer architecture, and data-flow diagrams
