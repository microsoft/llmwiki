import { Command } from 'commander';
import { ingestSource } from '@llmwiki/shared';
export { type IngestResult, ingestSource } from '@llmwiki/shared';

/**
 * Register the `ingest` subcommand on the wiki command group.
 */
export function registerIngestCommand(wiki: Command): void {
  wiki
    .command('ingest')
    .description('Ingest a source file into the wiki knowledge base')
    .argument('<source>', 'Path to the source file to ingest')
    .option('--path <dir>', 'Target directory', '.')
    .option('--dry-run', 'Preview changes without writing files', false)
    .option('--force', 'Re-ingest even if source was already ingested', false)
    .action(async (source: string, options: { path: string; dryRun: boolean; force: boolean }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
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
