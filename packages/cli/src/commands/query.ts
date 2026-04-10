import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readPage, writePage, directoryExists, readIndex, type IndexEntry, appendEntry } from '@llmwiki/shared';

export interface QueryResult {
  title: string;
  path: string;
  score: number;
  excerpt: string;
}

export interface QueryOutput {
  command: string;
  query: string;
  matches: number;
  results: QueryResult[];
  saved?: string;
}

/**
 * Count occurrences of a term in text (case-insensitive).
 */
function countOccurrences(text: string, term: string): number {
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  if (!t) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = lower.indexOf(t, pos)) !== -1) {
    count++;
    pos += t.length;
  }
  return count;
}

/**
 * Slugify a query string for use as a filename.
 */
export function slugifyQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Extract an excerpt from page body (first N characters).
 */
function excerpt(body: string, maxLen = 200): string {
  const cleaned = body.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + '…';
}

/**
 * Execute a query against the wiki, returning scored results.
 */
export async function queryWiki(
  queryStr: string,
  targetPath: string,
  save = false,
): Promise<QueryOutput> {
  const root = resolve(targetPath);
  const wikiDir = join(root, 'wiki');
  const indexPath = join(wikiDir, 'index.md');

  if (!(await directoryExists(wikiDir))) {
    return {
      command: 'query',
      query: queryStr,
      matches: 0,
      results: [],
    };
  }

  const entries = await readIndex(indexPath);
  const terms = queryStr.toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return {
      command: 'query',
      query: queryStr,
      matches: 0,
      results: [],
    };
  }

  // Score index entries by title and summary
  const scored: { entry: IndexEntry; indexScore: number }[] = [];
  for (const entry of entries) {
    let score = 0;
    for (const term of terms) {
      score += countOccurrences(entry.title, term) * 3;
      score += countOccurrences(entry.summary, term) * 2;
    }
    if (score > 0) {
      scored.push({ entry, indexScore: score });
    }
  }

  // Read matched pages and add body score
  const results: QueryResult[] = [];
  for (const { entry, indexScore } of scored) {
    let bodyScore = 0;
    let body = '';
    try {
      const pagePath = join(wikiDir, entry.path);
      const page = await readPage(pagePath);
      body = page.body;
      for (const term of terms) {
        bodyScore += countOccurrences(body, term);
      }
    } catch {
      // Page file missing — use index score only
    }

    results.push({
      title: entry.title,
      path: entry.path,
      score: indexScore + bodyScore,
      excerpt: excerpt(body),
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  const output: QueryOutput = {
    command: 'query',
    query: queryStr,
    matches: results.length,
    results,
  };

  // Save query result as a wiki page if requested
  if (save && results.length > 0) {
    const slug = slugifyQuery(queryStr);
    const queryRelPath = `queries/${slug}.md`;
    const queryFullPath = join(wikiDir, queryRelPath);
    const today = new Date().toISOString().slice(0, 10);

    await mkdir(join(wikiDir, 'queries'), { recursive: true });

    let body = `# Query: ${queryStr}\n\n`;
    body += `Found ${results.length} result(s).\n\n`;
    for (const r of results) {
      body += `## ${r.title}\n\n`;
      body += `- **Path:** ${r.path}\n`;
      body += `- **Score:** ${r.score}\n`;
      body += `- **Excerpt:** ${r.excerpt}\n\n`;
    }

    await writePage(queryFullPath, {
      frontmatter: {
        type: 'query',
        title: `Query: ${queryStr}`,
        created: today,
        query: queryStr,
      },
      body: body.trim(),
    });

    const logPath = join(wikiDir, 'log.md');
    await appendEntry(logPath, {
      verb: 'queried',
      subject: queryStr,
      details: `Saved query "${queryStr}" → ${queryRelPath} (${results.length} results)`,
    });

    output.saved = queryRelPath;
  }

  return output;
}

/**
 * Register the `query` subcommand on the wiki command group.
 */
export function registerQueryCommand(wiki: Command): void {
  wiki
    .command('query')
    .description('Search the wiki for pages matching a query')
    .argument('<query>', 'Search query string')
    .option('--save', 'Save query results as a wiki page', false)
    .option('--path <dir>', 'Wiki root directory', '.')
    .action(async (queryStr: string, options: { save: boolean; path: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const result = await queryWiki(queryStr, options.path, options.save);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.matches === 0) {
        console.log(`No results found for "${result.query}". Try different search terms.`);
      } else {
        console.log(`Found ${result.matches} result(s) for "${result.query}"\n`);
        result.results.forEach((r, i) => {
          console.log(`${i + 1}. ${r.title} (score: ${r.score})`);
          console.log(`   Path: ${r.path}`);
          console.log(`   ${r.excerpt}\n`);
        });
        if (result.saved) {
          console.log(`✓ Results saved to wiki/${result.saved}`);
        }
      }
    });
}
