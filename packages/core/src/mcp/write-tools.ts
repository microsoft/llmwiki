import { dirname, join, relative, extname } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  readPage,
  writePage,
  createEntityPage,
  createConceptPage,
  addCrosslinks,
  deletePage,
  isSpecialWikiFile,
} from '../wiki.js';
import { withWikiLock } from '../lock.js';
import { slugify } from '../utils.js';
import { readIndex, writeIndex, updateIndexEntry } from '../index-ops.js';
import type { IndexEntry } from '../index-ops.js';
import { isNotFoundError } from '../errors.js';
import { ingestWithContext } from '../ingest-context.js';
import { fixWiki, normalizeSourceRef } from '../fix.js';
import { appendEntry } from '../log.js';
import {
  assertWithinDir,
  requireString,
  optionalString,
} from './read-tools.js';
import type { ToolAnnotations, ToolArgs, ToolDefinition } from './read-tools.js';
import { FIX_OUTPUT_SCHEMA } from './schemas.js';

/** Overwrites or removes existing content; repeating the call may change more. */
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Overwrites existing content, but repeating the same call has no further effect. */
const DESTRUCTIVE_IDEMPOTENT: ToolAnnotations = { ...DESTRUCTIVE, idempotentHint: true };

/** Provenance of a derived page; lets wiki_fix remove it when its sources are gone. */
const SOURCES_PROPERTY = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Optional wiki-relative paths of the source summary pages this page is derived from (e.g. ["sources/article-summary.md"]). If all of them are later removed, wiki_fix deletes this page.',
};

/** All write tool definitions exposed by the MCP server. */
export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'wiki_write_page',
    title: 'Write wiki page',
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
    annotations: DESTRUCTIVE_IDEMPOTENT,
  },
  {
    name: 'wiki_create_entity',
    title: 'Create entity page',
    description:
      'Create a new wiki entity page at wiki/entities/{slug}.md with proper frontmatter and auto-register it in the index. Overwrites an existing page with the same slug, so check for one first.',
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
        sources: SOURCES_PROPERTY,
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: 'wiki_create_concept',
    title: 'Create concept page',
    description:
      'Create a new wiki concept page at wiki/concepts/{slug}.md with proper frontmatter and auto-register it in the index. Overwrites an existing page with the same slug, so check for one first.',
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
        sources: SOURCES_PROPERTY,
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: 'wiki_update_page',
    title: 'Update wiki page',
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
        addSources: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Summary pages of other sources whose content you are adding (e.g. ["sources/second-article-summary.md"]). Appended to the page\'s existing "sources" so it is only deleted once all of its sources are removed. Ignored for pages that list no sources.',
        },
      },
      required: ['pagePath'],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: 'wiki_add_crosslinks',
    title: 'Add crosslinks',
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
    // Only appends links and skips duplicates.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'wiki_update_index',
    title: 'Update index entry',
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
    annotations: DESTRUCTIVE_IDEMPOTENT,
  },
  {
    name: 'wiki_ingest_with_context',
    title: 'Ingest source with context',
    description:
      'Ingest a source file into the wiki and return enhanced context including related pages, word count, content type, and suggested next actions. Use this instead of plain ingest when you want to understand how the source relates to existing wiki content.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description:
            'Path to the source file inside the wiki root, relative to the wiki root (e.g. "raw/article.md") or absolute',
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
    // `force` overwrites an existing summary page.
    annotations: DESTRUCTIVE,
  },
  {
    name: 'wiki_fix',
    title: 'Fix wiki issues',
    description:
      'Apply every deterministic wiki fix: delete entity/concept pages whose raw sources were removed, drop stale index entries, index unlisted pages, and add missing frontmatter defaults. Returns the fixes and the findings that still need judgment (for example broken links). Call with dryRun first to preview; if the preview lists removed_pages, apply only after the user approves deleting them.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'If true, report what would change without writing anything',
        },
      },
      required: [],
      additionalProperties: false,
    },
    outputSchema: FIX_OUTPUT_SCHEMA,
    annotations: DESTRUCTIVE_IDEMPOTENT,
  },
  {
    name: 'wiki_delete_page',
    title: 'Delete wiki page',
    description:
      'Delete a wiki page and remove it from the index. Returns the pages that still link to it so you can fix those links. Only use after the user confirms the deletion.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePath: {
          type: 'string',
          description: 'Relative path within the wiki/ directory (e.g. "concepts/ai.md")',
        },
      },
      required: ['pagePath'],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE_IDEMPOTENT,
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
 * Validate optional source-page paths (`key` = "sources" or "addSources"):
 * each must be an existing summary page under wiki/sources/, such as the one
 * returned by wiki_ingest_with_context. Returns de-duplicated wiki-relative
 * paths. Rejecting anything else matters because a page whose sources are all
 * missing is deleted by wiki_fix.
 */
async function optionalSources(
  args: ToolArgs,
  wikiDir: string,
  key = 'sources',
): Promise<string[] | undefined> {
  const sources = optionalStringArray(args, key);
  if (!sources || sources.length === 0) return undefined;
  if (sources.length > MAX_TAGS_COUNT) {
    throw new Error(`Too many ${key} (max ${MAX_TAGS_COUNT})`);
  }
  const normalized: string[] = [];
  for (const source of sources) {
    validateLength(source, key, MAX_PATH_LENGTH);
    const relPath = normalizeSourceRef(
      relative(wikiDir, assertWithinDir(wikiDir, source)).replace(/\\/g, '/'),
    );
    let isFile = false;
    if (relPath) {
      try {
        isFile = (await stat(join(wikiDir, relPath))).isFile();
      } catch {
        isFile = false;
      }
    }
    if (!relPath || !isFile) {
      throw new Error(
        `Source page not found: "${source}". Sources must be existing summary pages under sources/, such as the summary_page or pages_created path returned by wiki_ingest_with_context (e.g. "sources/article-summary.md").`,
      );
    }
    if (!normalized.includes(relPath)) normalized.push(relPath);
  }
  return normalized;
}

