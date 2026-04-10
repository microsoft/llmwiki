# Smart Ingest Workflow

> A step-by-step guide showing how an LLM agent ingests a source document, analyzes context, creates entities and concepts, connects knowledge, enriches existing content, and verifies wiki health — all through MCP tool calls.

## Introduction

Smart ingest is the primary pattern for growing a wiki with LLM assistance. An LLM agent needs it because raw ingest is mechanical — it copies a source file and creates a summary page, but does nothing to connect that knowledge to the rest of the wiki. The key enabler is the `wiki_ingest_with_context` MCP tool: it performs the mechanical ingest **and** returns context about related pages, enabling the LLM to intelligently expand the wiki.

The agent doesn't just dump raw content into pages — it performs a structured knowledge-extraction pipeline:

1. **Ingest** the source file and receive contextual signals about existing wiki content.
2. **Analyze** the response to plan entity, concept, and crosslink creation.
3. **Create entity pages** for people, organizations, and other named things.
4. **Create concept pages** for ideas, mechanisms, and techniques.
5. **Connect** new and existing pages with crosslinks.
6. **Enrich** existing pages with knowledge from the new source.
7. **Verify** wiki health to catch broken links, missing metadata, or orphan pages.

This workflow uses the `llmwiki` MCP server — 14 tools over stdio transport, started with:

```bash
plaid wiki mcp [--path <wiki-root>]
```

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **MCP server running** | `plaid wiki mcp --path /path/to/wiki` (or launched by a Copilot host) |
| **Wiki initialized** | `plaid wiki init` must have been run at least once |
| **Source file available** | A markdown, text, or PDF file in the `raw/` directory |
| **Existing wiki content** | Optional, but enables richer context matching and crosslinking |

---

## Workflow Overview

```
 ┌─────────────────────────┐
 │  1. Ingest with Context  │
 │  wiki_ingest_with_context│
 └───────────┬─────────────┘
             │  returns related_pages + suggested_actions
             ▼
 ┌─────────────────────────┐
 │  2. Analyze & Plan       │
 │  (LLM reasoning phase)  │──────── optionally wiki_read_page
 └───────────┬─────────────┘         to inspect existing pages
             │  identifies entities, concepts, links
             ▼
 ┌─────────────────────────┐
 │  3. Create Entities      │
 │  wiki_create_entity      │  × N entities
 └───────────┬─────────────┘
             ▼
 ┌─────────────────────────┐
 │  4. Create Concepts      │
 │  wiki_create_concept     │  × N concepts
 └───────────┬─────────────┘
             ▼
 ┌─────────────────────────┐
 │  5. Add Crosslinks       │
 │  wiki_add_crosslinks     │
 └───────────┬─────────────┘
             ▼
 ┌─────────────────────────┐
 │  6. Enrich Existing Pages│
 │  wiki_update_page        │
 └───────────┬─────────────┘
             ▼
 ┌─────────────────────────┐
 │  7. Verify Wiki Health   │
 │  wiki_lint               │
 └─────────────────────────┘
```

---

## Concrete Example: Ingesting a Transformer Architecture Article

Throughout this walkthrough we ingest the following source file.

**`raw/transformer-architecture.md`**

```markdown
# The Transformer Architecture

The Transformer model, introduced in the 2017 paper "Attention Is All You Need" by Vaswani et al.,
revolutionized natural language processing. Unlike recurrent neural networks (RNNs), Transformers
use self-attention mechanisms to process all positions in a sequence simultaneously.

Key components include:
- Multi-head attention layers
- Position-wise feed-forward networks
- Positional encoding (since the model has no inherent notion of order)

The architecture spawned models like BERT, GPT, and T5, forming the foundation of modern LLMs.
Organizations like OpenAI, Google DeepMind, and Anthropic have built on this work extensively.
```

---

## Step-by-Step Walkthrough

### Step 1 — Ingest the Source with Context

**What the LLM does:** Calls `wiki_ingest_with_context` to perform mechanical ingest (copy to `raw/`, generate a summary page) **and** receive contextual signals — related pages, word count, content type, and suggested next actions.

**MCP Tool Call**

```json
{
  "tool": "wiki_ingest_with_context",
  "arguments": {
    "sourcePath": "raw/transformer-architecture.md"
  }
}
```

