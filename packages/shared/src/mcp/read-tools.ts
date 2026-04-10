import { join, resolve } from 'node:path';
import { getWikiStatus } from '../status.js';
import { queryWiki } from '../query.js';
import { lintWiki } from '../lint.js';
import { listPages, readPage } from '../wiki.js';
import { listSources } from '../sources.js';
import { readIndex } from '../index-ops.js';
import { isNotFoundError } from '../errors.js';

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

export type ToolArgs = Record<string, unknown>;

/** Validate that a required argument is a non-empty string. */
export function requireString(args: ToolArgs, key: string): string {
  const val = args[key];
  if (typeof val !== 'string' || val.length === 0) {
    throw new Error(`'${key}' must be a non-empty string`);
  }
  return val;
}

/** Validate that an optional argument, if present, is a string. */
export function optionalString(args: ToolArgs, key: string): string | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') {
    throw new Error(`'${key}' must be a string`);
  }
  return val;
}

/**
 * S-7: Prevent path traversal — resolved path must stay within baseDir.
 * Mirrors the guard in ingest.ts.
 */
export function assertWithinDir(baseDir: string, relPath: string): string {
  const resolvedBase = resolve(baseDir).replace(/\\/g, '/');
  const resolvedFull = resolve(baseDir, relPath).replace(/\\/g, '/');
  if (!resolvedFull.startsWith(resolvedBase + '/') && resolvedFull !== resolvedBase) {
    throw new Error('Path traversal detected — path must stay within wiki directory');
  }
  return resolvedFull;
}

/** Resolve a tool call to its result text. */
export async function handleReadToolCall(
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
        await queryWiki(requireString(args, 'query'), wikiRoot),
      );

    case 'wiki_lint': {
      const category = optionalString(args, 'category');
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
          } catch (err) {
            if (!isNotFoundError(err)) throw err;
            return { path: p, frontmatter: {} };
          }
        }),
      );
      return JSON.stringify(pages);
    }

    case 'wiki_list_sources':
      return JSON.stringify(await listSources(rawDir));

    case 'wiki_read_page': {
      const relPath = requireString(args, 'path');
      const fullPath = assertWithinDir(wikiDir, relPath);
      return JSON.stringify(await readPage(fullPath));
    }

    case 'wiki_read_index':
      return JSON.stringify(await readIndex(indexPath));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}


