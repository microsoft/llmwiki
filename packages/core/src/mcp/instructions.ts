import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Upper bound for the AGENTS.md excerpt embedded in the instructions. */
export const MAX_SCHEMA_CHARS = 12_000;

/** How agents should use the LLM Wiki tools (sent as MCP server instructions). */
export const BASE_INSTRUCTIONS = `LLM Wiki is a personal knowledge base that an LLM maintains as interlinked markdown. A wiki root (usually <project>/.wiki) contains:
- raw/: immutable sources the user curates. Read them; never modify them.
- wiki/: pages you maintain. entities/ (people, organizations, things), concepts/ (ideas, techniques), sources/ (one summary per raw source), plus wiki/index.md (the catalog) and wiki/log.md (append-only history).
- AGENTS.md: the wiki's schema and conventions. Follow it.

Answering questions:
1. Find candidate pages with wiki_query (or scan wiki_read_index), then read the most relevant ones with wiki_read_page.
2. Answer from the wiki content and cite the pages you used by title and path. Point out connections between pages.
3. If the wiki does not cover the question, say so and suggest sources the user could add.
4. When an answer is a valuable synthesis, offer to save it as a page with wiki_write_page (type "query", path "queries/<slug>.md").

Maintaining the wiki:
- Prefer wiki_create_entity, wiki_create_concept, wiki_update_page and wiki_add_crosslinks over editing files directly; they keep index.md consistent.
- To ingest a source, make sure the file is under raw/, then call wiki_ingest_with_context with sourcePath "raw/<file>".
- For health checks call wiki_lint. wiki_fix applies the deterministic fixes (preview with dryRun first); resolve the remaining findings by editing pages.
- Delete pages with wiki_delete_page only after the user confirms.`;

const DISCOVERY_INSTRUCTIONS = `Locating the wiki: if a tool reports that no wiki is open, call wiki_open with the absolute path of the user's project folder (usually the current working directory). Use wiki_init only when the user wants a new wiki.`;

/**
 * Build the MCP server instructions. When the wiki root is known, its
 * AGENTS.md schema is appended (truncated to {@link MAX_SCHEMA_CHARS}).
 */
export function buildInstructions(
  wikiRoot: string | undefined,
  options: { discovery?: boolean } = {},
): string {
  const parts = [BASE_INSTRUCTIONS];
  if (options.discovery) parts.push(DISCOVERY_INSTRUCTIONS);

  if (wikiRoot) {
    let schema = '';
    try {
      schema = readFileSync(join(wikiRoot, 'AGENTS.md'), 'utf-8').trim();
    } catch {
      // No schema file — the base instructions still apply.
    }
    if (schema.length > MAX_SCHEMA_CHARS) {
      schema = `${schema.slice(0, MAX_SCHEMA_CHARS)}\n\n[Truncated. Read .wiki/AGENTS.md for the full schema.]`;
    }
    if (schema) parts.push(`This wiki's schema (.wiki/AGENTS.md):\n\n${schema}`);
  }

  return parts.join('\n\n');
}