**Expected Response**

```json
{
  "ingest": {
    "status": "ok",
    "source_path": "raw/transformer-architecture.md",
    "pages_created": ["sources/transformer-architecture-summary.md"],
    "pages_updated": []
  },
  "source_word_count": 98,
  "source_content_type": "markdown",
  "related_pages": [
    {
      "path": "concepts/ai.md",
      "title": "Artificial Intelligence",
      "score": 3,
      "excerpt": "Artificial intelligence is the simulation of human intelligence processes by computer systems..."
    }
  ],
  "suggested_actions": [
    "Review the generated summary page for accuracy",
    "Create entity pages for mentioned people and organizations",
    "Create concept pages for key technical ideas (self-attention, positional encoding)",
    "Add crosslinks between new and related existing pages",
    "Update existing related pages with new information from this source"
  ]
}
```

**LLM's Analysis:**

- `ingest.status` is `"ok"` — the source was processed successfully and a summary page was created at `sources/transformer-architecture-summary.md`.
- `related_pages` contains one match: `concepts/ai.md` with a relevance score of 3. This page exists already and may benefit from enrichment in Step 6.
- `suggested_actions` recommends creating entity and concept pages and adding crosslinks — confirming the standard smart-ingest pipeline.
- `source_content_type` is `"markdown"` — detected from the `.md` extension.

> **Decision point:** If `ingest.status` were `"skipped"`, the source was already ingested. Pass `force: true` to re-ingest. If `"error"`, stop and inspect the error message.

---

### Step 2 — Analyze Response and Inspect Related Pages

**What the LLM does:** Reads the Step 1 response, identifies entities and concepts to create, and optionally calls `wiki_read_page` to inspect existing related pages before deciding what new information to add.

The LLM identifies from the source text:

| Category | Extracted items |
|----------|----------------|
| **Entities** | Ashish Vaswani (lead author), OpenAI, Google DeepMind, Anthropic |
| **Concepts** | Self-Attention, Positional Encoding, Multi-Head Attention |
| **Existing pages to enrich** | `concepts/ai.md` (from `related_pages`) |

To understand what `concepts/ai.md` already covers, the LLM reads it:

**MCP Tool Call**

```json
{
  "tool": "wiki_read_page",
  "arguments": {
    "path": "concepts/ai.md"
  }
}
```

**Expected Response**

```json
{
  "frontmatter": {
    "type": "concept",
    "title": "Artificial Intelligence",
    "tags": ["ai", "machine-learning"],
    "created": "2025-01-10"
  },
  "body": "# Artificial Intelligence\n\nArtificial intelligence (AI) is the simulation of human intelligence processes by computer systems. These processes include learning, reasoning, and self-correction.\n\n## Subfields\n\n- Machine Learning\n- Natural Language Processing\n- Computer Vision\n- Robotics"
}
```

**LLM's Analysis:**

- The existing AI page covers subfields at a high level but does not mention the Transformer architecture. This is a good candidate for enrichment in Step 6.
- The page already has tags `["ai", "machine-learning"]` — the LLM will add `"transformer"` when updating.
- No existing entity pages for Vaswani, OpenAI, or others were returned in `related_pages`, so entity creation is needed.

---

### Step 3 — Create Entity Pages

**What the LLM does:** Creates pages for people and organizations mentioned in the source. Entities are created before concepts because concept pages often reference entities.

**MCP Tool Call — Entity: Ashish Vaswani**

```json
{
  "tool": "wiki_create_entity",
  "arguments": {
    "name": "Ashish Vaswani",
    "content": "Ashish Vaswani is the lead author of the 2017 paper \"Attention Is All You Need\" that introduced the Transformer architecture. His work at Google Brain laid the foundation for modern large language models including BERT, GPT, and T5.\n\n## Key Contributions\n\n- Transformer architecture (2017)\n- Scaled dot-product attention mechanism\n- Multi-head attention design",
    "tags": ["researcher", "transformer", "google"]
  }
}
```

**Expected Response**

```json
{
  "status": "created",
  "path": "entities/ashish-vaswani.md",
  "title": "Ashish Vaswani",
  "type": "entity",
  "tags": ["researcher", "transformer", "google"]
}
```

**LLM's Analysis:**

