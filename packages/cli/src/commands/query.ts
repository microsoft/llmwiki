import { Command } from 'commander';
import { queryWiki } from '@llmwiki/shared';
import { resolveWikiRoot } from '../wiki-root.js';
export { type QueryResult, type QueryOutput, queryWiki, slugifyQuery } from '@llmwiki/shared';

/**
 * Register the `query` subcommand on the wiki command group.
 */
export function registerQueryCommand(wiki: Command): void {
  wiki
    .command('query')
    .description('Search the wiki for pages matching a query')
    .argument('<query>', 'Search query string')
    .option('--save', 'Save query results as a wiki page', false)
    .option('--path <dir>', 'Wiki root directory', '.')
    .action(async (queryStr: string, options: { save: boolean; path: string }, cmd: Command) => {
      const jsonMode = cmd.parent?.opts().json ?? false;
      const result = await queryWiki(queryStr, resolveWikiRoot(options.path), options.save);

      if (jsonMode) {
        console.log(JSON.stringify(result));
      } else if (result.matches === 0) {
        console.log(`No results found for "${result.query}". Try different search terms.`);
      } else {
        console.log(`Found ${result.matches} result(s) for "${result.query}"\n`);
        result.results.forEach((r, i) => {
          console.log(`${i + 1}. ${r.title} (score: ${r.score})`);
          console.log(`   Path: ${r.path}`);
          console.log(`   ${r.excerpt}\n`);
        });
        if (result.saved) {
          console.log(`✓ Results saved to wiki/${result.saved}`);
        }
      }
    });
}
