import { readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { readPage, deletePage } from './wiki.js';
import { lintFix, type LintFinding } from './lint.js';
import { appendEntry } from './log.js';
import { API_VERSION } from './constants.js';
import { isNotFoundError } from './errors.js';

export interface FixWikiOptions {
  /** Report what would change without writing anything. Default: false. */
  dryRun?: boolean;
}

export interface FixWikiResult {
  command: 'fix';
  api_version: string;
  dry_run: boolean;
  /** Entity/concept pages removed because every source they were derived from is gone. */
  removed_pages: string[];
  fixed: LintFinding[];
  remaining: LintFinding[];
  fixedCount: number;
  remainingCount: number;
}

/** Wiki-relative paths (forward slashes) of every page except index.md and log.md. */
async function listContentPages(wikiDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(wikiDir, { recursive: true })) as string[];
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw err;
  }
  return files
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => extname(f) === '.md' && f !== 'index.md' && f !== 'log.md')
    .sort();
}

async function readSources(wikiDir: string, relPath: string): Promise<unknown> {
  try {
    return (await readPage(join(wikiDir, relPath))).frontmatter.sources;
  } catch {
    return undefined;
  }
}

/**
 * Normalize one entry of a page's `sources` frontmatter. Only wiki-relative
 * summary pages under `sources/` (e.g. "sources/article-summary.md") take part
 * in provenance cleanup; anything else (raw/ paths, URLs, free text) returns
 * undefined and is treated as a source that still exists.
 */
export function normalizeSourceRef(source: unknown): string | undefined {
  if (typeof source !== 'string') return undefined;
  const ref = source.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!/^sources\/.+\.md$/i.test(ref)) return undefined;
  if (ref.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  return ref;
}

/**
 * True when `sources` lists at least one path and every one of them is a
 * summary page that is definitely gone. Other entries and errors other than
 * "not found" count as present, so a page is never deleted on bad data.
 */
async function allSourcesMissing(wikiDir: string, sources: unknown): Promise<boolean> {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  const missing = await Promise.all(
    sources.map(async (source) => {
      const ref = normalizeSourceRef(source);
      if (!ref) return false;
      try {
        await stat(join(wikiDir, ref));
        return false;
      } catch (err) {
        return isNotFoundError(err);
      }
    }),
  );
  return missing.every(Boolean);
}

/**
 * Find entity/concept pages whose frontmatter `sources` all point to files
 * that no longer exist (the raw source was removed after ingest).
 * Returns wiki-relative paths with forward slashes, sorted.
 */
export async function findOrphanedDerivedPages(wikiDir: string): Promise<string[]> {
  const orphaned: string[] = [];
  for (const relPath of await listContentPages(wikiDir)) {
    if (!relPath.startsWith('entities/') && !relPath.startsWith('concepts/')) continue;
    if (await allSourcesMissing(wikiDir, await readSources(wikiDir, relPath))) {
      orphaned.push(relPath);
    }
  }
  return orphaned;
}

/**
 * Remove the wiki pages of a raw source that was deleted: its summary page
 * (`summaryRelPath`, e.g. "sources/article-summary.md") and every page that
 * lists it in `sources` and has no other source left. Pages that still have
 * another existing source are kept. Returns the wiki-relative paths deleted.
 */
export async function removeSourcePages(wikiDir: string, summaryRelPath: string): Promise<string[]> {
  const removed: string[] = [];
  try {
    await deletePage(wikiDir, summaryRelPath);
    removed.push(summaryRelPath);
  } catch {
    // The source was never ingested, or its summary is already gone.
  }

  for (const relPath of await listContentPages(wikiDir)) {
    const sources = await readSources(wikiDir, relPath);
    if (!Array.isArray(sources) || !sources.some((s) => normalizeSourceRef(s) === summaryRelPath)) continue;
    if (!(await allSourcesMissing(wikiDir, sources))) continue;
    try {
      await deletePage(wikiDir, relPath);
      removed.push(relPath);
    } catch {
      // Already gone.
    }
  }
  return removed;
}

/**
 * Apply every deterministic wiki fix in one pass:
 *  1. Delete entity/concept pages whose sources were all removed.
 *  2. Run {@link lintFix} with orphan indexing enabled (stale index entries,
 *     missing index entries, missing frontmatter defaults, orphan pages).
 *
 * Findings that need judgment (broken links, invalid types, missing pages)
 * are returned in `remaining`. With `dryRun`, nothing is written and the
 * result describes what would change.
 */
export async function fixWiki(
  wikiRoot: string,
  options: FixWikiOptions = {},
): Promise<FixWikiResult> {
  const root = resolve(wikiRoot);
  const wikiDir = join(root, 'wiki');
  const dryRun = options.dryRun === true;

  const removed: string[] = [];
  for (const relPath of await findOrphanedDerivedPages(wikiDir)) {
    if (dryRun) {
      removed.push(relPath);
      continue;
    }
    try {
      await deletePage(wikiDir, relPath);
      removed.push(relPath);
    } catch {
      // Already gone — nothing to report.
    }
  }

  const result = await lintFix(root, { fixOrphans: true, dryRun });

  // In a dry run the pages above still exist, so drop findings about them.
  const removedSet = new Set(removed);
  const keep = (f: LintFinding) => !(dryRun && f.file && removedSet.has(f.file));
  const fixed = result.fixed.filter(keep);
  const remaining = result.remaining.filter(keep);

  if (!dryRun && (removed.length > 0 || fixed.length > 0)) {
    await appendEntry(join(wikiDir, 'log.md'), {
      verb: 'lint-fix',
      subject: 'wiki',
      details: `Removed ${removed.length} orphaned page(s), fixed ${fixed.length} issue(s), ${remaining.length} remaining.`,
    });
  }

  return {
    command: 'fix',
    api_version: API_VERSION,
    dry_run: dryRun,
    removed_pages: removed,
    fixed,
    remaining,
    fixedCount: fixed.length,
    remainingCount: remaining.length,
  };
}