- The entity was created at `entities/ashish-vaswani.md` — this path will be used as a crosslink target in Step 5.
- The slug was auto-generated from the name: `"Ashish Vaswani"` → `ashish-vaswani`.
- The page was auto-registered in the wiki index.

> **Note:** The LLM would repeat this pattern for other entities (OpenAI, Google DeepMind, Anthropic). For brevity, one entity call is shown here.

---

### Step 4 — Create Concept Pages

**What the LLM does:** Creates pages for key technical ideas discovered in the source. The LLM prioritizes concepts central to the source material.

**MCP Tool Call — Concept: Self-Attention**

```json
{
  "tool": "wiki_create_concept",
  "arguments": {
    "name": "Self-Attention",
    "content": "Self-attention (also called intra-attention) is a mechanism that relates different positions of a single sequence to compute a representation of that sequence. It is the core building block of the Transformer architecture.\n\n## How It Works\n\nGiven an input sequence, self-attention computes Query (Q), Key (K), and Value (V) matrices. The attention weights are:\n\n```\nAttention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V\n```\n\nThis allows the model to weigh the importance of each token relative to every other token, enabling parallel processing of entire sequences — unlike RNNs which process tokens sequentially.",
    "tags": ["transformer", "attention", "deep-learning"]
  }
}
```

**Expected Response**

```json
{
  "status": "created",
  "path": "concepts/self-attention.md",
  "title": "Self-Attention",
  "type": "concept",
  "tags": ["transformer", "attention", "deep-learning"]
}
```

**LLM's Analysis:**

- Created at `concepts/self-attention.md` — another crosslink target for Step 5.
- The content includes the mathematical formulation, which enriches the wiki beyond what the source article alone provides. The LLM synthesized this from its training knowledge.

**MCP Tool Call — Concept: Positional Encoding**

```json
{
  "tool": "wiki_create_concept",
  "arguments": {
    "name": "Positional Encoding",
    "content": "Positional encoding is a technique used in Transformer models to inject information about token order into the model. Since the self-attention mechanism processes all positions in parallel, it has no inherent notion of sequence order.\n\n## Sinusoidal Encoding\n\nThe original Transformer uses sine and cosine functions of different frequencies:\n\n```\nPE(pos, 2i)   = sin(pos / 10000^(2i/d_model))\nPE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))\n```\n\nThese fixed vectors are added to the input embeddings before the first attention layer.",
    "tags": ["transformer", "encoding", "sequence-modeling"]
  }
}
```

**Expected Response**

```json
{
  "status": "created",
  "path": "concepts/positional-encoding.md",
  "title": "Positional Encoding",
  "type": "concept",
  "tags": ["transformer", "encoding", "sequence-modeling"]
}
```

**LLM's Analysis:**

- Both concept pages are now created. The LLM has three new pages (`entities/ashish-vaswani.md`, `concepts/self-attention.md`, `concepts/positional-encoding.md`) plus the auto-generated summary page from Step 1.
- All paths are collected for the crosslink step.

---

### Step 5 — Add Crosslinks

**What the LLM does:** Connects the generated summary page to the new entity/concept pages and to existing related pages. This builds the wiki's knowledge graph.

**MCP Tool Call**

```json
{
  "tool": "wiki_add_crosslinks",
  "arguments": {
    "pagePath": "sources/transformer-architecture-summary.md",
    "targetPages": [
      "concepts/self-attention.md",
      "concepts/positional-encoding.md",
      "entities/ashish-vaswani.md",
      "concepts/ai.md"
    ]
  }
}
```

**Expected Response**

```json
{
  "status": "updated",
  "path": "sources/transformer-architecture-summary.md",
  "crosslinks": [
    "concepts/self-attention.md",
    "concepts/positional-encoding.md",
    "entities/ashish-vaswani.md",
    "concepts/ai.md"
  ]
}
```

**LLM's Analysis:**

- A "See also" section was appended to `sources/transformer-architecture-summary.md` with links to all four target pages.
- All targets were validated as existing before the links were written.
- The LLM may issue additional `wiki_add_crosslinks` calls to interconnect the new concept and entity pages with each other — for example, linking `concepts/self-attention.md` → `concepts/positional-encoding.md`.

> **Note:** All target pages must exist before crosslinking. This is why entities and concepts are created in Steps 3–4 before crosslinks are added in Step 5. The tool validates every target path and rejects the call if any target is missing.

