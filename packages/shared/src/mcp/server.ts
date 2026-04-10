import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerReadTools } from './read-tools.js';

/**
 * Create a fully-configured MCP server for LLM Wiki.
 *
 * The returned {@link Server} has all tool handlers registered and is ready to
 * be connected to a transport (e.g. `StdioServerTransport`).
 *
 * @param wikiRoot  Path to the wiki root directory.  Every tool handler
 *                  receives this as implicit context so callers don't have to
 *                  supply it per-request.
 */
export function createMcpServer(wikiRoot: string): Server {
  const server = new Server(
    { name: 'llmwiki', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  registerReadTools(server, wikiRoot);

  return server;
}
