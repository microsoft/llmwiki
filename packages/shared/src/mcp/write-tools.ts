import { join } from 'node:path';
import { readPage, writePage } from '../wiki.js';
import { readIndex, writeIndex } from '../index-ops.js';
import type { IndexEntry } from '../index-ops.js';
import { isNotFoundError } from '../errors.js';
import {
  assertWithinDir,
  requireString,
  optionalString,
} from './read-tools.js';
import type { ToolArgs } from './read-tools.js';

/** JSON-Schema definition for a single MCP tool. */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** All write tool definitions exposed by the MCP server. */
export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'wiki_write_page',
    description:
      'Create or overwrite a wiki page with frontmatter and body content. Automatically updates the index.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: {
          type: 'string',
          description: 'Relative path within the wiki/ directory (e.g. "concepts/ai.md")',
        },
        title: {
          type: 'string',
          description: 'Page title (required)',
        },
        type: {
          type: 'string',
          description: 'Page type, e.g. "entity", "concept", "source" (required)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of tags',
        },
        body: {
          type: 'string',
          description: 'Markdown body content',
        },
      },
      required: ['pagePath', 'title', 'type', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_update_page',
    description:
      'Update an existing wiki page by merging partial frontmatter changes and/or appending or replacing body content. Updates the index if metadata changed.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: {
          type: 'string',
          description: 'Relative path within the wiki/ directory (e.g. "concepts/ai.md")',
        },
        title: {
          type: 'string',
          description: 'New title (optional, keeps existing if omitted)',
        },
        type: {
          type: 'string',
          description: 'New type (optional, keeps existing if omitted)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags list (optional, keeps existing if omitted)',
        },
        bodyAppend: {
          type: 'string',
          description: 'Content to append to the existing body',
        },
        bodyReplace: {
          type: 'string',
          description: 'Content to replace the entire body with',
        },
      },
      required: ['pagePath'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate that an optional argument, if present, is a string array. */
function optionalStringArray(args: ToolArgs, key: string): string[] | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (!Array.isArray(val) || !val.every((v) => typeof v === 'string')) {
    throw new Error(`'${key}' must be an array of strings`);
  }
  return val as string[];
}

/**
 * Derive a category from the page path.
 * For paths like "concepts/ai.md" → "Concepts".
 * For paths like "ai.md" → "General".
 */
function categoryFromPath(pagePath: string): string {
  const parts = pagePath.replace(/\\/g, '/').split('/');
  if (parts.length > 1) {
    const dir = parts[0];
    return dir.charAt(0).toUpperCase() + dir.slice(1);
  }
  return 'General';
}

/**
 * Add or update an index entry for the given page.
 * If an entry with the same path already exists, it is replaced.
 */
async function upsertIndexEntry(
  indexPath: string,
  entry: IndexEntry,
): Promise<void> {
  const entries = await readIndex(indexPath);
  const idx = entries.findIndex((e) => e.path === entry.path);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  await writeIndex(indexPath, entries);
}

// ---------------------------------------------------------------------------
// Tool handler dispatch
// ---------------------------------------------------------------------------

/** Resolve a write tool call to its result text. */
export async function handleWriteToolCall(
  name: string,
  args: ToolArgs,
  wikiRoot: string,
): Promise<string> {
  const wikiDir = join(wikiRoot, 'wiki');
  const indexPath = join(wikiRoot, 'wiki', 'index.md');

  switch (name) {
    case 'wiki_write_page': {
      const pagePath = requireString(args, 'pagePath');
      const title = requireString(args, 'title');
      const type = requireString(args, 'type');
      const tags = optionalStringArray(args, 'tags') ?? [];
      const body = requireString(args, 'body');

      const fullPath = assertWithinDir(wikiDir, pagePath);

      await writePage(fullPath, {
        frontmatter: { type, title, tags },
        body,
      });

      await upsertIndexEntry(indexPath, {
        path: pagePath,
        title,
        summary: '',
        category: categoryFromPath(pagePath),
        tags,
      });

      return JSON.stringify({
        status: 'created',
        path: pagePath,
        title,
        type,
        tags,
      });
    }

    case 'wiki_update_page': {
      const pagePath = requireString(args, 'pagePath');
      const fullPath = assertWithinDir(wikiDir, pagePath);

      // Read existing page — fail gracefully if not found
      let existing;
      try {
        existing = await readPage(fullPath);
      } catch (err) {
        if (isNotFoundError(err)) {
          throw new Error(`Page not found: ${pagePath}`);
        }
        throw err;
      }

      // Merge frontmatter updates
      const newTitle = optionalString(args, 'title');
      const newType = optionalString(args, 'type');
      const newTags = optionalStringArray(args, 'tags');

      const mergedFrontmatter = { ...existing.frontmatter };
      if (newTitle !== undefined) mergedFrontmatter.title = newTitle;
      if (newType !== undefined) mergedFrontmatter.type = newType;
      if (newTags !== undefined) mergedFrontmatter.tags = newTags;

      // Handle body updates
      const bodyAppend = optionalString(args, 'bodyAppend');
      const bodyReplace = optionalString(args, 'bodyReplace');

      let mergedBody = existing.body;
      if (bodyReplace !== undefined) {
        mergedBody = bodyReplace;
      } else if (bodyAppend !== undefined) {
        mergedBody = existing.body + '\n\n' + bodyAppend;
      }

      await writePage(fullPath, {
        frontmatter: mergedFrontmatter,
        body: mergedBody,
      });

      // Update index if metadata changed
      const metadataChanged =
        newTitle !== undefined || newType !== undefined || newTags !== undefined;
      if (metadataChanged) {
        await upsertIndexEntry(indexPath, {
          path: pagePath,
          title: (mergedFrontmatter.title as string) ?? '',
          summary: '',
          category: categoryFromPath(pagePath),
          tags: (mergedFrontmatter.tags as string[]) ?? [],
        });
      }

      return JSON.stringify({
        status: 'updated',
        path: pagePath,
        frontmatter: mergedFrontmatter,
        bodyUpdated: bodyAppend !== undefined || bodyReplace !== undefined,
        indexUpdated: metadataChanged,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
