import { Command } from 'commander';
import { getWikiStatus, type StatusResult } from '@llmwiki/shared';

// Re-export for backward compatibility (tests import from this file)
export { getWikiStatus, type StatusResult } from '@llmwiki/shared';

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
