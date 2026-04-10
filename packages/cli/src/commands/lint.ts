import { Command } from 'commander';
import { access, constants } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { listPages, readPage, getPageLinks, readIndex } from '@llmwiki/shared';

export interface LintFinding {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  file?: string;
}

export interface LintResult {
  command: string;
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    // ENOENT — file doesn't exist
    return false;
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
  const pageLinks = new Map<string, string[]>(); // fullPath → link targets (resolved relative paths)
  const inboundLinks = new Set<string>(); // relative paths that are linked TO

  for (const pagePath of wikiPages) {
    try {
      const page = await readPage(pagePath);
      pageContents.set(pagePath, page.body);
      const links = getPageLinks(page.body);
      const resolvedLinks: string[] = [];
      for (const link of links) {
        const resolved = resolve(dirname(pagePath), link);
        const rel = normalizePath(relative(wikiDir, resolved));
        resolvedLinks.push(rel);
        inboundLinks.add(rel);
      }
      pageLinks.set(pagePath, resolvedLinks);
    } catch {
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

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  return {
    command: 'lint',
    findings,
    errorCount,
    warningCount,
    infoCount,
  };
}

/**
 * Format lint result as human-readable output.
 */
function formatLintOutput(result: LintResult): string {
  const lines: string[] = [];

  if (result.findings.length === 0) {
    lines.push('✓ No lint issues found');
    return lines.join('\n');
  }

  const severityIcon: Record<string, string> = {
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
  };

  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const infos = result.findings.filter((f) => f.severity === 'info');

  for (const group of [errors, warnings, infos]) {
    for (const finding of group) {
      const icon = severityIcon[finding.severity];
      lines.push(`${icon} [${finding.category}] ${finding.message}`);
    }
  }

  lines.push('');
  const parts: string[] = [];
  if (result.errorCount > 0) parts.push(`${result.errorCount} error(s)`);
  if (result.warningCount > 0) parts.push(`${result.warningCount} warning(s)`);
  if (result.infoCount > 0) parts.push(`${result.infoCount} info(s)`);
  lines.push(`Summary: ${parts.join(', ')}`);

  return lines.join('\n');
}

/**
 * Register the `lint` subcommand on the wiki command group.
 */
export function registerLintCommand(wiki: Command): void {
  wiki
    .command('lint')
    .description('Run health checks on the wiki knowledge base')
    .option('--path <dir>', 'Target directory', '.')
    .option('--category <categories>', 'Comma-separated list of check categories to run')
    .action(async (options: { path: string; category?: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const categories = options.category
        ? options.category.split(',').map((c) => c.trim())
        : undefined;

      const result = await lintWiki(options.path, categories);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else {
        console.log(formatLintOutput(result));
      }

      if (result.errorCount > 0) {
        process.exitCode = 1;
      }
    });
}
