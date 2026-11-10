import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CORE_VERSION } from '../constants.js';
import { READ_TOOLS, handleReadToolCall } from './read-tools.js';
import type { ToolArgs, ToolDefinition } from './read-tools.js';
import { WRITE_TOOLS, handleWriteToolCall } from './write-tools.js';
import { WORKSPACE_TOOLS, handleWorkspaceToolCall } from './workspace-tools.js';
import { WikiRootState } from './wiki-root.js';
import { buildInstructions } from './instructions.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { registerCompletions } from './completions.js';

const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));
const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOLS.map((t) => t.name));

/** An open book, drawn for the server's icon. */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4F6BED" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4.5A1.5 1.5 0 0 1 3 16.5z"/>' +
  '<path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>';
const ICON_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`;

export interface CreateMcpServerOptions {
  /**
   * Wiki root (the `.wiki` directory) the server is bound to. When omitted,
   * the server locates the wiki itself and exposes `wiki_open`/`wiki_init`.
   */
  wikiRoot?: string;
  /** Directory checked for a `.wiki` folder when no root is given. Default: `process.cwd()`. */
  cwd?: string;
}

/**
 * Create a fully-configured MCP server for LLM Wiki.
 *
 * The returned {@link Server} has all tool handlers registered and is ready to
 * be connected to a transport (e.g. `StdioServerTransport`).
 *
 * @param options  The wiki root to bind to, or {@link CreateMcpServerOptions}.
 *                 With no root, the wiki is discovered from the client's
 *                 workspace roots or the working directory, or opened with
 *                 the `wiki_open` tool.
 */
export function createMcpServer(options: string | CreateMcpServerOptions = {}): Server {
  const opts: CreateMcpServerOptions = typeof options === 'string' ? { wikiRoot: options } : options;
  const discovery = opts.wikiRoot === undefined;
  const state = new WikiRootState(
    discovery ? { cwd: opts.cwd ?? process.cwd() } : { fixed: opts.wikiRoot },
  );

  const tools: ToolDefinition[] = [
    ...READ_TOOLS,
    ...WRITE_TOOLS,
    ...(discovery ? WORKSPACE_TOOLS : []),
  ];
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    {
      name: 'llmwiki',
      title: 'LLM Wiki',
      version: CORE_VERSION,
      websiteUrl: 'https://github.com/microsoft/llmwiki',
      icons: [{ src: ICON_DATA_URI, mimeType: 'image/svg+xml', sizes: ['any'] }],
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
      instructions: buildInstructions(state.current, { discovery }),
    },
  );
  state.attach(server);
  const getWikiRoot = () => state.require(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as ToolArgs;
    try {
      const tool = toolsByName.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      let text: string;
      if (WORKSPACE_TOOL_NAMES.has(name)) {
        text = await handleWorkspaceToolCall(name, args, state, server);
      } else if (READ_TOOL_NAMES.has(name)) {
        text = await handleReadToolCall(name, args, await getWikiRoot());
      } else if (WRITE_TOOL_NAMES.has(name)) {
        text = await handleWriteToolCall(name, args, await getWikiRoot());
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      if (tool.outputSchema) {
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: JSON.parse(text) as Record<string, unknown>,
        };
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
  registerResources(server, getWikiRoot);

  // Prompt templates (reusable agent workflows)
  registerPrompts(server);

  // Argument completions for resource templates and prompts
  registerCompletions(server, getWikiRoot);

  return server;
}