---

### Step 6 — Enrich Existing Pages

**What the LLM does:** Updates existing pages identified in Step 2 with new knowledge from the ingested source. Uses `bodyAppend` to add content non-destructively.

**MCP Tool Call**

```json
{
  "tool": "wiki_update_page",
  "arguments": {
    "pagePath": "concepts/ai.md",
    "tags": ["ai", "machine-learning", "transformer"],
    "bodyAppend": "\n\n## Transformer Architecture\n\nThe Transformer model (Vaswani et al., 2017) is a key advancement in AI, replacing recurrence with self-attention mechanisms for parallel sequence processing. It forms the foundation of modern LLMs including BERT, GPT, and T5. See [Self-Attention](../concepts/self-attention.md) and [Transformer Architecture Summary](../sources/transformer-architecture-summary.md)."
  }
}
```

**Expected Response**

```json
{
  "status": "updated",
  "path": "concepts/ai.md",
  "frontmatter": {
    "type": "concept",
    "title": "Artificial Intelligence",
    "tags": ["ai", "machine-learning", "transformer"],
    "created": "2025-01-10"
  },
  "bodyUpdated": true,
  "indexUpdated": true
}
```

**LLM's Analysis:**

- The AI page now includes a section on Transformers with inline links to the new concept and source pages.
- Tags were updated to include `"transformer"` — and the index was refreshed (`indexUpdated: true`).
- `bodyAppend` was used instead of `bodyReplace` to preserve the existing content. Use `bodyReplace` only when existing content is outdated and should be fully overwritten.

---

### Step 7 — Verify Wiki Health

**What the LLM does:** Runs `wiki_lint` to check that all changes maintain wiki consistency — no broken links, no missing frontmatter, no orphan pages.

**MCP Tool Call**

```json
{
  "tool": "wiki_lint",
  "arguments": {}
}
```

**Expected Response**

```json
{
  "findings": [],
  "errorCount": 0,
  "warningCount": 0,
  "infoCount": 0
}
```

**LLM's Analysis:**

- Empty `findings` array and zero error/warning counts confirm the wiki is healthy after all changes.
- If findings were returned, the LLM would inspect each one and fix issues (e.g., a broken link would require creating the missing target page or correcting the path).

> **Tip:** You can scope the lint check to a single category for faster feedback:
> ```json
> { "tool": "wiki_lint", "arguments": { "category": "broken-links" } }
> ```

---

## Complete Tool Call Sequence

The full sequence an LLM agent executes during smart ingest, shown as a JSON array:

```json
[
  {
    "tool": "wiki_ingest_with_context",
    "input": { "sourcePath": "raw/transformer-architecture.md" }
  },
  {
    "tool": "wiki_read_page",
    "input": { "path": "concepts/ai.md" }
  },
  {
    "tool": "wiki_create_entity",
    "input": {
      "name": "Ashish Vaswani",
      "content": "Ashish Vaswani is the lead author of the 2017 paper 'Attention Is All You Need' that introduced the Transformer architecture...",
      "tags": ["researcher", "transformer", "google"]
    }
  },
  {
    "tool": "wiki_create_concept",
    "input": {
      "name": "Self-Attention",
      "content": "Self-attention (also called intra-attention) is a mechanism that relates different positions of a single sequence to compute a representation...",
      "tags": ["transformer", "attention", "deep-learning"]
    }
  },
  {
    "tool": "wiki_create_concept",
    "input": {
      "name": "Positional Encoding",
      "content": "Positional encoding injects token order information into Transformer models, which process all positions in parallel...",
      "tags": ["transformer", "encoding", "sequence-modeling"]
    }
  },
  {
    "tool": "wiki_add_crosslinks",
    "input": {
      "pagePath": "sources/transformer-architecture-summary.md",
      "targetPages": [
        "concepts/self-attention.md",
        "concepts/positional-encoding.md",
        "entities/ashish-vaswani.md",
        "concepts/ai.md"
      ]
    }
  },
  {
    "tool": "wiki_update_page",
    "input": {
      "pagePath": "concepts/ai.md",
      "tags": ["ai", "machine-learning", "transformer"],
      "bodyAppend": "\n\n## Transformer Architecture\n\nThe Transformer model (Vaswani et al., 2017) is a key advancement in AI..."
    }
  },
  {
    "tool": "wiki_lint",
    "input": {}
  }
]
```

