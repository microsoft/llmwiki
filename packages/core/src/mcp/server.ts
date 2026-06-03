import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { READ_TOOLS, handleReadToolCall } from './read-tools.js';
import type { ToolArgs } from './read-tools.js';
import { WRITE_TOOLS, handleWriteToolCall } from './write-tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));
const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

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
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  // Unified tool listing: read + write tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...READ_TOOLS, ...WRITE_TOOLS],
  }));

  // Unified call dispatch: route to the correct handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let text: string;
      if (READ_TOOL_NAMES.has(name)) {
        text = await handleReadToolCall(name, (args ?? {}) as ToolArgs, wikiRoot);
      } else if (WRITE_TOOL_NAMES.has(name)) {
        text = await handleWriteToolCall(name, (args ?? {}) as ToolArgs, wikiRoot);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: 'text' as const, text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Resource handlers (browsable wiki content)
  registerResources(server, wikiRoot);

  // Prompt templates (reusable agent workflows)
  registerPrompts(server, wikiRoot);

  return server;
}
