import { Command } from 'commander';
import { createMcpServer } from '@llmwiki/shared';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Register the `mcp` subcommand on the wiki command group.
 *
 * Starts a Model Context Protocol server over stdio, making the wiki
 * accessible to external LLM agents.
 */
export function registerMcpCommand(wiki: Command): void {
  wiki
    .command('mcp')
    .description('Start MCP server for LLM agent integration')
    .option('--path <path>', 'Wiki root directory', '.')
    .action(async (opts: { path: string }) => {
      const server = createMcpServer(opts.path);
      const transport = new StdioServerTransport();
      await server.connect(transport);
      // Server is now running, communicating over stdin/stdout.
      // All diagnostic output goes to stderr so stdout stays clean for MCP JSON-RPC.
      process.stderr.write('LLM Wiki MCP server started\n');
    });
}
