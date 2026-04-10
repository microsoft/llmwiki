import { access, constants } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { listPages, readPage, writePage, getPageLinks, type WikiPageFrontmatter } from './wiki.js';
import { readIndex, removeEntry, addEntry, type IndexEntry } from './index-ops.js';
import { API_VERSION } from './constants.js';
import { isNotFoundError } from './errors.js';

export interface LintFinding {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  file?: string;
}

export interface LintResult {
  command: string;
  api_version: string;
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  categorySummary: Record<string, number>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

/**
 * Normalize a path to use forward slashes for consistent comparison.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Run lint checks on a wiki knowledge base.
 * If categories is provided and non-empty, only run those check categories.
 */
export async function lintWiki(
  targetPath: string,
  categories?: string[],
): Promise<LintResult> {
  const root = resolve(targetPath);
  const wikiDir = join(root, 'wiki');
  const indexPath = join(wikiDir, 'index.md');

  const findings: LintFinding[] = [];

  const shouldRun = (cat: string): boolean =>
    !categories || categories.length === 0 || categories.includes(cat);

  // Gather wiki pages (excluding index.md and log.md)
  const allPages = await listPages(wikiDir);
  const wikiPages = allPages.filter((p) => {
    const rel = normalizePath(relative(wikiDir, p));
    return rel !== 'index.md' && rel !== 'log.md';
  });

  // Build a set of existing wiki page relative paths
  const existingPagePaths = new Set(
    wikiPages.map((p) => normalizePath(relative(wikiDir, p))),
  );

  // Read all pages and collect links
  const pageContents = new Map<string, string>(); // fullPath → body
  const pageFrontmatter = new Map<string, WikiPageFrontmatter>(); // fullPath → frontmatter
  const pageLinks = new Map<string, string[]>(); // fullPath → link targets (resolved relative paths)
  const inboundLinks = new Set<string>(); // relative paths that are linked TO

  for (const pagePath of wikiPages) {
    try {
      const page = await readPage(pagePath);
      pageContents.set(pagePath, page.body);
      pageFrontmatter.set(pagePath, page.frontmatter);
      const links = getPageLinks(page.body);
      const resolvedLinks: string[] = [];
      for (const link of links) {
        const resolved = resolve(dirname(pagePath), link);
        const rel = normalizePath(relative(wikiDir, resolved));
        resolvedLinks.push(rel);
        inboundLinks.add(rel);
      }
      pageLinks.set(pagePath, resolvedLinks);
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      // Could not read page — skip
    }
  }

  // Read index
  const indexEntries = await readIndex(indexPath);
  const indexedPaths = new Set(indexEntries.map((e) => normalizePath(e.path)));

  // ── broken-links: Links pointing to non-existent files ──
  if (shouldRun('broken-links')) {
    for (const [pagePath, links] of pageLinks) {
      const pageRel = normalizePath(relative(wikiDir, pagePath));
      for (const linkRel of links) {
        if (!existingPagePaths.has(linkRel)) {
          findings.push({
            severity: 'error',
            category: 'broken-links',
            message: `Broken link to "${linkRel}" in page "${pageRel}"`,
            file: pageRel,
          });
        }
      }
    }
  }

  // ── orphan-pages: No inbound links AND not in index ──
  if (shouldRun('orphan-pages')) {
    for (const pageRel of existingPagePaths) {
      if (!inboundLinks.has(pageRel) && !indexedPaths.has(pageRel)) {
        findings.push({
          severity: 'warning',
          category: 'orphan-pages',
          message: `Orphan page "${pageRel}" — not linked and not indexed`,
          file: pageRel,
        });
      }
    }
  }

  // ── index-completeness: Every wiki page should be in index ──
  if (shouldRun('index-completeness')) {
    for (const pageRel of existingPagePaths) {
      if (!indexedPaths.has(pageRel)) {
        findings.push({
          severity: 'warning',
          category: 'index-completeness',
          message: `Page "${pageRel}" is not listed in index.md`,
          file: pageRel,
        });
      }
    }
  }

  // ── stale-entries: Index entries pointing to deleted files ──
  if (shouldRun('stale-entries')) {
    for (const entry of indexEntries) {
      const entryPath = normalizePath(entry.path);
      const fullPath = join(wikiDir, entryPath);
      if (!(await fileExists(fullPath))) {
        findings.push({
          severity: 'error',
          category: 'stale-entries',
          message: `Stale index entry "${entry.title}" points to missing file "${entryPath}"`,
          file: entryPath,
        });
      }
    }
  }

  // ── missing-pages: Unique missing link targets (deduped info) ──
  if (shouldRun('missing-pages')) {
    const missingSet = new Set<string>();
    for (const [, links] of pageLinks) {
      for (const linkRel of links) {
        if (!existingPagePaths.has(linkRel) && !missingSet.has(linkRel)) {
          missingSet.add(linkRel);
          findings.push({
            severity: 'info',
            category: 'missing-pages',
            message: `Referenced page "${linkRel}" does not exist`,
            file: linkRel,
          });
        }
      }
    }
  }

  // ── frontmatter-validation: Check page frontmatter fields ──
  if (shouldRun('frontmatter-validation')) {
    const validTypes = ['entity', 'concept', 'source', 'summary', 'query'];
    for (const pagePath of wikiPages) {
      const pageRel = normalizePath(relative(wikiDir, pagePath));
      const fm = pageFrontmatter.get(pagePath);
      if (!fm) continue;

      if (!fm.type) {
        findings.push({
          severity: 'error',
          category: 'frontmatter-validation',
          message: `Missing required "type" field in frontmatter of "${pageRel}"`,
          file: pageRel,
        });
      } else if (!validTypes.includes(fm.type)) {
        findings.push({
          severity: 'warning',
          category: 'frontmatter-validation',
          message: `Invalid type "${fm.type}" in "${pageRel}" — expected one of: ${validTypes.join(', ')}`,
          file: pageRel,
        });
      }

      if (!fm.title) {
        findings.push({
          severity: 'error',
          category: 'frontmatter-validation',
          message: `Missing required "title" field in frontmatter of "${pageRel}"`,
          file: pageRel,
        });
      }

      if (!fm.tags) {
        findings.push({
          severity: 'info',
          category: 'frontmatter-validation',
          message: `Missing recommended "tags" field in "${pageRel}"`,
          file: pageRel,
        });
      }

      if (!fm.created) {
        findings.push({
          severity: 'info',
          category: 'frontmatter-validation',
          message: `Missing recommended "created" field in "${pageRel}"`,
          file: pageRel,
        });
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  const categorySummary: Record<string, number> = {};
  for (const f of findings) {
    categorySummary[f.category] = (categorySummary[f.category] ?? 0) + 1;
  }

  return {
    command: 'lint',
    api_version: API_VERSION,
    findings,
    errorCount,
    warningCount,
    infoCount,
    categorySummary,
  };
}

export interface LintFixOptions {
  /** When true, remove orphan pages (destructive). Default: false. */
  fixOrphans?: boolean;
}

export interface LintFixResult {
  command: string;
  api_version: string;
  fixed: LintFinding[];
  remaining: LintFinding[];
  fixedCount: number;
}

/** Categories that lintFix can auto-fix. */
const FIXABLE_CATEGORIES = new Set([
  'stale-entries',
  'index-completeness',
  'frontmatter-validation',
]);

/**
 * Derive a human-readable title from a relative page path.
 * e.g. "entities/my-topic.md" → "My Topic"
 */
function titleFromPath(relPath: string): string {
  const stem = basename(relPath, '.md');
  return stem.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derive a default category from a relative page path.
 * e.g. "entities/foo.md" → "Entities", "concepts/bar.md" → "Concepts"
 */
function categoryFromPath(relPath: string): string {
  const dir = dirname(relPath);
  if (dir === '.') return 'Uncategorized';
  const first = dir.split('/')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Run lint checks and automatically fix deterministic issues.
 *
 * Fixable:
 *  - stale-entries → remove from index
 *  - index-completeness → add missing pages to index
 *  - frontmatter-validation (missing fields) → add defaults
 *
 * NOT auto-fixed (by default):
 *  - orphan-pages → destructive, requires fixOrphans: true
 *  - broken-links → requires human judgment
 *  - missing-pages → informational (broken-links covers the error)
 */
export async function lintFix(
  targetPath: string,
  options: LintFixOptions = {},
): Promise<LintFixResult> {
  const root = resolve(targetPath);
  const wikiDir = join(root, 'wiki');
  const indexPath = join(wikiDir, 'index.md');

  // 1. Run full lint to get all findings
  const lintResult = await lintWiki(targetPath);

  const fixed: LintFinding[] = [];
  const remaining: LintFinding[] = [];

  // Partition findings into fixable and non-fixable
  const fixableFindings: LintFinding[] = [];
  for (const finding of lintResult.findings) {
    if (FIXABLE_CATEGORIES.has(finding.category)) {
      fixableFindings.push(finding);
    } else if (finding.category === 'orphan-pages' && options.fixOrphans) {
      fixableFindings.push(finding);
    } else {
      remaining.push(finding);
    }
  }

  // 2. Fix stale-entries: remove index entries pointing to missing files
  const staleFindings = fixableFindings.filter((f) => f.category === 'stale-entries');
  for (const finding of staleFindings) {
    if (!finding.file) {
      remaining.push(finding);
      continue;
    }
    try {
      await removeEntry(indexPath, finding.file);
      fixed.push(finding);
    } catch {
      remaining.push(finding);
    }
  }

  // 3. Fix index-completeness: add missing pages to index
  const missingIndexFindings = fixableFindings.filter(
    (f) => f.category === 'index-completeness',
  );
  for (const finding of missingIndexFindings) {
    if (!finding.file) {
      remaining.push(finding);
      continue;
    }
    const relPath = finding.file;
    const fullPath = join(wikiDir, relPath);
    try {
      const page = await readPage(fullPath);
      const entry: IndexEntry = {
        path: relPath,
        title: page.frontmatter.title || titleFromPath(relPath),
        summary: '',
        category: categoryFromPath(relPath),
        tags: page.frontmatter.tags || [],
      };
      await addEntry(indexPath, entry);
      fixed.push(finding);
    } catch {
      remaining.push(finding);
    }
  }

  // 4. Fix frontmatter-validation: add missing default fields
  const fmFindings = fixableFindings.filter(
    (f) => f.category === 'frontmatter-validation',
  );

  // Group frontmatter findings by file to batch writes per page
  const fmByFile = new Map<string, LintFinding[]>();
  for (const finding of fmFindings) {
    if (!finding.file) {
      remaining.push(finding);
      continue;
    }
    if (!fmByFile.has(finding.file)) {
      fmByFile.set(finding.file, []);
    }
    fmByFile.get(finding.file)!.push(finding);
  }

  for (const [relPath, findings] of fmByFile) {
    const fullPath = join(wikiDir, relPath);
    try {
      const page = await readPage(fullPath);
      let modified = false;
      const fixedInPage: LintFinding[] = [];
      const remainingInPage: LintFinding[] = [];

      for (const finding of findings) {
        const msg = finding.message;
        if (msg.includes('Missing required "type"')) {
          page.frontmatter.type = 'entity';
          modified = true;
          fixedInPage.push(finding);
        } else if (msg.includes('Missing required "title"')) {
          page.frontmatter.title = titleFromPath(relPath);
          modified = true;
          fixedInPage.push(finding);
        } else if (msg.includes('Missing recommended "tags"')) {
          page.frontmatter.tags = [];
          modified = true;
          fixedInPage.push(finding);
        } else if (msg.includes('Missing recommended "created"')) {
          page.frontmatter.created = new Date().toISOString().split('T')[0];
          modified = true;
          fixedInPage.push(finding);
        } else if (msg.includes('Invalid type')) {
          // Invalid type is not auto-fixable — requires human judgment
          remainingInPage.push(finding);
        } else {
          remainingInPage.push(finding);
        }
      }

      if (modified) {
        await writePage(fullPath, page);
      }
      fixed.push(...fixedInPage);
      remaining.push(...remainingInPage);
    } catch {
      remaining.push(...findings);
    }
  }

  // 5. Fix orphan-pages (only when fixOrphans is true): add to index
  if (options.fixOrphans) {
    const orphanFindings = fixableFindings.filter(
      (f) => f.category === 'orphan-pages',
    );
    for (const finding of orphanFindings) {
      if (!finding.file) {
        remaining.push(finding);
        continue;
      }
      const relPath = finding.file;
      const fullPath = join(wikiDir, relPath);
      try {
        const page = await readPage(fullPath);
        const entry: IndexEntry = {
          path: relPath,
          title: page.frontmatter.title || titleFromPath(relPath),
          summary: '',
          category: categoryFromPath(relPath),
          tags: page.frontmatter.tags || [],
        };
        await addEntry(indexPath, entry);
        fixed.push(finding);
      } catch {
        remaining.push(finding);
      }
    }
  }

  return {
    command: 'lint-fix',
    api_version: API_VERSION,
    fixed,
    remaining,
    fixedCount: fixed.length,
  };
}
