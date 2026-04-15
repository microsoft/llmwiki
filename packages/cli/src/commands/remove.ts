import { join, basename, extname } from 'node:path';
import { unlink, readdir } from 'node:fs/promises';
import { Command } from 'commander';
import {
  slugify,
  deletePage,
  readPage,
  appendEntry,
  isNotFoundError,
} from '@llmwiki/shared';
import { resolveWikiRoot } from '../wiki-root.js';

/**
 * Register the `remove` subcommand on the wiki command group.
 *
 * Mirrors the VS Code extension's `llmwiki.removeSource` command:
 * deletes the raw source file and cascades deletion of its summary page
 * plus any entity/concept pages tagged with that source.
 */
export function registerRemoveCommand(wiki: Command): void {
  wiki
    .command('remove')
    .description('Remove a source file and its associated wiki pages')
    .argument('<source>', 'Path to the raw source file to remove')
    .option('--path <dir>', 'Target directory', '.')
    .option('--keep-raw', 'Keep the raw source file, only remove wiki pages', false)
    .action(async (source: string, options: { path: string; keepRaw: boolean }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const wikiRoot = resolveWikiRoot(options.path);
      const wikiDir = join(wikiRoot, 'wiki');
      const logPath = join(wikiDir, 'log.md');

      const fileName = basename(source);
      const slug = slugify(fileName);
      const summaryRelPath = `sources/${slug}-summary.md`;

      const removedPages: string[] = [];

      // Delete the raw source file
      if (!options.keepRaw) {
        try {
          await unlink(source);
        } catch (err) {
          if (isNotFoundError(err)) {
            if (!jsonMode) console.error(`✗ Source file not found: ${source}`);
            process.exitCode = 1;
            return;
          }
          throw err;
        }
      }

      // Delete the summary page + index entry
      try {
        await deletePage(wikiDir, summaryRelPath);
        removedPages.push(summaryRelPath);
      } catch {
        // Summary page may not exist (never ingested)
      }

      // Delete entity/concept pages tagged with this source
      try {
        const allFiles = await readdir(wikiDir, { recursive: true }) as unknown as string[];
        const mdPages = allFiles
          .filter((f) => typeof f === 'string' && extname(f) === '.md')
          .map((f) => f.replace(/\\/g, '/'))
          .filter((f) => f !== 'index.md' && f !== 'log.md');

        for (const relPath of mdPages) {
          try {
            const page = await readPage(join(wikiDir, relPath));
            const sources = page.frontmatter.sources as string[] | undefined;
            if (sources && sources.includes(summaryRelPath)) {
              await deletePage(wikiDir, relPath);
              removedPages.push(relPath);
            }
          } catch {
            // Skip unreadable pages
          }
        }
      } catch {
        // readdir may fail if wiki dir is empty
      }

      // Log the removal
      try {
        await appendEntry(logPath, {
          verb: 'removed',
          subject: fileName,
          details: `Source file and ${removedPages.length} wiki pages removed.`,
        });
      } catch {
        // Log may not exist
      }

      if (jsonMode) {
        console.log(JSON.stringify({
          source: fileName,
          raw_deleted: !options.keepRaw,
          pages_removed: removedPages,
        }));
      } else {
        if (removedPages.length === 0 && options.keepRaw) {
          console.log(`⊘ No wiki pages found for "${fileName}".`);
        } else {
          console.log(`✓ Removed "${fileName}" and ${removedPages.length} wiki page(s).`);
          for (const p of removedPages) {
            console.log(`  ✓ ${p}`);
          }
        }
      }
    });
}
