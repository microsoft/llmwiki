import { join, relative } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CompleteRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listPages } from '../wiki.js';
import { listSources } from '../sources.js';
import { readIndex } from '../index-ops.js';

/** Maximum number of values returned in one completion response (MCP limit). */
const MAX_COMPLETIONS = 100;

async function pagePaths(wikiRoot: string): Promise<string[]> {
  const wikiDir = join(wikiRoot, 'wiki');
  return (await listPages(wikiDir))
    .map((p) => relative(wikiDir, p).replace(/\\/g, '/'))
    .filter((p) => p !== 'index.md' && p !== 'log.md')
    .sort();
}

async function sourcePaths(wikiRoot: string): Promise<string[]> {
  return (await listSources(join(wikiRoot, 'raw'))).map((s) => s.path).sort();
}

/**
 * Suggest values for resource-template and prompt arguments:
 *  - `resource://wiki/pages/{path}` → wiki page paths
 *  - `resource://wiki/sources/{path}` → raw source paths
 *  - prompt `ingest-and-integrate` `source_path` → `raw/<file>` paths
 *  - prompt `research-topic` `topic` → page titles from the index
 */
export function registerCompletions(
  server: Server,
  getWikiRoot: () => Promise<string>,
): void {
  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { ref, argument } = request.params;

    let candidates: string[] = [];
    try {
      if (ref.type === 'ref/resource' && argument.name === 'path') {
        if (ref.uri === 'resource://wiki/pages/{path}') {
          candidates = await pagePaths(await getWikiRoot());
        } else if (ref.uri === 'resource://wiki/sources/{path}') {
          candidates = await sourcePaths(await getWikiRoot());
        }
      } else if (ref.type === 'ref/prompt') {
        if (ref.name === 'ingest-and-integrate' && argument.name === 'source_path') {
          candidates = (await sourcePaths(await getWikiRoot())).map((p) => `raw/${p}`);
        } else if (ref.name === 'research-topic' && argument.name === 'topic') {
          const entries = await readIndex(join(await getWikiRoot(), 'wiki', 'index.md'));
          candidates = [...new Set(entries.map((e) => e.title))].sort();
        }
      }
    } catch {
      // No wiki located yet: offer no suggestions rather than failing.
      candidates = [];
    }

    const needle = (argument.value ?? '').toLowerCase();
    const matches = candidates.filter((c) => c.toLowerCase().includes(needle));
    return {
      completion: {
        values: matches.slice(0, MAX_COMPLETIONS),
        total: matches.length,
        hasMore: matches.length > MAX_COMPLETIONS,
      },
    };
  });
}
