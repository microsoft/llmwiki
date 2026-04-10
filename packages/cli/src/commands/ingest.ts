import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { Command } from 'commander';
import { ingestSource, bulkIngest } from '@llmwiki/shared';
export { type IngestResult, ingestSource } from '@llmwiki/shared';

/**
 * Register the `ingest` subcommand on the wiki command group.
 */
export function registerIngestCommand(wiki: Command): void {
  wiki
    .command('ingest')
    .description('Ingest source file(s) into the wiki knowledge base')
    .argument('[source]', 'Path to source file or directory (omit with --all for raw/)')
    .option('--all', 'Ingest all files from the raw/ directory', false)
    .option('--path <dir>', 'Target directory', '.')
    .option('--dry-run', 'Preview changes without writing files', false)
    .option('--force', 'Re-ingest even if source was already ingested', false)
    .action(async (source: string | undefined, options: { all: boolean; path: string; dryRun: boolean; force: boolean }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;

      // Determine if this is a bulk operation
      if (options.all || (source && await isDirectory(source))) {
        const rawDir = options.all
          ? join(options.path, 'raw')
          : source!;

        const result = await bulkIngest(rawDir, options.path, {
          dryRun: options.dryRun,
          force: options.force,
          onProgress: jsonMode ? undefined : (current, total, file) => {
            console.log(`Ingesting ${current}/${total}: ${file}`);
          },
        });

        if (jsonMode) {
          console.log(JSON.stringify(result));
        } else if (result.total === 0) {
          console.log('No source files found.');
        } else if (options.dryRun) {
          console.log(`Dry run — ${result.total} file(s) scanned`);
          console.log(`  Would ingest: ${result.ingested}`);
          console.log(`  Skipped: ${result.skipped}`);
        } else {
          console.log(`✓ Bulk ingest complete`);
          console.log(`  Ingested: ${result.ingested}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
          if (result.failed > 0) {
            for (const f of result.files.filter(f => f.status === 'failed')) {
              console.error(`  ✗ ${f.file}: ${f.error}`);
            }
            process.exitCode = 1;
          }
        }
        return;
      }

      // Single file ingest — source is required
      if (!source) {
        console.error('✗ Please provide a source file path or use --all for bulk ingest.');
        process.exitCode = 1;
        return;
      }

      const result = await ingestSource(source, options.path, options.dryRun, options.force);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.status === 'error') {
        console.error(`✗ ${result.error}`);
        process.exitCode = 1;
      } else if (result.status === 'skipped') {
        console.log(`⊘ ${result.message}`);
      } else if (result.dry_run) {
        console.log('Dry run — no files written');
        console.log(`  Would create: ${result.pages_created.join(', ')}`);
        console.log(`  Would update: ${result.pages_updated.join(', ')}`);
      } else {
        console.log('✓ Source ingested successfully');
        console.log(`  Created: ${result.pages_created.join(', ')}`);
        console.log(`  Updated: ${result.pages_updated.join(', ')}`);
      }
    });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
