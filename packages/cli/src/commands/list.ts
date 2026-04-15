import { Command } from 'commander';
import { join, resolve, relative } from 'node:path';
import {
  listPages,
  readPage,
  listSources,
  readIndex,
  type WikiPageFrontmatter,
  type SourceFile,
  type IndexEntry,
} from '@llmwiki/shared';
import { resolveWikiRoot } from '../wiki-root.js';

/* ------------------------------------------------------------------ */
/*  JSON result interfaces                                            */
/* ------------------------------------------------------------------ */

export interface PageInfo {
  title: string;
  type: string;
  tags: string[];
  path: string;
}

/* Re-export shared types used in tests */
export type { SourceFile, IndexEntry };

/* ------------------------------------------------------------------ */
/*  Human-readable table formatters                                   */
/* ------------------------------------------------------------------ */

function formatPagesTable(pages: PageInfo[]): string {
  if (pages.length === 0) {
    return 'No wiki pages found.';
  }

  const header = { title: 'Title', type: 'Type', tags: 'Tags', path: 'Path' };
  const rows = pages.map((p) => ({
    title: p.title || '(untitled)',
    type: p.type || '—',
    tags: p.tags.length > 0 ? p.tags.join(', ') : '—',
    path: p.path,
  }));

  const titleW = Math.max(header.title.length, ...rows.map((r) => r.title.length));
  const typeW = Math.max(header.type.length, ...rows.map((r) => r.type.length));
  const tagsW = Math.max(header.tags.length, ...rows.map((r) => r.tags.length));
  const pathW = Math.max(header.path.length, ...rows.map((r) => r.path.length));

  const line = (t: string, tp: string, tg: string, p: string): string =>
    `  ${t.padEnd(titleW)}  ${tp.padEnd(typeW)}  ${tg.padEnd(tagsW)}  ${p.padEnd(pathW)}`;

  const lines: string[] = [
    'Wiki Pages',
    '─'.repeat(titleW + typeW + tagsW + pathW + 10),
    line(header.title, header.type, header.tags, header.path),
    line('─'.repeat(titleW), '─'.repeat(typeW), '─'.repeat(tagsW), '─'.repeat(pathW)),
    ...rows.map((r) => line(r.title, r.type, r.tags, r.path)),
  ];
  return lines.join('\n');
}

function formatSourcesTable(sources: SourceFile[]): string {
  if (sources.length === 0) {
    return 'No source files found.';
  }

  const header = { name: 'Name', size: 'Size', modified: 'Modified', ext: 'Extension' };
  const rows = sources.map((s) => ({
    name: s.name,
    size: String(s.size),
    modified: s.modified.slice(0, 10), // date portion of ISO string
    ext: s.extension || '—',
  }));

  const nameW = Math.max(header.name.length, ...rows.map((r) => r.name.length));
  const sizeW = Math.max(header.size.length, ...rows.map((r) => r.size.length));
  const modW = Math.max(header.modified.length, ...rows.map((r) => r.modified.length));
  const extW = Math.max(header.ext.length, ...rows.map((r) => r.ext.length));

  const line = (n: string, s: string, m: string, e: string): string =>
    `  ${n.padEnd(nameW)}  ${s.padEnd(sizeW)}  ${m.padEnd(modW)}  ${e.padEnd(extW)}`;

  const lines: string[] = [
    'Source Files',
    '─'.repeat(nameW + sizeW + modW + extW + 10),
    line(header.name, header.size, header.modified, header.ext),
    line('─'.repeat(nameW), '─'.repeat(sizeW), '─'.repeat(modW), '─'.repeat(extW)),
    ...rows.map((r) => line(r.name, r.size, r.modified, r.ext)),
  ];
  return lines.join('\n');
}

function formatEntriesTable(entries: IndexEntry[]): string {
  if (entries.length === 0) {
    return 'No index entries found.';
  }

  const header = { category: 'Category', title: 'Title', path: 'Path', summary: 'Summary', tags: 'Tags' };
  const rows = entries.map((e) => ({
    category: e.category,
    title: e.title,
    path: e.path,
    summary: e.summary || '—',
    tags: e.tags.length > 0 ? e.tags.join(', ') : '—',
  }));

  const catW = Math.max(header.category.length, ...rows.map((r) => r.category.length));
  const titleW = Math.max(header.title.length, ...rows.map((r) => r.title.length));
  const pathW = Math.max(header.path.length, ...rows.map((r) => r.path.length));
  const sumW = Math.max(header.summary.length, ...rows.map((r) => r.summary.length));
  const tagsW = Math.max(header.tags.length, ...rows.map((r) => r.tags.length));

  const line = (c: string, t: string, p: string, s: string, tg: string): string =>
    `  ${c.padEnd(catW)}  ${t.padEnd(titleW)}  ${p.padEnd(pathW)}  ${s.padEnd(sumW)}  ${tg.padEnd(tagsW)}`;

  const lines: string[] = [
    'Index Entries',
    '─'.repeat(catW + titleW + pathW + sumW + tagsW + 12),
    line(header.category, header.title, header.path, header.summary, header.tags),
    line('─'.repeat(catW), '─'.repeat(titleW), '─'.repeat(pathW), '─'.repeat(sumW), '─'.repeat(tagsW)),
    ...rows.map((r) => line(r.category, r.title, r.path, r.summary, r.tags)),
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Command registration                                              */
/* ------------------------------------------------------------------ */

/**
 * Register the `list` subcommand on the wiki command group.
 *
 * Usage:
 *   plaid wiki list pages   [--path <dir>]
 *   plaid wiki list sources [--path <dir>]
 *   plaid wiki list entries [--path <dir>]
 *   plaid wiki --json list pages
 */
export function registerListCommand(wiki: Command): void {
  const list = wiki
    .command('list')
    .description('List wiki pages, source files, or index entries')
    .argument('<type>', 'What to list: pages | sources | entries')
    .option('--path <dir>', 'Target directory', '.');

  list.action(async (type: string, options: { path: string }, cmd: Command) => {
    const jsonMode = cmd.parent?.opts().json ?? false;
    const root = resolveWikiRoot(options.path);
    const wikiDir = join(root, 'wiki');
    const rawDir = join(root, 'raw');
    const indexPath = join(wikiDir, 'index.md');

    switch (type) {
      case 'pages': {
        const pagePaths = await listPages(wikiDir);
        const pages: PageInfo[] = [];
        for (const p of pagePaths) {
          const rel = relative(wikiDir, p).replace(/\\/g, '/');
          // Skip index.md and log.md — they are meta-files, not wiki pages
          if (rel === 'index.md' || rel === 'log.md') continue;
          const page = await readPage(p);
          const fm: WikiPageFrontmatter = page.frontmatter;
          pages.push({
            title: fm.title ?? '',
            type: fm.type ?? '',
            tags: fm.tags ?? [],
            path: rel,
          });
        }
        if (jsonMode) {
          console.log(JSON.stringify(pages));
        } else {
          console.log(formatPagesTable(pages));
        }
        break;
      }

      case 'sources': {
        const sources = await listSources(rawDir);
        if (jsonMode) {
          console.log(JSON.stringify(sources));
        } else {
          console.log(formatSourcesTable(sources));
        }
        break;
      }

      case 'entries': {
        const entries = await readIndex(indexPath);
        if (jsonMode) {
          console.log(JSON.stringify(entries));
        } else {
          console.log(formatEntriesTable(entries));
        }
        break;
      }

      default:
        console.error(`Unknown list type: ${type}. Expected: pages, sources, or entries`);
        process.exitCode = 1;
    }
  });
}