/** Record the pages a derived page came from in its frontmatter. */
async function setSources(wikiDir: string, relPath: string, sources: string[]): Promise<void> {
  const fullPath = join(wikiDir, relPath);
  await withWikiLock(wikiDir, async () => {
    const page = await readPage(fullPath);
    page.frontmatter.sources = sources;
    await writePage(fullPath, page);
  });
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
  await withWikiLock(dirname(indexPath), async () => {
    const entries = await readIndex(indexPath);
    const idx = entries.findIndex((e) => e.path === entry.path);
    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    await writeIndex(indexPath, entries);
  });
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

      await withWikiLock(wikiDir, async () => {
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
      const sources = await optionalSources(args, wikiDir);

      // S-3: Reject empty slugs (e.g. all-punctuation or non-Latin names)
      const slug = slugify(entityName);
      if (slug.length === 0) {
        throw new Error("'name' must contain at least one alphanumeric character");
      }

      // Validate the derived path stays within wiki dir
      assertWithinDir(wikiDir, `entities/${slug}.md`);

      const result = await withWikiLock(wikiDir, async () => {
        const created = await createEntityPage(wikiDir, entityName, content, tags);
        if (sources) await setSources(wikiDir, created.path, sources);
        return created;
      });

      return JSON.stringify({
        status: 'created',
        path: result.path,
        title: entityName,
        type: 'entity',
        tags,
        sources,
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
      const sources = await optionalSources(args, wikiDir);

      // S-3: Reject empty slugs (e.g. all-punctuation or non-Latin names)
      const slug = slugify(conceptName);
      if (slug.length === 0) {
        throw new Error("'name' must contain at least one alphanumeric character");
      }

      // Validate the derived path stays within wiki dir
      assertWithinDir(wikiDir, `concepts/${slug}.md`);

      const result = await withWikiLock(wikiDir, async () => {
        const created = await createConceptPage(wikiDir, conceptName, content, tags);
        if (sources) await setSources(wikiDir, created.path, sources);
        return created;
      });

      return JSON.stringify({
        status: 'created',
        path: result.path,
        title: conceptName,
        type: 'concept',
        tags,
        sources,
      });
    }

    case 'wiki_update_page': {
      const pagePath = requireString(args, 'pagePath');
      validateLength(pagePath, 'pagePath', MAX_PATH_LENGTH);
      const fullPath = assertWithinDir(wikiDir, pagePath);

      // Read, merge and write under the wiki lock so concurrent updates (from
      // this server, another one, or the VS Code extension) don't overwrite
      // each other's content or sources.
      return withWikiLock(wikiDir, async () => {
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

        // Extend the provenance of a derived page. Pages without sources are not
        // derived from a raw source and must never become eligible for cleanup.
        const addSources = await optionalSources(args, wikiDir, 'addSources');
        let sourcesUpdated = false;
        const currentSources = existing.frontmatter.sources;
        if (addSources && Array.isArray(currentSources) && currentSources.length > 0) {
          const mergedSources = [...currentSources];
          for (const source of addSources) {
            if (!mergedSources.includes(source)) mergedSources.push(source);
          }
          sourcesUpdated = mergedSources.length !== currentSources.length;
          mergedFrontmatter.sources = mergedSources;
        }

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
          sourcesUpdated,
        });
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
      // Resolve relative paths against the wiki root (not the server's cwd)
      // and keep the source inside it.
      const fullSourcePath = assertWithinDir(wikiRoot, sourcePath);
      const dryRun = args.dryRun === true;
      const force = args.force === true;
      const result = await ingestWithContext(fullSourcePath, wikiRoot, dryRun, force);
      return JSON.stringify(result);
    }

    case 'wiki_fix': {
      const dryRun = args.dryRun === true;
      return JSON.stringify(await fixWiki(wikiRoot, { dryRun }));
    }

    case 'wiki_delete_page': {
      const pagePath = requireString(args, 'pagePath');
      validateLength(pagePath, 'pagePath', MAX_PATH_LENGTH);
      const relPath = relative(wikiDir, assertWithinDir(wikiDir, pagePath)).replace(/\\/g, '/');
      if (isSpecialWikiFile(relPath)) {
        throw new Error(`'${relPath}' is a special wiki file and cannot be deleted`);
      }
      if (extname(relPath) !== '.md') {
        throw new Error("'pagePath' must point to a markdown page (.md)");
      }

      // deletePage repeats these checks after resolving symlinked folders.
      const result = await deletePage(wikiDir, relPath);
      // deletePage already removed the index entry, so only report real pages.
      const linkedFrom = result.backlinkWarnings
        .map((b) => ({
          page: relative(wikiDir, b.sourcePage).replace(/\\/g, '/'),
          title: b.sourceTitle,
          linkText: b.linkText,
        }))
        .filter((l) => !isSpecialWikiFile(l.page));

      await appendEntry(join(wikiDir, 'log.md'), {
        verb: 'deleted',
        subject: relPath,
        details:
          linkedFrom.length > 0
            ? `Page deleted. Still linked from: ${linkedFrom.map((l) => l.page).join(', ')}.`
            : 'Page deleted.',
      });

      return JSON.stringify({ status: 'deleted', path: relPath, linkedFrom });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
