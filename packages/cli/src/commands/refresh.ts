import { join, extname } from 'node:path';
import { readdir, stat as fsStat } from 'node:fs/promises';
import { Command } from 'commander';
import {
  readPage,
  deletePage,
  lintFix,
  directoryExists,
} from '@llmwiki/shared';
import { resolveWikiRoot } from '../wiki-root.js';

/**
 * Register the `refresh` subcommand on the wiki command group.
 *
 * Mirrors the VS Code extension's `llmwiki.refresh` command:
 * 1. Deletes orphaned entity/concept pages whose sources no longer exist
 * 2. Runs mechanical lint-fix to repair stale index entries
 */
export function registerRefreshCommand(wiki: Command): void {
  wiki
    .command('refresh')
    .description('Refresh wiki: clean orphaned pages and auto-fix lint issues')
    .option('--path <dir>', 'Target directory', '.')
    .action(async (options: { path: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const wikiRoot = resolveWikiRoot(options.path);
      const wikiDir = join(wikiRoot, 'wiki');

      if (!(await directoryExists(wikiDir))) {
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'Wiki not initialized' }));
        } else {
          console.error('✗ Wiki not initialized. Run "plaid wiki init" first.');
        }
        process.exitCode = 1;
        return;
      }

      // Step 1: Delete entity/concept pages whose source pages no longer exist
      let cleanedPages = 0;
      try {
        const allFiles = await readdir(wikiDir, { recursive: true }) as unknown as string[];
        const mdPages = allFiles
          .filter((f) => typeof f === 'string' && extname(f) === '.md')
          .map((f) => f.replace(/\\/g, '/'))
          .filter((f) => f.startsWith('entities/') || f.startsWith('concepts/'));

        for (const relPath of mdPages) {
          try {
            const page = await readPage(join(wikiDir, relPath));
            const sources = page.frontmatter.sources as string[] | undefined;
            if (sources && sources.length > 0) {
              const allMissing = (await Promise.all(
                sources.map(async (s) => {
                  try { await fsStat(join(wikiDir, s)); return false; }
                  catch { return true; }
                }),
              )).every(Boolean);

              if (allMissing) {
                await deletePage(wikiDir, relPath);
                cleanedPages++;
              }
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // readdir may fail
      }

      // Step 2: Run lint-fix
      const fixResult = await lintFix(wikiRoot, { fixOrphans: true });
      const remaining = fixResult.remaining.filter((f) => f.severity === 'error' || f.severity === 'warning');

      if (jsonMode) {
        console.log(JSON.stringify({
          orphans_cleaned: cleanedPages,
          issues_fixed: fixResult.fixedCount,
          issues_remaining: remaining.length,
          remaining: remaining.map((f) => ({
            severity: f.severity,
            category: f.category,
            message: f.message,
          })),
        }));
      } else {
        const parts: string[] = [];
        if (cleanedPages > 0) parts.push(`${cleanedPages} orphaned page(s) removed`);
        if (fixResult.fixedCount > 0) parts.push(`${fixResult.fixedCount} issue(s) fixed`);
        if (remaining.length > 0) parts.push(`${remaining.length} issue(s) remaining`);

        if (parts.length === 0) {
          console.log('✓ Wiki refreshed — no issues found');
        } else if (remaining.length === 0) {
          console.log(`✓ Wiki refreshed — ${parts.join(', ')}`);
        } else {
          console.log(`⚠ Wiki refreshed — ${parts.join(', ')}`);
          for (const f of remaining) {
            const icon = f.severity === 'error' ? '✗' : '⚠';
            console.log(`  ${icon} [${f.category}] ${f.message}`);
          }
          process.exitCode = 1;
        }
      }
    });
}
