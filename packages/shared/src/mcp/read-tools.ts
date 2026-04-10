import { join } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getWikiStatus } from '../status.js';
import { queryWiki } from '../query.js';
import { lintWiki } from '../lint.js';
import { listPages, readPage } from '../wiki.js';
import { listSources } from '../sources.js';
import { readIndex } from '../index-ops.js';

/** JSON-Schema definition for a single MCP tool. */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** All read-only tool definitions exposed by the MCP server. */
export const READ_TOOLS: ToolDefinition[] = [
  {
    name: 'wiki_status',
    description:
      'Return wiki status including source count, page count, lint dates, orphan pages and index coverage.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_query',
    description:
      'Search the wiki for pages matching a free-text query. Returns matched pages with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_lint',
    description:
      'Lint the wiki and return findings grouped by severity (error, warning, info) with optional category filter.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to restrict linting to',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_list_pages',
    description:
      'List all wiki pages with their file paths and frontmatter metadata.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_list_sources',
    description:
      'List all raw source files with name, path, size, modified date and extension.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_read_page',
    description:
      'Read a single wiki page by relative path. Returns frontmatter and body content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path within the wiki/ directory (e.g. "topic.md")',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_read_index',
    description:
      'Read the wiki index file and return parsed entries with path, title, summary, category and tags.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler dispatch
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

/** Resolve a tool call to its result text. */
async function handleToolCall(
  name: string,
  args: ToolArgs,
  wikiRoot: string,
): Promise<string> {
  const wikiDir = join(wikiRoot, 'wiki');
  const rawDir = join(wikiRoot, 'raw');
  const indexPath = join(wikiRoot, 'wiki', 'index.md');

  switch (name) {
    case 'wiki_status':
      return JSON.stringify(await getWikiStatus(wikiRoot));

    case 'wiki_query':
      return JSON.stringify(
        await queryWiki(args.query as string, wikiRoot),
      );

    case 'wiki_lint': {
      const category = args.category as string | undefined;
      return JSON.stringify(
        await lintWiki(wikiRoot, category ? [category] : undefined),
      );
    }

    case 'wiki_list_pages': {
      const paths = await listPages(wikiDir);
      const pages = await Promise.all(
        paths.map(async (p) => {
          try {
            const page = await readPage(p);
            return { path: p, frontmatter: page.frontmatter };
          } catch {
            return { path: p, frontmatter: {} };
          }
        }),
      );
      return JSON.stringify(pages);
    }

    case 'wiki_list_sources':
      return JSON.stringify(await listSources(rawDir));

    case 'wiki_read_page': {
      const relPath = args.path as string;
      const fullPath = join(wikiDir, relPath);
      return JSON.stringify(await readPage(fullPath));
    }

    case 'wiki_read_index':
      return JSON.stringify(await readIndex(indexPath));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all read-only tool handlers on the given MCP server instance.
 *
 * @param server  MCP Server instance
 * @param wikiRoot  Absolute (or relative) path to the wiki root directory
 */
export function registerReadTools(server: Server, wikiRoot: string): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: READ_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await handleToolCall(name, (args ?? {}) as ToolArgs, wikiRoot);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
}
