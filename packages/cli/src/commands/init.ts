import { Command } from 'commander';
import { initWiki } from '@llmwiki/shared';

/**
 * Register the `init` subcommand on the wiki command group.
 */
export function registerInitCommand(wiki: Command): void {
  wiki
    .command('init')
    .description('Initialize a new wiki knowledge base')
    .option('--path <dir>', 'Target directory', '.')
    .action(async (options: { path: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const result = await initWiki(options.path);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.status === 'already_initialized') {
        console.log(`⚠ ${result.warning}`);
      } else {
        console.log('✓ Wiki initialized successfully');
        console.log(`  Directories: ${result.created_dirs.join(', ')}`);
        console.log(`  Files: ${result.created_files.join(', ')}`);
      }
    });
}
