import { readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { listPages } from './wiki.js';
import { readIndex } from './index-ops.js';
import { readLog } from './log.js';
import { API_VERSION } from './constants.js';
import { isNotFoundError } from './errors.js';

/**
 * Result of running the status command.
 */
export interface StatusResult {
  command: string;
  api_version: string;
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

  // Source count (files in raw/)
  let sourceCount = 0;
  try {
    const rawEntries = await readdir(rawDir, { withFileTypes: true, recursive: true });
    sourceCount = rawEntries.filter((e) => e.isFile()).length;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // ENOENT — raw/ doesn't exist; 0 sources
  }

  // Wiki page count (*.md in wiki/, excluding index & log)
  const allPages = await listPages(wikiDir);
  const wikiPages = allPages.filter((p) => {
    const rel = relative(wikiDir, p).replace(/\\/g, '/');
    return rel !== 'index.md' && rel !== 'log.md';
  });
  const wikiPageCount = wikiPages.length;

  // Last ingest / lint dates from log.md
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

  // Orphan pages (not referenced in index.md)
  const indexEntries = await readIndex(indexPath);
  const indexedPaths = new Set(indexEntries.map((e) => e.path));

  const orphanPageCount = wikiPages.filter((p) => {
    const rel = relative(wikiDir, p).replace(/\\/g, '/');
    return !indexedPaths.has(rel);
  }).length;

  // Index coverage
  const indexedPageCount = wikiPageCount - orphanPageCount;
  const indexCoveragePct =
    wikiPageCount > 0
      ? Math.round((indexedPageCount / wikiPageCount) * 100)
      : 100;

  return {
    command: 'status',
    api_version: API_VERSION,
    source_count: sourceCount,
    wiki_page_count: wikiPageCount,
    last_ingest_date: lastIngestDate,
    last_lint_date: lastLintDate,
    orphan_page_count: orphanPageCount,
    index_coverage_pct: indexCoveragePct,
  };
}
