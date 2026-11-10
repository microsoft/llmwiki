#!/usr/bin/env node
/**
 * llmwiki-mcp — stdio launcher for the LLM Wiki MCP server.
 *
 * Usage:
 *   llmwiki-mcp [wiki-root]
 *   npx -p @llmwiki/core llmwiki-mcp [wiki-root]
 *
 * The wiki root is the `.wiki` directory created by `LLM Wiki: Initialize
 * Wiki` in VS Code. It comes from the first argument, or else the
 * `LLMWIKI_ROOT` environment variable; the server then works on that wiki
 * only. Without either, the server uses `<cwd>/.wiki` if it exists at
 * startup, otherwise the client's workspace roots, and finally the
 * `wiki_open` and `wiki_init` tools (agent plugins start the server in the
 * plugin folder).
 *
 * Intended to be invoked by MCP-compatible hosts (Claude Desktop, Cursor,
 * VS Code Copilot MCP, Copilot CLI plugins, etc.) over stdio.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const configured = arg && arg.length > 0 ? arg : process.env.LLMWIKI_ROOT;

  let wikiRoot: string | undefined;
  if (configured && configured.length > 0) {
    wikiRoot = resolve(configured);
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
          `Initialize one first (e.g. via "LLM Wiki: Initialize Wiki" in VS Code) ` +
          `or pass the path explicitly:\n` +
          `  llmwiki-mcp <path/to/.wiki>\n`,
      );
      process.exit(1);
    }
  }

  const server = createMcpServer(wikiRoot ? { wikiRoot } : { cwd: process.cwd() });
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
