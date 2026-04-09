import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerInitCommand } from './commands/init.js';
import { registerIngestCommand } from './commands/ingest.js';
import { registerLintCommand } from './commands/lint.js';
import { registerStatusCommand } from './commands/status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')
);

export function createProgram(): Command {
  const program = new Command();

  program
    .name('plaid')
    .description('Plaid CLI — modular developer toolkit')
    .version(pkg.version);

  const wiki = program
    .command('wiki')
    .description('Personal knowledge base powered by LLM')
    .option('--json', 'Output results as JSON', false);

  // Register implemented commands
  registerInitCommand(wiki);
  registerIngestCommand(wiki);
  registerLintCommand(wiki);
  registerStatusCommand(wiki);

  // Placeholder subcommands for commands not yet implemented
  const subcommands = ['query'] as const;

  for (const name of subcommands) {
    wiki
      .command(name)
      .description(`${name} — not yet implemented`)
      .action((_options: unknown, cmd: Command) => {
        const jsonMode = cmd.parent?.opts().json ?? false;
        if (jsonMode) {
          console.log(JSON.stringify({ error: 'not yet implemented' }));
        } else {
          console.log(`${name}: not yet implemented`);
        }
      });
  }

  return program;
}

const program = createProgram();

if (resolve(process.argv[1] ?? '') === __filename) {
  program.parse(process.argv);
}
