import { Command } from 'commander';
import { readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { listPages, readIndex, readLog } from '@llmwiki/shared';

/**
 * Result of running the status command.
 */
export interface StatusResult {
  command: string;
  source_count: number;
  wiki_page_count: number;
  last_ingest_date: string | null;
  last_lint_date: string | null;
  orphan_page_count: number;
  index_coverage_pct: number;
}

/**
 * Gather wiki knowledge base status from the target directory.
 * Returns zeros / nulls gracefully when the wiki is uninitialized.
 */
export async function getWikiStatus(targetPath: string): Promise<StatusResult> {
  const root = resolve(targetPath);
  const rawDir = join(root, 'raw');
  const wikiDir = join(root, 'wiki');
  const indexPath = join(wikiDir, 'index.md');
  const logPath = join(wikiDir, 'log.md');

  // ── Source count (files in raw/) ───────────────────────────────
  let sourceCount = 0;
  try {
    const rawEntries = await readdir(rawDir, { withFileTypes: true, recursive: true });
    sourceCount = rawEntries.filter((e) => e.isFile()).length;
  } catch {
    // ENOENT — raw/ doesn't exist; 0 sources
  }

  // ── Wiki page count (*.md in wiki/, excluding index & log) ────
  const allPages = await listPages(wikiDir);
  const wikiPages = allPages.filter((p) => {
    const rel = relative(wikiDir, p).replace(/\\/g, '/');
    return rel !== 'index.md' && rel !== 'log.md';
  });
  const wikiPageCount = wikiPages.length;

  // ── Last ingest / lint dates from log.md ──────────────────────
  const logEntries = await readLog(logPath);

  const ingestEntries = logEntries.filter((e) =>
    e.verb.toLowerCase().includes('ingest'),
  );
  const lintEntries = logEntries.filter((e) =>
    e.verb.toLowerCase().includes('lint'),
  );

  const lastIngestDate =
    ingestEntries.length > 0
      ? ingestEntries[ingestEntries.length - 1].date
      : null;
  const lastLintDate =
    lintEntries.length > 0
      ? lintEntries[lintEntries.length - 1].date
      : null;

  // ── Orphan pages (not referenced in index.md) ─────────────────
  const indexEntries = await readIndex(indexPath);
  const indexedPaths = new Set(indexEntries.map((e) => e.path));

  const orphanPageCount = wikiPages.filter((p) => {
    const rel = relative(wikiDir, p).replace(/\\/g, '/');
    return !indexedPaths.has(rel);
  }).length;

  // ── Index coverage ────────────────────────────────────────────
  const indexedPageCount = wikiPageCount - orphanPageCount;
  const indexCoveragePct =
    wikiPageCount > 0
      ? Math.round((indexedPageCount / wikiPageCount) * 100)
      : 100;

  return {
    command: 'status',
    source_count: sourceCount,
    wiki_page_count: wikiPageCount,
    last_ingest_date: lastIngestDate,
    last_lint_date: lastLintDate,
    orphan_page_count: orphanPageCount,
    index_coverage_pct: indexCoveragePct,
  };
}

/**
 * Format status result as a human-readable table.
 */
function formatStatusTable(result: StatusResult): string {
  const label = (text: string): string => `  ${text.padEnd(22)}`;
  const lines: string[] = [
    'Wiki Status',
    '─'.repeat(36),
    `${label('Sources (raw/)')}${result.source_count}`,
    `${label('Wiki pages (wiki/)')}${result.wiki_page_count}`,
    `${label('Last ingest')}${result.last_ingest_date ?? '—'}`,
    `${label('Last lint')}${result.last_lint_date ?? '—'}`,
    `${label('Orphan pages')}${result.orphan_page_count}`,
    `${label('Index coverage')}${result.index_coverage_pct}%`,
  ];
  return lines.join('\n');
}

/**
 * Register the `status` subcommand on the wiki command group.
 */
export function registerStatusCommand(wiki: Command): void {
  wiki
    .command('status')
    .description('Show wiki knowledge base status and statistics')
    .option('--path <dir>', 'Target directory', '.')
    .action(async (options: { path: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const result = await getWikiStatus(options.path);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else {
        console.log(formatStatusTable(result));
      }
    });
}
