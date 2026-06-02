#!/usr/bin/env node
/**
 * llmwiki-mcp — stdio launcher for the LLM Wiki MCP server.
 *
 * Usage:
 *   llmwiki-mcp [wiki-root]
 *   npx -p @llmwiki/shared llmwiki-mcp [wiki-root]
 *
 * If `wiki-root` is omitted it defaults to `<cwd>/.wiki`, matching the
 * directory created by `LLM Wiki: Initialize` in the VS Code extension.
 *
 * Intended to be invoked by MCP-compatible hosts (Claude Desktop, Cursor,
 * VS Code Copilot MCP, etc.) over stdio.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { WIKI_DIR_NAME } from '../constants.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const wikiRoot = resolve(arg && arg.length > 0 ? arg : `./${WIKI_DIR_NAME}`);

  try {
    const info = await stat(wikiRoot);
    if (!info.isDirectory()) {
      process.stderr.write(
        `llmwiki-mcp: ${wikiRoot} exists but is not a directory.\n`,
      );
      process.exit(1);
    }
  } catch {
    process.stderr.write(
      `llmwiki-mcp: wiki root not found at ${wikiRoot}.\n` +
        `Initialize one first (e.g. via "LLM Wiki: Initialize" in VS Code) ` +
        `or pass the path explicitly:\n` +
        `  llmwiki-mcp <path/to/.wiki>\n`,
    );
    process.exit(1);
  }

  const server = createMcpServer(wikiRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the transport closes. The MCP SDK manages
  // the lifecycle; we just need to avoid exiting prematurely.
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`llmwiki-mcp: fatal error — ${msg}\n`);
  process.exit(1);
});
