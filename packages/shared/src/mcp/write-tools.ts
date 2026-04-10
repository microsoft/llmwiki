import { join } from 'node:path';
import { readPage, writePage, createEntityPage, createConceptPage, addCrosslinks } from '../wiki.js';
import { slugify } from '../utils.js';
import { readIndex, writeIndex, updateIndexEntry } from '../index-ops.js';
import type { IndexEntry } from '../index-ops.js';
import { isNotFoundError } from '../errors.js';
import { ingestWithContext } from '../ingest-context.js';
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
    name: 'wiki_create_entity',
    description:
      'Create a new wiki entity page at wiki/entities/{slug}.md with proper frontmatter and auto-register it in the index.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Entity name (used as title and slugified for filename)',
        },
        content: {
          type: 'string',
          description: 'Markdown body content for the entity page',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of tags',
        },
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_create_concept',
    description:
      'Create a new wiki concept page at wiki/concepts/{slug}.md with proper frontmatter and auto-register it in the index.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Concept name (used as title and slugified for filename)',
        },
        content: {
          type: 'string',
          description: 'Markdown body content for the concept page',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of tags',
        },
      },
      required: ['name', 'content'],
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
  {
    name: 'wiki_add_crosslinks',
    description:
      'Add cross-reference links ("See also" section) from one wiki page to one or more target pages. Validates all target pages exist.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: {
          type: 'string',
          description: 'Relative path of the source page within wiki/ (e.g. "concepts/ai.md")',
        },
        targetPages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of relative paths to link to (e.g. ["entities/openai.md"])',
        },
      },
      required: ['pagePath', 'targetPages'],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_update_index',
    description:
      'Update metadata (summary, tags, category) for an existing entry in the wiki index. Returns success/failure.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: {
          type: 'string',
          description: 'Path of the index entry to update (e.g. "concepts/ai.md")',
        },
        summary: {
          type: 'string',
          description: 'New summary text (optional)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags list (optional)',
        },
        category: {
          type: 'string',
          description: 'New category (optional)',
        },
      },
      required: ['pagePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'wiki_ingest_with_context',
    description:
      'Ingest a source file into the wiki and return enhanced context including related pages, word count, content type, and suggested next actions. Use this instead of plain ingest when you want to understand how the source relates to existing wiki content.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description:
            'Path to the source file to ingest (relative to project root)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, simulate ingest without writing files',
        },
        force: {
          type: 'boolean',
          description:
            'If true, re-ingest even if source was already ingested',
        },
      },
      required: ['sourcePath'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Security limits (S-2: prevent DoS via unbounded input)
// ---------------------------------------------------------------------------

const MAX_BODY_LENGTH = 1_000_000;     // 1 MB
const MAX_TITLE_LENGTH = 500;
const MAX_TAGS_COUNT = 50;
const MAX_TAG_LENGTH = 100;
const MAX_CROSSLINK_TARGETS = 100;
const MAX_PATH_LENGTH = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate that a string does not exceed a maximum length. */
function validateLength(value: string, name: string, max: number): void {
  if (value.length > max) {
    throw new Error(`'${name}' exceeds maximum length of ${max} characters`);
  }
}

/** Validate a tags array against count and individual length limits. */
function validateTags(tags: string[] | undefined): void {
  if (!tags) return;
  if (tags.length > MAX_TAGS_COUNT) {
    throw new Error(`Too many tags (max ${MAX_TAGS_COUNT})`);
  }
  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag exceeds maximum length of ${MAX_TAG_LENGTH} characters`);
    }
  }
}

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

      // S-2: Input length limits
      validateLength(pagePath, 'pagePath', MAX_PATH_LENGTH);
      validateLength(title, 'title', MAX_TITLE_LENGTH);
      validateLength(body, 'body', MAX_BODY_LENGTH);
      validateTags(tags);

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

    case 'wiki_create_entity': {
      const entityName = requireString(args, 'name');
      const content = requireString(args, 'content');
      const tags = optionalStringArray(args, 'tags') ?? [];

      // S-2: Input length limits
      validateLength(entityName, 'name', MAX_TITLE_LENGTH);
      validateLength(content, 'content', MAX_BODY_LENGTH);
      validateTags(tags);

      // S-3: Reject empty slugs (e.g. all-punctuation or non-Latin names)
      const slug = slugify(entityName);
      if (slug.length === 0) {
        throw new Error("'name' must contain at least one alphanumeric character");
      }

      // Validate the derived path stays within wiki dir
      assertWithinDir(wikiDir, `entities/${slug}.md`);

      const result = await createEntityPage(wikiDir, entityName, content, tags);

      return JSON.stringify({
        status: 'created',
        path: result.path,
        title: entityName,
        type: 'entity',
        tags,
      });
    }

    case 'wiki_create_concept': {
      const conceptName = requireString(args, 'name');
      const content = requireString(args, 'content');
      const tags = optionalStringArray(args, 'tags') ?? [];

      // S-2: Input length limits
      validateLength(conceptName, 'name', MAX_TITLE_LENGTH);
      validateLength(content, 'content', MAX_BODY_LENGTH);
      validateTags(tags);

      // S-3: Reject empty slugs (e.g. all-punctuation or non-Latin names)
      const slug = slugify(conceptName);
      if (slug.length === 0) {
        throw new Error("'name' must contain at least one alphanumeric character");
      }

      // Validate the derived path stays within wiki dir
      assertWithinDir(wikiDir, `concepts/${slug}.md`);

      const result = await createConceptPage(wikiDir, conceptName, content, tags);

      return JSON.stringify({
        status: 'created',
        path: result.path,
        title: conceptName,
        type: 'concept',
        tags,
      });
    }

    case 'wiki_update_page': {
      const pagePath = requireString(args, 'pagePath');
      validateLength(pagePath, 'pagePath', MAX_PATH_LENGTH);
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
      // S-7: Reject empty titles
      if (newTitle !== undefined && newTitle.length === 0) {
        throw new Error("'title' must be non-empty when provided");
      }
      if (newTitle !== undefined) validateLength(newTitle, 'title', MAX_TITLE_LENGTH);
      const newType = optionalString(args, 'type');
      const newTags = optionalStringArray(args, 'tags');
      validateTags(newTags);

      const mergedFrontmatter = { ...existing.frontmatter };
      if (newTitle !== undefined) mergedFrontmatter.title = newTitle;
      if (newType !== undefined) mergedFrontmatter.type = newType;
      if (newTags !== undefined) mergedFrontmatter.tags = newTags;

      // Handle body updates
      const bodyAppend = optionalString(args, 'bodyAppend');
      if (bodyAppend !== undefined) validateLength(bodyAppend, 'bodyAppend', MAX_BODY_LENGTH);
      const bodyReplace = optionalString(args, 'bodyReplace');
      if (bodyReplace !== undefined) validateLength(bodyReplace, 'bodyReplace', MAX_BODY_LENGTH);

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

    case 'wiki_add_crosslinks': {
      const pagePath = requireString(args, 'pagePath');
      validateLength(pagePath, 'pagePath', MAX_PATH_LENGTH);
      const targetPages = optionalStringArray(args, 'targetPages');
      if (!targetPages || targetPages.length === 0) {
        throw new Error("'targetPages' must be a non-empty array of strings");
      }
      // S-2: Limit crosslink target count
      if (targetPages.length > MAX_CROSSLINK_TARGETS) {
        throw new Error(`Too many target pages (max ${MAX_CROSSLINK_TARGETS})`);
      }

      // Validate paths stay within wiki dir
      assertWithinDir(wikiDir, pagePath);
      for (const tp of targetPages) {
        assertWithinDir(wikiDir, tp);
      }

      await addCrosslinks(wikiDir, pagePath, targetPages);

      return JSON.stringify({
        status: 'updated',
        path: pagePath,
        crosslinks: targetPages,
      });
    }

    case 'wiki_update_index': {
      const pagePath = requireString(args, 'pagePath');
      validateLength(pagePath, 'pagePath', MAX_PATH_LENGTH);
      const summary = optionalString(args, 'summary');
      if (summary !== undefined) validateLength(summary, 'summary', MAX_BODY_LENGTH);
      const tags = optionalStringArray(args, 'tags');
      validateTags(tags);
      const category = optionalString(args, 'category');

      const updates: Partial<Omit<IndexEntry, 'path'>> = {};
      if (summary !== undefined) updates.summary = summary;
      if (tags !== undefined) updates.tags = tags;
      if (category !== undefined) updates.category = category;

      const updated = await updateIndexEntry(indexPath, pagePath, updates);

      return JSON.stringify({
        status: updated ? 'updated' : 'not_found',
        path: pagePath,
        fieldsUpdated: Object.keys(updates),
      });
    }

    case 'wiki_ingest_with_context': {
      const sourcePath = requireString(args, 'sourcePath');
      validateLength(sourcePath, 'sourcePath', MAX_PATH_LENGTH);
      // Validate source path stays within project root
      assertWithinDir(wikiRoot, sourcePath);
      const dryRun = args.dryRun === true;
      const force = args.force === true;
      const result = await ingestWithContext(sourcePath, wikiRoot, dryRun, force);
      return JSON.stringify(result);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