After completion, the wiki contains:

| Type | Path | Notes |
|------|------|-------|
| Source summary | `sources/transformer-architecture-summary.md` | Auto-generated by ingest |
| Entity | `entities/ashish-vaswani.md` | Created in Step 3 |
| Concept | `concepts/self-attention.md` | Created in Step 4 |
| Concept | `concepts/positional-encoding.md` | Created in Step 4 |
| Updated page | `concepts/ai.md` | Enriched in Step 6 |
| Crosslinks | on summary page | Pointing to all of the above |
| Index entries | auto-registered | For every created/updated page |

---

## Tips and Best Practices

- **Always use `wiki_ingest_with_context`** instead of plain ingest. The contextual signals (`related_pages`, `suggested_actions`) eliminate guesswork about what the wiki already knows.
- **Read `suggested_actions` carefully.** They are generated from the source content and existing wiki state — treat them as a checklist.
- **Create entities before concepts.** People and organizations are referenced by concept pages, so they should exist first to enable accurate crosslinking.
- **Use `wiki_read_page` to inspect existing pages before updating.** Avoid appending duplicate information or contradicting existing content.
- **After adding crosslinks, targets are validated.** The `wiki_add_crosslinks` tool checks that every target page exists before writing. If a target is missing, the call fails — create pages first, then link.
- **Run `wiki_lint` at the end** of every ingest cycle to catch any issues introduced by the new content.
- **Use `force: true` for re-ingestion.** If a source was previously ingested and you want to refresh the summary page, pass `force: true` to `wiki_ingest_with_context`.

---

## Error Handling

### Source File Not Found

If the `sourcePath` does not exist, `wiki_ingest_with_context` returns an error:

```json
{
  "tool": "wiki_ingest_with_context",
  "arguments": { "sourcePath": "raw/nonexistent.md" }
}
```

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Source file not found: raw/nonexistent.md" }]
}
```

**Recovery:** Verify the file path. List available sources with `wiki_list_sources`.

### Crosslink Target Does Not Exist

If any target page in `wiki_add_crosslinks` is missing, the tool rejects the entire call:

```json
{
  "tool": "wiki_add_crosslinks",
  "arguments": {
    "pagePath": "sources/transformer-architecture-summary.md",
    "targetPages": ["concepts/nonexistent.md"]
  }
}
```

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Target page does not exist: concepts/nonexistent.md" }]
}
```

**Recovery:** Create the missing page first (with `wiki_create_entity`, `wiki_create_concept`, or `wiki_write_page`), then retry the crosslink call.

### Page Already Exists on Create

`wiki_create_entity` and `wiki_create_concept` will overwrite an existing page at the same slug. To avoid unintended overwrites:

1. Check `related_pages` from Step 1 — if the entity/concept already appears, skip creation or read the existing page first.
2. Use `wiki_read_page` to inspect the existing content and decide whether to update instead.

### Preview Changes with Dry Run

Use `dryRun: true` on `wiki_ingest_with_context` to preview what would happen without writing any files:

```json
{
  "tool": "wiki_ingest_with_context",
  "arguments": {
    "sourcePath": "raw/transformer-architecture.md",
    "dryRun": true
  }
}
```

The response has the same shape — `related_pages`, `suggested_actions`, `source_word_count` — but no files are created or modified. This is useful for planning the ingest before committing changes.

### Lint Findings After Changes

If `wiki_lint` returns errors after the workflow, inspect each finding:

```json
{
  "findings": [
    {
      "severity": "error",
      "category": "broken-links",
      "message": "Link target 'concepts/multi-head-attention.md' does not exist",
      "path": "sources/transformer-architecture-summary.md"
    }
  ],
  "errorCount": 1,
  "warningCount": 0,
  "infoCount": 0
}
```

**Recovery:** Create the missing concept page, or fix the link in the summary page using `wiki_update_page` with `bodyReplace`.

---

## See Also

- [MCP Tools Reference](../mcp-tools.md) — Full schema documentation for all 14 tools
- [Model Context Protocol Specification](https://modelcontextprotocol.io/) — The MCP protocol standard
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — System architecture and the three-layer model
